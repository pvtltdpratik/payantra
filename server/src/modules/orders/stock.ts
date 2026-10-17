import type { Prisma } from '../../config/prisma.js';
import { AppError } from '../../lib/errors.js';

/**
 * Stock ledger operations. Every function takes the caller's transaction so a stock change and the
 * order change it belongs to commit or roll back together.
 *
 * Model: `onHand` units physically exist; `reserved` of them are promised to unpaid orders.
 *   available = onHand − reserved.
 *
 *   reserve  : reserved += q      (checkout; refuses unless available ≥ q)
 *   release  : reserved −= q      (abandoned/failed/expired order)
 *   commit   : onHand −= q, reserved −= q   (payment confirmed — the units are sold)
 *   restock  : onHand += q        (cancelled after commit, or a returned item)
 *
 * StockMovement.quantity is the signed change to `reserved` for RESERVED/RELEASED and to `onHand`
 * for SOLD/RETURNED/RECEIVED/ADJUSTMENT.
 */
export interface StockLine {
  variantId: string;
  quantity: number;
}

type Tx = Prisma.TransactionClient;

/** Merge duplicate variants and fix a global lock order so concurrent checkouts cannot deadlock. */
function normalise(lines: StockLine[]): StockLine[] {
  const merged = new Map<string, number>();
  for (const l of lines) merged.set(l.variantId, (merged.get(l.variantId) ?? 0) + l.quantity);
  return [...merged].map(([variantId, quantity]) => ({ variantId, quantity })).sort((a, b) => a.variantId.localeCompare(b.variantId));
}

export class OutOfStockError extends AppError {
  constructor(public readonly variantId: string) {
    super(409, 'OUT_OF_STOCK', 'Some items in your cart just sold out. Please review your cart.', { variantId });
  }
}

async function movement(tx: Tx, line: StockLine, type: 'RESERVED' | 'RELEASED' | 'SOLD' | 'RETURNED', signed: number, orderId: string, note?: string) {
  await tx.stockMovement.create({ data: { variantId: line.variantId, type, quantity: signed, orderId, note } });
}

/**
 * Atomically reserves stock. The conditional UPDATE is the whole trick: Postgres takes a row lock,
 * re-checks `onHand − reserved ≥ q` against the latest committed value, and updates — so two
 * checkouts racing for the last unit cannot both win, with no application-level locking at all.
 */
export async function reserveStock(tx: Tx, orderId: string, lines: StockLine[]): Promise<void> {
  for (const line of normalise(lines)) {
    const updated = await tx.$executeRaw`
      UPDATE "Inventory" SET "reserved" = "reserved" + ${line.quantity}
      WHERE "variantId" = ${line.variantId}::uuid AND "onHand" - "reserved" >= ${line.quantity}`;
    if (updated !== 1) throw new OutOfStockError(line.variantId);
    await movement(tx, line, 'RESERVED', line.quantity, orderId);
  }
}

export async function releaseReservation(tx: Tx, orderId: string, lines: StockLine[], note: string): Promise<void> {
  for (const line of normalise(lines)) {
    const updated = await tx.$executeRaw`
      UPDATE "Inventory" SET "reserved" = "reserved" - ${line.quantity}
      WHERE "variantId" = ${line.variantId}::uuid AND "reserved" >= ${line.quantity}`;
    // A release that finds nothing to release means the ledger and the order disagree: fail loudly.
    if (updated !== 1) throw new Error(`Stock ledger mismatch releasing ${line.quantity} of ${line.variantId} for order ${orderId}`);
    await movement(tx, line, 'RELEASED', -line.quantity, orderId, note);
  }
}

/** Turns reserved units into sold units. */
export async function commitReservation(tx: Tx, orderId: string, lines: StockLine[]): Promise<void> {
  for (const line of normalise(lines)) {
    const updated = await tx.$executeRaw`
      UPDATE "Inventory" SET "onHand" = "onHand" - ${line.quantity}, "reserved" = "reserved" - ${line.quantity}
      WHERE "variantId" = ${line.variantId}::uuid AND "reserved" >= ${line.quantity} AND "onHand" >= ${line.quantity}`;
    if (updated !== 1) throw new Error(`Stock ledger mismatch committing ${line.quantity} of ${line.variantId} for order ${orderId}`);
    await movement(tx, line, 'SOLD', -line.quantity, orderId);
  }
}

/**
 * Sells units directly, without a prior reservation (a late payment arriving for an order whose
 * reservation already expired). Refuses unless the units are genuinely free.
 */
export async function sellFreeStock(tx: Tx, orderId: string, lines: StockLine[]): Promise<void> {
  for (const line of normalise(lines)) {
    const updated = await tx.$executeRaw`
      UPDATE "Inventory" SET "onHand" = "onHand" - ${line.quantity}
      WHERE "variantId" = ${line.variantId}::uuid AND "onHand" - "reserved" >= ${line.quantity}`;
    if (updated !== 1) throw new OutOfStockError(line.variantId);
    await movement(tx, line, 'SOLD', -line.quantity, orderId, 'Late payment confirmed');
  }
}

/** Puts sold units back on the shelf (cancellation after payment, or an accepted return). */
export async function restock(tx: Tx, orderId: string, lines: StockLine[], note: string): Promise<void> {
  for (const line of normalise(lines)) {
    const updated = await tx.$executeRaw`
      UPDATE "Inventory" SET "onHand" = "onHand" + ${line.quantity} WHERE "variantId" = ${line.variantId}::uuid`;
    // The variant may have been deleted since; nothing to restock then.
    if (updated === 1) await movement(tx, line, 'RETURNED', line.quantity, orderId, note);
  }
}
