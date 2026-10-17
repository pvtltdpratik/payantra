import type { Request } from 'express';
import { prisma, Prisma } from '../../config/prisma.js';
import { audit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { pageMeta, toSkipTake } from '../../lib/pagination.js';
import type { PricingCoupon } from '../../lib/pricing.js';

type Db = Prisma.TransactionClient | typeof prisma;

export const normaliseCode = (code: string) => code.trim().toUpperCase();

interface CouponRow {
  id: string;
  code: string;
  discountType: 'PERCENTAGE' | 'FLAT';
  discountValue: number;
  maxDiscount: number | null;
  minOrderValue: number;
  usageLimit: number | null;
  perUserLimit: number;
  usedCount: number;
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
}

/**
 * Pure eligibility rules. Returns the reason a shopper can read, or null when the coupon is usable.
 * (Minimum order value is judged by the pricing engine, which knows the basket total.)
 */
export function couponProblem(c: CouponRow, now: Date, timesUsedByUser: number): string | null {
  if (!c.isActive) return 'This coupon is no longer active';
  if (now < c.startsAt) return 'This coupon is not valid yet';
  if (now > c.endsAt) return 'This coupon has expired';
  if (c.usageLimit !== null && c.usedCount >= c.usageLimit) return 'This coupon has been fully redeemed';
  if (timesUsedByUser >= c.perUserLimit) return 'You have already used this coupon';
  return null;
}

export function toPricingCoupon(c: CouponRow): PricingCoupon {
  return {
    id: c.id,
    code: c.code,
    discountType: c.discountType,
    discountValue: c.discountValue,
    maxDiscount: c.maxDiscount,
    minOrderValue: c.minOrderValue,
  };
}

/** How many times this user has redeemed the coupon on orders that were not cancelled. */
async function timesUsedBy(db: Db, couponId: string, userId: string): Promise<number> {
  return db.order.count({ where: { couponId, userId, fulfilmentStatus: { not: 'CANCELLED' } } });
}

/**
 * Finds and validates a coupon for a user. Unknown and ineligible codes both raise 422 with a
 * human-readable reason; the generic "invalid" message for unknown codes avoids confirming
 * which codes exist.
 */
export async function resolveCoupon(db: Db, rawCode: string, userId: string, now = new Date()): Promise<PricingCoupon> {
  const code = normaliseCode(rawCode);
  const coupon = await db.coupon.findFirst({ where: { code: { equals: code, mode: 'insensitive' } } });
  if (!coupon) throw AppError.unprocessable('This coupon code is not valid');
  const problem = couponProblem(coupon, now, await timesUsedBy(db, coupon.id, userId));
  if (problem) throw AppError.unprocessable(problem);
  return toPricingCoupon(coupon);
}

/** Non-throwing variant for re-validating a coupon already attached to a cart. */
export async function tryResolveCoupon(db: Db, code: string, userId: string): Promise<{ coupon: PricingCoupon | null; note: string | null }> {
  try {
    return { coupon: await resolveCoupon(db, code, userId), note: null };
  } catch (err) {
    if (err instanceof AppError) return { coupon: null, note: err.message };
    throw err;
  }
}

/**
 * Claims one use of a coupon inside the checkout transaction. The conditional UPDATE is the
 * race-proof gate: if two shoppers take the last redemption together, exactly one row updates.
 */
export async function claimCouponUse(tx: Prisma.TransactionClient, couponId: string): Promise<void> {
  const claimed = await tx.$executeRaw`
    UPDATE "Coupon" SET "usedCount" = "usedCount" + 1
    WHERE "id" = ${couponId}::uuid AND ("usageLimit" IS NULL OR "usedCount" < "usageLimit")`;
  if (claimed !== 1) throw AppError.unprocessable('This coupon has been fully redeemed');
}

export async function releaseCouponUse(tx: Prisma.TransactionClient, couponId: string): Promise<void> {
  await tx.$executeRaw`UPDATE "Coupon" SET "usedCount" = GREATEST("usedCount" - 1, 0) WHERE "id" = ${couponId}::uuid`;
}

// ───────────────────────── Admin CRUD ─────────────────────────

type CouponInput = {
  code: string;
  description?: string | null;
  discountType: 'PERCENTAGE' | 'FLAT';
  discountValue: number;
  maxDiscount?: number | null;
  minOrderValue?: number;
  usageLimit?: number | null;
  perUserLimit?: number;
  startsAt: Date;
  endsAt: Date;
  isActive?: boolean;
};

export async function listCoupons(q: { page: number; pageSize: number; q?: string }) {
  const where: Prisma.CouponWhereInput = q.q ? { code: { contains: q.q, mode: 'insensitive' } } : {};
  const [total, items] = await prisma.$transaction([
    prisma.coupon.count({ where }),
    prisma.coupon.findMany({ where, orderBy: { createdAt: 'desc' }, ...toSkipTake(q) }),
  ]);
  return { items, meta: pageMeta(q, total) };
}

export async function createCoupon(req: Request, input: CouponInput) {
  const code = normaliseCode(input.code);
  return prisma.$transaction(async (tx) => {
    const clash = await tx.coupon.findFirst({ where: { code: { equals: code, mode: 'insensitive' } }, select: { id: true } });
    if (clash) throw AppError.conflict(`Coupon code ${code} already exists`);
    const coupon = await tx.coupon.create({ data: { ...input, code } });
    await audit(tx, req, { action: 'coupon.create', entityType: 'Coupon', entityId: coupon.id, metadata: { code } });
    return coupon;
  });
}

export async function updateCoupon(req: Request, id: string, patch: Partial<CouponInput>) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.coupon.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Coupon not found');

    const startsAt = patch.startsAt ?? existing.startsAt;
    const endsAt = patch.endsAt ?? existing.endsAt;
    if (endsAt <= startsAt) throw AppError.unprocessable('endsAt must be after startsAt', { field: 'endsAt' });

    const type = patch.discountType ?? existing.discountType;
    const value = patch.discountValue ?? existing.discountValue;
    if (type === 'PERCENTAGE' && value > 100) throw AppError.unprocessable('A percentage discount cannot exceed 100', { field: 'discountValue' });

    const usageLimit = patch.usageLimit === undefined ? existing.usageLimit : patch.usageLimit;
    if (usageLimit !== null && usageLimit < existing.usedCount) {
      throw AppError.unprocessable(`The usage limit cannot be below the ${existing.usedCount} redemptions already made`, { field: 'usageLimit' });
    }

    // The code is the identity customers know; it cannot change once issued.
    const { code: _ignored, ...rest } = patch;
    const coupon = await tx.coupon.update({ where: { id }, data: rest });
    await audit(tx, req, { action: 'coupon.update', entityType: 'Coupon', entityId: id, metadata: { fields: Object.keys(rest) } });
    return coupon;
  });
}

/** Redeemed coupons are deactivated rather than deleted so order history stays explainable. */
export async function deleteCoupon(req: Request, id: string): Promise<{ deleted: boolean; deactivated: boolean }> {
  return prisma.$transaction(async (tx) => {
    const coupon = await tx.coupon.findUnique({ where: { id }, include: { _count: { select: { orders: true } } } });
    if (!coupon) throw AppError.notFound('Coupon not found');
    if (coupon._count.orders > 0) {
      await tx.coupon.update({ where: { id }, data: { isActive: false } });
      await audit(tx, req, { action: 'coupon.deactivate', entityType: 'Coupon', entityId: id, metadata: { reason: 'has orders' } });
      return { deleted: false, deactivated: true };
    }
    await tx.coupon.delete({ where: { id } });
    await audit(tx, req, { action: 'coupon.delete', entityType: 'Coupon', entityId: id });
    return { deleted: true, deactivated: false };
  });
}
