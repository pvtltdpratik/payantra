import { prisma, Prisma } from '../../config/prisma.js';
import { dayKeys, previousRange, type Range } from './range.js';

/**
 * Dashboard numbers, computed from the database on every request — nothing is cached or hard-coded.
 *
 * DEFINITIONS (the same ones the reports and the docs use):
 *   paid order      an order with `paidAt` set: an online payment was captured, or a Cash-on-Delivery order was delivered
 *   gross sales     Σ grandTotal of orders PAID in the period (the amount customers paid, GST and delivery included)
 *   refunds         Σ amount of refunds PROCESSED in the period (money actually returned, whenever the order was placed)
 *   net revenue     gross sales − refunds
 *   average order   gross sales ÷ paid orders
 * Days are India's calendar days (IST); `paidAt` and `processedAt` are what place a rupee on a day.
 */

/** Built on use, not at import: importing a service must not require the Prisma runtime (tests stub that module). */
const istShift = () => Prisma.sql`interval '5 hours 30 minutes'`;
const n = (v: unknown) => Number(v ?? 0);

export interface PeriodTotals {
  grossSales: number;
  refunds: number;
  netRevenue: number;
  paidOrders: number;
  averageOrderValue: number;
  taxCollected: number;
  discountsGiven: number;
  shippingCollected: number;
}

export async function periodTotals(from: Date, to: Date): Promise<PeriodTotals> {
  const [paid, refunded] = await Promise.all([
    prisma.$queryRaw<{ orders: bigint; gross: bigint; tax: bigint; discount: bigint; shipping: bigint }[]>`
      SELECT COUNT(*) AS orders,
             COALESCE(SUM("grandTotal"), 0) AS gross,
             COALESCE(SUM("taxTotal"), 0) AS tax,
             COALESCE(SUM("discountTotal"), 0) AS discount,
             COALESCE(SUM("shippingTotal"), 0) AS shipping
      FROM "Order"
      WHERE "paidAt" >= ${from}::timestamp AND "paidAt" < ${to}::timestamp`,
    prisma.$queryRaw<{ refunds: bigint }[]>`
      SELECT COALESCE(SUM("amount"), 0) AS refunds
      FROM "Refund"
      WHERE "status" = 'PROCESSED' AND "processedAt" >= ${from}::timestamp AND "processedAt" < ${to}::timestamp`,
  ]);
  const gross = n(paid[0]?.gross);
  const orders = n(paid[0]?.orders);
  const refunds = n(refunded[0]?.refunds);
  return {
    grossSales: gross,
    refunds,
    netRevenue: gross - refunds,
    paidOrders: orders,
    averageOrderValue: orders > 0 ? Math.round(gross / orders) : 0,
    taxCollected: n(paid[0]?.tax),
    discountsGiven: n(paid[0]?.discount),
    shippingCollected: n(paid[0]?.shipping),
  };
}

/** Gross, refunds and order counts for every IST day in the range (zero-filled). */
export async function salesByDay(r: Range) {
  const [paid, refunded] = await Promise.all([
    prisma.$queryRaw<{ day: string; gross: bigint; orders: bigint }[]>`
      SELECT to_char("paidAt" + ${istShift()}, 'YYYY-MM-DD') AS day, SUM("grandTotal") AS gross, COUNT(*) AS orders
      FROM "Order"
      WHERE "paidAt" >= ${r.from}::timestamp AND "paidAt" < ${r.to}::timestamp
      GROUP BY 1`,
    prisma.$queryRaw<{ day: string; refunds: bigint }[]>`
      SELECT to_char("processedAt" + ${istShift()}, 'YYYY-MM-DD') AS day, SUM("amount") AS refunds
      FROM "Refund"
      WHERE "status" = 'PROCESSED' AND "processedAt" >= ${r.from}::timestamp AND "processedAt" < ${r.to}::timestamp
      GROUP BY 1`,
  ]);
  const gross = new Map(paid.map((p) => [p.day, { gross: n(p.gross), orders: n(p.orders) }]));
  const back = new Map(refunded.map((p) => [p.day, n(p.refunds)]));
  return dayKeys(r).map((date) => {
    const g = gross.get(date)?.gross ?? 0;
    const refunds = back.get(date) ?? 0;
    return { date, gross: g, refunds, net: g - refunds, orders: gross.get(date)?.orders ?? 0 };
  });
}

export async function lowStock(limit = 8) {
  const [count, items] = await Promise.all([
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM "Inventory" i
      JOIN "ProductVariant" v ON v."id" = i."variantId"
      JOIN "Product" p ON p."id" = v."productId"
      WHERE v."isActive" AND p."status" = 'ACTIVE' AND (i."onHand" - i."reserved") <= i."lowStockThreshold"`,
    prisma.$queryRaw<
      { variantId: string; productId: string; sku: string; name: string; size: string | null; colour: string | null; onHand: number; reserved: number; lowStockThreshold: number }[]
    >`
      SELECT v."id" AS "variantId", p."id" AS "productId", v."sku", p."name", v."size", v."colour", i."onHand", i."reserved", i."lowStockThreshold"
      FROM "Inventory" i
      JOIN "ProductVariant" v ON v."id" = i."variantId"
      JOIN "Product" p ON p."id" = v."productId"
      WHERE v."isActive" AND p."status" = 'ACTIVE' AND (i."onHand" - i."reserved") <= i."lowStockThreshold"
      ORDER BY (i."onHand" - i."reserved") ASC, p."name" ASC
      LIMIT ${limit}`,
  ]);
  return {
    count: n(count[0]?.count),
    items: items.map((i) => ({ ...i, available: i.onHand - i.reserved })),
  };
}

export async function overview(r: Range) {
  const prev = previousRange(r);
  const [current, previous, byDay, statuses, customerTotal, customersNew, partnerCounts, stock, returnsOpen, refundsPending, supportOpen, payments, refunds] = await Promise.all([
    periodTotals(r.from, r.to),
    periodTotals(prev.from, prev.to),
    salesByDay(r),
    prisma.order.groupBy({ by: ['fulfilmentStatus'], where: { createdAt: { gte: r.from, lt: r.to } }, _count: { _all: true } }),
    prisma.profile.count({ where: { role: 'CUSTOMER' } }),
    prisma.profile.count({ where: { role: 'CUSTOMER', createdAt: { gte: r.from, lt: r.to } } }),
    prisma.deliveryPartner.groupBy({ by: ['status', 'isOnline'], _count: { _all: true } }),
    lowStock(),
    prisma.returnRequest.groupBy({ by: ['status'], where: { status: { in: ['REQUESTED', 'APPROVED'] } }, _count: { _all: true } }),
    prisma.refund.count({ where: { status: 'PENDING' } }),
    prisma.supportRequest.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
    prisma.payment.findMany({
      where: { status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'] }, capturedAt: { not: null } },
      orderBy: { capturedAt: 'desc' },
      take: 8,
      select: { id: true, amount: true, method: true, capturedAt: true, order: { select: { id: true, orderNumber: true } } },
    }),
    prisma.refund.findMany({
      where: { status: 'PROCESSED', processedAt: { not: null } },
      orderBy: { processedAt: 'desc' },
      take: 8,
      select: { id: true, amount: true, source: true, processedAt: true, payment: { select: { order: { select: { id: true, orderNumber: true } } } } },
    }),
  ]);

  const orderStatus: Record<string, number> = {};
  for (const s of statuses) orderStatus[s.fulfilmentStatus] = s._count._all;

  const partnerCount = (pred: (p: (typeof partnerCounts)[number]) => boolean) => partnerCounts.filter(pred).reduce((a, p) => a + p._count._all, 0);
  const retCount = (status: string) => returnsOpen.find((x) => x.status === status)?._count._all ?? 0;

  const recentTransactions = [
    ...payments.map((p) => ({ id: p.id, type: 'PAYMENT' as const, amount: p.amount, method: p.method, at: p.capturedAt!, orderId: p.order.id, orderNumber: p.order.orderNumber })),
    ...refunds.map((f) => ({ id: f.id, type: 'REFUND' as const, amount: -f.amount, method: f.source, at: f.processedAt!, orderId: f.payment.order.id, orderNumber: f.payment.order.orderNumber })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 10);

  return {
    range: { from: r.fromKey, to: r.toKey, days: r.days },
    totals: current,
    previous: { from: prev.fromKey, to: prev.toKey, totals: previous },
    ordersPlaced: Object.values(orderStatus).reduce((a, b) => a + b, 0),
    orderStatus,
    salesByDay: byDay,
    customers: { total: customerTotal, new: customersNew },
    partners: {
      approved: partnerCount((p) => p.status === 'APPROVED'),
      online: partnerCount((p) => p.status === 'APPROVED' && p.isOnline),
      pendingApplications: partnerCount((p) => p.status === 'PENDING'),
    },
    lowStock: stock,
    pending: {
      returnRequests: retCount('REQUESTED'),
      returnsAwaitingCompletion: retCount('APPROVED'),
      refundsAwaitingConfirmation: refundsPending,
      supportRequests: supportOpen,
    },
    recentTransactions,
  };
}
