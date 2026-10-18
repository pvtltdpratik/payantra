import type { Request } from 'express';
import { prisma, type Prisma } from '../../config/prisma.js';
import { audit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { advisoryLock } from '../../lib/locks.js';
import { pageMeta, toSkipTake } from '../../lib/pagination.js';

type Tx = Prisma.TransactionClient;

/** "Asha Rao" → "Asha R."; a review never exposes a full name, an email or an id of the reviewer. */
export function displayName(fullName: string | null | undefined): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Verified buyer';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The rating shown on product cards and sort-by-rating is a stored aggregate. It is recomputed from the VISIBLE
 * reviews inside the same transaction as every change, under a per-product lock, so two simultaneous reviews can
 * never leave it stale.
 */
async function recomputeRating(tx: Tx, productId: string) {
  const agg = await tx.review.aggregate({ where: { productId, isVisible: true }, _avg: { rating: true }, _count: { _all: true } });
  await tx.product.update({ where: { id: productId }, data: { ratingAverage: round2(agg._avg.rating ?? 0), ratingCount: agg._count._all } });
}
const lockProduct = (tx: Tx, productId: string) => advisoryLock(tx, `review-rating:${productId}`);

// ───────────────────────── Reading ─────────────────────────

export async function productReviews(slug: string, q: { page: number; pageSize: number; sort: 'newest' | 'highest' | 'lowest' }) {
  const product = await prisma.product.findFirst({ where: { slug, status: 'ACTIVE' }, select: { id: true } });
  if (!product) throw AppError.notFound('Product not found');

  const where = { productId: product.id, isVisible: true };
  const orderBy: Prisma.ReviewOrderByWithRelationInput[] =
    q.sort === 'highest' ? [{ rating: 'desc' }, { createdAt: 'desc' }] : q.sort === 'lowest' ? [{ rating: 'asc' }, { createdAt: 'desc' }] : [{ createdAt: 'desc' }];
  const [total, rows, histogram] = await prisma.$transaction([
    prisma.review.count({ where }),
    prisma.review.findMany({ where, orderBy, ...toSkipTake(q), select: { id: true, rating: true, title: true, body: true, createdAt: true, user: { select: { fullName: true } } } }),
    prisma.review.groupBy({ by: ['rating'], where, _count: { _all: true }, orderBy: { rating: 'asc' } }),
  ]);

  const counts: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const h of histogram) counts[h.rating as 1 | 2 | 3 | 4 | 5] = h._count._all;
  // The summary is computed from the SAME visible reviews the list shows, so the headline can never disagree with the
  // reviews beneath it (the stored aggregate on the product exists for sorting and filtering the shop).
  const count = Object.values(counts).reduce((a, b) => a + b, 0);
  const average = count ? round2(([1, 2, 3, 4, 5] as const).reduce((sum, r) => sum + r * counts[r], 0) / count) : 0;
  return {
    summary: { average, count, histogram: counts },
    items: rows.map((r) => ({ id: r.id, rating: r.rating, title: r.title, body: r.body, createdAt: r.createdAt, reviewer: displayName(r.user.fullName), verifiedPurchase: true })),
    meta: pageMeta(q, total),
  };
}

/**
 * Real words from real buyers for the home page: visible, 4–5 star reviews with some substance, newest first,
 * at most one per product so a single popular item doesn't fill the row. Nothing is invented: with no such
 * reviews the list is empty and the home page leaves the section out.
 */
export async function featuredReviews(limit: number) {
  const rows = await prisma.review.findMany({
    where: { isVisible: true, rating: { gte: 4 }, body: { not: null }, product: { status: 'ACTIVE', category: { isActive: true } } },
    orderBy: { createdAt: 'desc' },
    take: 60,
    select: { id: true, productId: true, rating: true, title: true, body: true, createdAt: true, user: { select: { fullName: true } }, product: { select: { name: true, slug: true } } },
  });
  const seen = new Set<string>();
  const out = [];
  for (const r of rows) {
    const body = (r.body ?? '').trim();
    if (body.length < 20 || seen.has(r.productId)) continue;
    seen.add(r.productId);
    out.push({
      id: r.id,
      rating: r.rating,
      title: r.title,
      body: body.length > 280 ? `${body.slice(0, 277).trimEnd()}…` : body,
      createdAt: r.createdAt,
      reviewer: displayName(r.user.fullName),
      productName: r.product.name,
      productSlug: r.product.slug,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** What this customer has reviewed, and what they bought and received but have not reviewed yet. */
export async function myReviews(userId: string) {
  const [reviews, delivered] = await Promise.all([
    prisma.review.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, productId: true, orderId: true, rating: true, title: true, body: true, isVisible: true, createdAt: true } }),
    prisma.orderItem.findMany({
      where: { order: { userId, fulfilmentStatus: 'DELIVERED' } },
      orderBy: { order: { createdAt: 'desc' } },
      take: 100,
      select: { orderId: true, productId: true, productName: true, imageUrl: true, order: { select: { orderNumber: true } } },
    }),
  ]);

  const done = new Set(reviews.map((r) => `${r.orderId}:${r.productId}`));
  const pendingKeys = new Set<string>();
  const pending = delivered.filter((i) => {
    const key = `${i.orderId}:${i.productId}`;
    if (done.has(key) || pendingKeys.has(key)) return false; // one prompt per product per order, whatever the variants
    pendingKeys.add(key);
    return true;
  });

  const ids = [...new Set([...reviews.map((r) => r.productId), ...pending.map((p) => p.productId)])];
  const products = ids.length ? await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, slug: true, name: true } }) : [];
  const info = new Map(products.map((p) => [p.id, p]));

  return {
    toReview: pending
      .filter((p) => info.get(p.productId))
      .map((p) => ({ orderId: p.orderId, orderNumber: p.order.orderNumber, productId: p.productId, name: info.get(p.productId)!.name, slug: info.get(p.productId)!.slug, image: p.imageUrl })),
    reviewed: reviews.map((r) => ({ ...r, name: info.get(r.productId)?.name ?? 'Product', slug: info.get(r.productId)?.slug ?? null })),
  };
}

// ───────────────────────── Writing ─────────────────────────

interface Create {
  productId: string;
  orderId: string;
  rating: number;
  title?: string | null;
  body?: string | null;
}

export async function createReview(userId: string, input: Create) {
  return prisma.$transaction(async (tx) => {
    await lockProduct(tx, input.productId);
    // Only a DELIVERED order of this customer that really contained the product proves a purchase.
    const bought = await tx.orderItem.findFirst({
      where: { orderId: input.orderId, productId: input.productId, order: { userId, fulfilmentStatus: 'DELIVERED' } },
      select: { id: true },
    });
    if (!bought) throw AppError.forbidden('You can review a product once an order containing it has been delivered');

    const existing = await tx.review.findFirst({ where: { productId: input.productId, userId, orderId: input.orderId }, select: { id: true } });
    if (existing) throw AppError.conflict('You have already reviewed this item. You can edit your review instead.');

    const review = await tx.review.create({
      data: { productId: input.productId, userId, orderId: input.orderId, rating: input.rating, title: input.title || null, body: input.body || null },
      select: { id: true, productId: true, orderId: true, rating: true, title: true, body: true, isVisible: true, createdAt: true },
    });
    await recomputeRating(tx, input.productId);
    return review;
  });
}

async function ownReview(tx: Tx, userId: string, id: string) {
  // Another customer's review behaves exactly like one that does not exist.
  const found = await tx.review.findFirst({ where: { id, userId }, select: { id: true, productId: true } });
  if (!found) throw AppError.notFound('Review not found');
  return found;
}

export async function updateReview(userId: string, id: string, patch: { rating?: number; title?: string | null; body?: string | null }) {
  return prisma.$transaction(async (tx) => {
    const found = await ownReview(tx, userId, id);
    await lockProduct(tx, found.productId);
    const review = await tx.review.update({
      where: { id },
      data: { ...(patch.rating !== undefined ? { rating: patch.rating } : {}), ...(patch.title !== undefined ? { title: patch.title || null } : {}), ...(patch.body !== undefined ? { body: patch.body || null } : {}) },
      select: { id: true, productId: true, orderId: true, rating: true, title: true, body: true, isVisible: true, createdAt: true },
    });
    await recomputeRating(tx, found.productId);
    return review;
  });
}

export async function deleteReview(userId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    const found = await ownReview(tx, userId, id);
    await lockProduct(tx, found.productId);
    await tx.review.delete({ where: { id } });
    await recomputeRating(tx, found.productId);
  });
}

// ───────────────────────── Moderation (admin) ─────────────────────────

export async function listForModeration(q: { page: number; pageSize: number; status?: 'visible' | 'hidden'; rating?: number }) {
  const where: Prisma.ReviewWhereInput = { ...(q.status ? { isVisible: q.status === 'visible' } : {}), ...(q.rating ? { rating: q.rating } : {}) };
  const [total, rows] = await prisma.$transaction([
    prisma.review.count({ where }),
    prisma.review.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...toSkipTake(q),
      select: { id: true, rating: true, title: true, body: true, isVisible: true, createdAt: true, productId: true, product: { select: { name: true, slug: true } }, user: { select: { id: true, email: true, fullName: true } } },
    }),
  ]);
  return { items: rows.map(({ product, ...r }) => ({ ...r, productName: product.name, productSlug: product.slug })), meta: pageMeta(q, total) };
}

export async function setVisibility(req: Request, id: string, isVisible: boolean) {
  return prisma.$transaction(async (tx) => {
    const found = await tx.review.findUnique({ where: { id }, select: { id: true, productId: true } });
    if (!found) throw AppError.notFound('Review not found');
    await lockProduct(tx, found.productId);
    const review = await tx.review.update({ where: { id }, data: { isVisible }, select: { id: true, isVisible: true } });
    await recomputeRating(tx, found.productId);
    await audit(tx, req, { action: isVisible ? 'review.show' : 'review.hide', entityType: 'Review', entityId: id });
    return review;
  });
}
