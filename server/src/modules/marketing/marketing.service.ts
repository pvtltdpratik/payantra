import type { Request } from 'express';
import { prisma } from '../../config/prisma.js';
import { audit } from '../../lib/audit.js';
import { toCsv } from '../../lib/csv.js';
import { AppError } from '../../lib/errors.js';
import { pageMeta, toSkipTake } from '../../lib/pagination.js';
import { istDateTimeString } from '../../lib/time.js';

export const PLACEMENTS = ['HOME_HERO', 'HOME_STRIP', 'CATEGORY'] as const;
export type Placement = (typeof PLACEMENTS)[number];

interface BannerInput {
  title: string;
  subtitle?: string | null;
  imageUrl: string;
  linkUrl?: string | null;
  placement: Placement;
  sortOrder: number;
  isActive: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
}

// ───────────────────────── Banners ─────────────────────────

/** What the storefront may show: active, inside its date window, in the order the admin chose. */
export async function publicBanners(placement?: Placement, now = new Date()) {
  return prisma.banner.findMany({
    where: {
      isActive: true,
      ...(placement ? { placement } : {}),
      AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
    },
    orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
    select: { id: true, title: true, subtitle: true, imageUrl: true, linkUrl: true, placement: true },
  });
}

export const listBanners = () => prisma.banner.findMany({ orderBy: [{ placement: 'asc' }, { sortOrder: 'asc' }, { title: 'asc' }] });

export async function createBanner(req: Request, input: BannerInput) {
  return prisma.$transaction(async (tx) => {
    const banner = await tx.banner.create({ data: input });
    await audit(tx, req, { action: 'banner.create', entityType: 'Banner', entityId: banner.id, metadata: { title: banner.title, placement: banner.placement } });
    return banner;
  });
}

export async function updateBanner(req: Request, id: string, patch: Partial<BannerInput>) {
  return prisma.$transaction(async (tx) => {
    const found = await tx.banner.findUnique({ where: { id } });
    if (!found) throw AppError.notFound('Banner not found');
    // A date window is validated against the final state, not just the fields sent.
    const startsAt = patch.startsAt !== undefined ? patch.startsAt : found.startsAt;
    const endsAt = patch.endsAt !== undefined ? patch.endsAt : found.endsAt;
    if (startsAt && endsAt && endsAt <= startsAt) throw AppError.unprocessable('The end date must be after the start date');
    const banner = await tx.banner.update({ where: { id }, data: patch });
    await audit(tx, req, { action: 'banner.update', entityType: 'Banner', entityId: id, metadata: { fields: Object.keys(patch) } });
    return banner;
  });
}

export async function deleteBanner(req: Request, id: string) {
  await prisma.$transaction(async (tx) => {
    const found = await tx.banner.findUnique({ where: { id }, select: { title: true } });
    if (!found) throw AppError.notFound('Banner not found');
    await tx.banner.delete({ where: { id } });
    await audit(tx, req, { action: 'banner.delete', entityType: 'Banner', entityId: id, metadata: { title: found.title } });
  });
}

// ───────────────────────── Newsletter ─────────────────────────

/**
 * Idempotent and silent about what it already knows: subscribing twice (or after unsubscribing) works and answers
 * the same way, so the form cannot be used to discover who is on the list.
 */
export async function subscribe(email: string) {
  const address = email.trim().toLowerCase();
  await prisma.newsletterSubscriber.upsert({ where: { email: address }, create: { email: address }, update: { unsubscribedAt: null } });
}

interface ListQ {
  page: number;
  pageSize: number;
  q?: string;
  status?: 'subscribed' | 'unsubscribed';
}

const subscriberWhere = (q: Pick<ListQ, 'q' | 'status'>) => ({
  ...(q.q?.trim() ? { email: { contains: q.q.trim(), mode: 'insensitive' as const } } : {}),
  ...(q.status === 'subscribed' ? { unsubscribedAt: null } : q.status === 'unsubscribed' ? { unsubscribedAt: { not: null } } : {}),
});

export async function listSubscribers(q: ListQ) {
  const where = subscriberWhere(q);
  const [total, active, items] = await prisma.$transaction([
    prisma.newsletterSubscriber.count({ where }),
    prisma.newsletterSubscriber.count({ where: { unsubscribedAt: null } }),
    prisma.newsletterSubscriber.findMany({ where, orderBy: { subscribedAt: 'desc' }, ...toSkipTake(q) }),
  ]);
  return { items, meta: { ...pageMeta(q, total), subscribed: active } };
}

export async function subscribersCsv(q: Pick<ListQ, 'q' | 'status'>) {
  const rows = await prisma.newsletterSubscriber.findMany({ where: subscriberWhere(q), orderBy: { subscribedAt: 'desc' }, take: 50_000 });
  return toCsv(
    ['Email', 'Subscribed (IST)', 'Status', 'Unsubscribed (IST)'],
    rows.map((r) => [r.email, istDateTimeString(r.subscribedAt), r.unsubscribedAt ? 'Unsubscribed' : 'Subscribed', r.unsubscribedAt ? istDateTimeString(r.unsubscribedAt) : '']),
  );
}

export async function setSubscribed(req: Request, id: string, subscribed: boolean) {
  return prisma.$transaction(async (tx) => {
    const found = await tx.newsletterSubscriber.findUnique({ where: { id } });
    if (!found) throw AppError.notFound('Subscriber not found');
    const updated = await tx.newsletterSubscriber.update({ where: { id }, data: { unsubscribedAt: subscribed ? null : new Date() } });
    await audit(tx, req, { action: subscribed ? 'newsletter.resubscribe' : 'newsletter.unsubscribe', entityType: 'NewsletterSubscriber', entityId: id });
    return updated;
  });
}
