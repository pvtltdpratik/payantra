import type { Request } from 'express';
import { prisma, Prisma } from '../../config/prisma.js';
import { audit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { pageMeta, toSkipTake } from '../../lib/pagination.js';

interface InventoryRow {
  variantId: string;
  sku: string;
  size: string | null;
  colour: string | null;
  productId: string;
  productName: string;
  productStatus: string;
  onHand: number;
  reserved: number;
  lowStockThreshold: number;
}

/**
 * Inventory list. "Low stock" means AVAILABLE units (on hand minus reserved) at or below the
 * variant's own threshold, which Prisma's where-DSL cannot express, hence raw SQL.
 */
export async function listInventory(q: { page: number; pageSize: number; q?: string; lowStock?: boolean }) {
  const conditions: Prisma.Sql[] = [Prisma.sql`v."isActive" = true`];
  if (q.q) {
    const like = `%${q.q.replace(/[%_\\]/g, '\\$&')}%`;
    conditions.push(Prisma.sql`(p."name" ILIKE ${like} OR v."sku" ILIKE ${like})`);
  }
  if (q.lowStock) conditions.push(Prisma.sql`(i."onHand" - i."reserved") <= i."lowStockThreshold"`);
  const where = Prisma.join(conditions, ' AND ');
  const { skip, take } = toSkipTake(q);

  const [rows, count] = await Promise.all([
    prisma.$queryRaw<InventoryRow[]>`
      SELECT v."id" AS "variantId", v."sku", v."size", v."colour",
             p."id" AS "productId", p."name" AS "productName", p."status"::text AS "productStatus",
             i."onHand", i."reserved", i."lowStockThreshold"
      FROM "ProductVariant" v
      JOIN "Inventory" i ON i."variantId" = v."id"
      JOIN "Product" p ON p."id" = v."productId"
      WHERE ${where}
      ORDER BY (i."onHand" - i."reserved") ASC, p."name" ASC, v."sku" ASC
      LIMIT ${take} OFFSET ${skip}`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS "n"
      FROM "ProductVariant" v
      JOIN "Inventory" i ON i."variantId" = v."id"
      JOIN "Product" p ON p."id" = v."productId"
      WHERE ${where}`,
  ]);

  const total = Number(count[0]?.n ?? 0);
  const items = rows.map((r) => {
    const available = Math.max(0, r.onHand - r.reserved);
    return { ...r, available, isLow: available <= r.lowStockThreshold };
  });
  return { items, meta: pageMeta(q, total) };
}

type Adjustment = { mode: 'delta' | 'set'; quantity: number; reason: string };

/**
 * Changes on-hand stock under a row lock so two admins (or an admin and a checkout)
 * cannot interleave, and refuses to drop below units already reserved for customers.
 */
export async function adjustInventory(req: Request, variantId: string, adj: Adjustment) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ onHand: number; reserved: number }[]>`
      SELECT "onHand", "reserved" FROM "Inventory" WHERE "variantId" = ${variantId}::uuid FOR UPDATE`;
    const row = rows[0];
    if (!row) throw AppError.notFound('Inventory record not found');

    const next = adj.mode === 'set' ? adj.quantity : row.onHand + adj.quantity;
    if (next < 0) throw AppError.unprocessable('Stock cannot go below zero');
    if (next < row.reserved) {
      throw AppError.conflict(`Cannot set stock below ${row.reserved} units that are reserved for pending orders`, {
        reserved: row.reserved,
      });
    }
    const change = next - row.onHand;
    if (change === 0) throw AppError.unprocessable('Stock is already at that level');

    const inventory = await tx.inventory.update({ where: { variantId }, data: { onHand: next } });
    await tx.stockMovement.create({
      data: {
        variantId,
        type: change > 0 ? 'RECEIVED' : 'ADJUSTMENT',
        quantity: change,
        note: `${adj.mode === 'set' ? 'Set to ' + adj.quantity : 'Adjusted'}: ${adj.reason}`,
        actorId: req.user!.id,
      },
    });
    await audit(tx, req, {
      action: 'inventory.adjust',
      entityType: 'ProductVariant',
      entityId: variantId,
      metadata: { from: row.onHand, to: next, reason: adj.reason },
    });
    return inventory;
  });
}

export async function listMovements(variantId: string, page: { page: number; pageSize: number }) {
  const where = { variantId };
  const [total, items] = await prisma.$transaction([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({ where, orderBy: { createdAt: 'desc' }, ...toSkipTake(page) }),
  ]);
  return { items, meta: pageMeta(page, total) };
}
