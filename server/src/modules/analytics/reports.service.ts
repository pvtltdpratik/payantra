import { prisma, Prisma } from '../../config/prisma.js';
import { toCsv, type CsvCell } from '../../lib/csv.js';
import { istDateTimeString } from '../../lib/time.js';
import type { Range } from './range.js';

/**
 * Reports are plain tables: a list of typed columns and rows. The admin screen renders them generically and the
 * CSV export is built from the very same data, so the two can never disagree.
 *
 *   money      integer paise in JSON; rupees with two decimals in CSV
 *   datetime   an instant in JSON; "YYYY-MM-DD HH:MM" India time in CSV
 */
export type ColumnType = 'text' | 'int' | 'money' | 'date' | 'datetime' | 'percent';
export interface Column {
  key: string;
  label: string;
  type: ColumnType;
}
export interface Report {
  name: ReportName;
  title: string;
  columns: Column[];
  rows: Record<string, string | number | Date | null>[];
  totals?: Record<string, string | number | null>;
  /** True when the row limit cut the report short: narrow the dates. */
  truncated: boolean;
}

export const REPORT_NAMES = ['sales', 'products', 'inventory', 'payments', 'delivery'] as const;
export type ReportName = (typeof REPORT_NAMES)[number];
export const GRANULARITIES = ['day', 'week', 'month'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export interface ReportOptions {
  granularity?: Granularity;
  lowStockOnly?: boolean;
  limit: number;
}

/** Built on use, not at import: importing a service must not require the Prisma runtime (tests stub that module). */
const istShift = () => Prisma.sql`interval '5 hours 30 minutes'`;
const n = (v: unknown) => Number(v ?? 0);
const capped = <T>(rows: T[], limit: number) => ({ rows: rows.slice(0, limit), truncated: rows.length > limit });

// ───────────────────────── Sales ─────────────────────────

async function sales(r: Range, o: ReportOptions): Promise<Report> {
  // The unit comes from a whitelist, never from user text, so interpolating it raw is safe.
  const unit = Prisma.raw(`'${o.granularity ?? 'day'}'`);
  const [paid, refunded] = await Promise.all([
    prisma.$queryRaw<{ period: string; orders: bigint; gross: bigint; discount: bigint; shipping: bigint; tax: bigint }[]>`
      SELECT to_char(date_trunc(${unit}, "paidAt" + ${istShift()}), 'YYYY-MM-DD') AS period,
             COUNT(*) AS orders, SUM("grandTotal") AS gross, SUM("discountTotal") AS discount,
             SUM("shippingTotal") AS shipping, SUM("taxTotal") AS tax
      FROM "Order"
      WHERE "paidAt" >= ${r.from}::timestamp AND "paidAt" < ${r.to}::timestamp
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ period: string; refunds: bigint }[]>`
      SELECT to_char(date_trunc(${unit}, "processedAt" + ${istShift()}), 'YYYY-MM-DD') AS period, SUM("amount") AS refunds
      FROM "Refund"
      WHERE "status" = 'PROCESSED' AND "processedAt" >= ${r.from}::timestamp AND "processedAt" < ${r.to}::timestamp
      GROUP BY 1`,
  ]);

  const refundBy = new Map(refunded.map((x) => [x.period, n(x.refunds)]));
  const keys = [...new Set([...paid.map((p) => p.period), ...refunded.map((x) => x.period)])].sort();
  const byPeriod = new Map(paid.map((p) => [p.period, p]));
  const rows = keys.map((period) => {
    const p = byPeriod.get(period);
    const gross = n(p?.gross);
    const orders = n(p?.orders);
    const refunds = refundBy.get(period) ?? 0;
    return {
      period,
      orders,
      gross,
      discounts: n(p?.discount),
      shipping: n(p?.shipping),
      tax: n(p?.tax),
      refunds,
      net: gross - refunds,
      aov: orders > 0 ? Math.round(gross / orders) : 0,
    };
  });
  const sum = (k: 'orders' | 'gross' | 'discounts' | 'shipping' | 'tax' | 'refunds' | 'net') => rows.reduce((a, x) => a + x[k], 0);
  const orders = sum('orders');
  const { rows: out, truncated } = capped(rows, o.limit);
  return {
    name: 'sales',
    title: `Sales by ${o.granularity ?? 'day'}`,
    columns: [
      { key: 'period', label: o.granularity === 'month' ? 'Month starting' : o.granularity === 'week' ? 'Week starting' : 'Day', type: 'date' },
      { key: 'orders', label: 'Paid orders', type: 'int' },
      { key: 'gross', label: 'Gross sales', type: 'money' },
      { key: 'discounts', label: 'Discounts', type: 'money' },
      { key: 'shipping', label: 'Delivery charges', type: 'money' },
      { key: 'tax', label: 'GST included', type: 'money' },
      { key: 'refunds', label: 'Refunds', type: 'money' },
      { key: 'net', label: 'Net revenue', type: 'money' },
      { key: 'aov', label: 'Avg order', type: 'money' },
    ],
    rows: out,
    totals: { period: 'Total', orders, gross: sum('gross'), discounts: sum('discounts'), shipping: sum('shipping'), tax: sum('tax'), refunds: sum('refunds'), net: sum('net'), aov: orders > 0 ? Math.round(sum('gross') / orders) : 0 },
    truncated,
  };
}

// ───────────────────────── Products ─────────────────────────

async function products(r: Range, o: ReportOptions): Promise<Report> {
  const rows = await prisma.$queryRaw<{ productId: string; name: string; orders: bigint; units: bigint; returned: bigint; revenue: bigint }[]>`
    SELECT oi."productId", MAX(oi."productName") AS name,
           COUNT(DISTINCT oi."orderId") AS orders,
           SUM(oi."quantity") AS units,
           COALESCE(SUM(oi."quantity") FILTER (WHERE o."fulfilmentStatus" = 'RETURNED'), 0) AS returned,
           SUM(oi."lineTotal") AS revenue
    FROM "OrderItem" oi
    JOIN "Order" o ON o."id" = oi."orderId"
    WHERE o."paidAt" >= ${r.from}::timestamp AND o."paidAt" < ${r.to}::timestamp AND o."fulfilmentStatus" <> 'CANCELLED'
    GROUP BY oi."productId"
    ORDER BY SUM(oi."lineTotal") DESC, MAX(oi."productName") ASC
    LIMIT ${o.limit + 1}`;
  const shaped = rows.map((p) => ({ product: p.name, orders: n(p.orders), units: n(p.units), returned: n(p.returned), revenue: n(p.revenue) }));
  const { rows: out, truncated } = capped(shaped, o.limit);
  return {
    name: 'products',
    title: 'Product performance',
    columns: [
      { key: 'product', label: 'Product', type: 'text' },
      { key: 'orders', label: 'Orders', type: 'int' },
      { key: 'units', label: 'Units sold', type: 'int' },
      { key: 'returned', label: 'Units returned', type: 'int' },
      { key: 'revenue', label: 'Revenue (item prices)', type: 'money' },
    ],
    rows: out,
    totals: { product: 'Total', orders: null, units: out.reduce((a, x) => a + x.units, 0), returned: out.reduce((a, x) => a + x.returned, 0), revenue: out.reduce((a, x) => a + x.revenue, 0) },
    truncated,
  };
}

// ───────────────────────── Inventory ─────────────────────────

async function inventory(_r: Range, o: ReportOptions): Promise<Report> {
  const rows = await prisma.$queryRaw<
    { sku: string; name: string; size: string | null; colour: string | null; onHand: number; reserved: number; threshold: number; price: number; active: boolean; productStatus: string }[]
  >`
    SELECT v."sku", p."name", v."size", v."colour", COALESCE(i."onHand", 0) AS "onHand", COALESCE(i."reserved", 0) AS reserved,
           COALESCE(i."lowStockThreshold", 5) AS threshold, COALESCE(v."priceOverride", p."effectivePrice") AS price,
           v."isActive" AS active, p."status" AS "productStatus"
    FROM "ProductVariant" v
    JOIN "Product" p ON p."id" = v."productId"
    LEFT JOIN "Inventory" i ON i."variantId" = v."id"
    WHERE p."status" <> 'ARCHIVED' AND v."isActive"
    ORDER BY (COALESCE(i."onHand", 0) - COALESCE(i."reserved", 0)) ASC, p."name" ASC, v."sku" ASC`;
  const shaped = rows
    .map((v) => {
      const available = v.onHand - v.reserved;
      const status = available <= 0 ? 'Out of stock' : available <= v.threshold ? 'Low' : 'OK';
      return { sku: v.sku, product: v.name, variant: [v.colour, v.size].filter(Boolean).join(' / ') || '—', onHand: v.onHand, reserved: v.reserved, available, threshold: v.threshold, status, value: v.onHand * v.price };
    })
    .filter((v) => !o.lowStockOnly || v.status !== 'OK');
  const { rows: out, truncated } = capped(shaped, o.limit);
  return {
    name: 'inventory',
    title: o.lowStockOnly ? 'Low and out-of-stock items' : 'Inventory',
    columns: [
      { key: 'sku', label: 'SKU', type: 'text' },
      { key: 'product', label: 'Product', type: 'text' },
      { key: 'variant', label: 'Variant', type: 'text' },
      { key: 'onHand', label: 'On hand', type: 'int' },
      { key: 'reserved', label: 'Reserved', type: 'int' },
      { key: 'available', label: 'Available', type: 'int' },
      { key: 'threshold', label: 'Alert at', type: 'int' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'value', label: 'Stock value (selling price)', type: 'money' },
    ],
    rows: out,
    totals: { sku: 'Total', onHand: shaped.reduce((a, x) => a + x.onHand, 0), reserved: shaped.reduce((a, x) => a + x.reserved, 0), available: shaped.reduce((a, x) => a + x.available, 0), value: shaped.reduce((a, x) => a + x.value, 0) },
    truncated,
  };
}

// ───────────────────────── Payments and refunds ─────────────────────────

async function payments(r: Range, o: ReportOptions): Promise<Report> {
  const [paid, refunds] = await Promise.all([
    prisma.payment.findMany({
      where: { capturedAt: { gte: r.from, lt: r.to }, status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } },
      select: { id: true, amount: true, method: true, providerPaymentId: true, capturedAt: true, order: { select: { orderNumber: true } } },
      take: o.limit + 1,
      orderBy: { capturedAt: 'desc' },
    }),
    prisma.refund.findMany({
      where: { processedAt: { gte: r.from, lt: r.to }, status: 'PROCESSED' },
      select: { id: true, amount: true, source: true, reason: true, providerRefundId: true, processedAt: true, payment: { select: { order: { select: { orderNumber: true } } } } },
      take: o.limit + 1,
      orderBy: { processedAt: 'desc' },
    }),
  ]);
  const shaped = [
    ...paid.map((p) => ({ at: p.capturedAt as Date, type: 'Payment', order: p.order.orderNumber, detail: p.method ?? 'online', amount: p.amount, reference: p.providerPaymentId })),
    ...refunds.map((f) => ({ at: f.processedAt as Date, type: 'Refund', order: f.payment.order.orderNumber, detail: `${f.source}${f.reason ? `: ${f.reason}` : ''}`, amount: -f.amount, reference: f.providerRefundId })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  const { rows: out, truncated } = capped(shaped, o.limit);
  const received = out.filter((x) => x.amount > 0).reduce((a, x) => a + x.amount, 0);
  const returned = out.filter((x) => x.amount < 0).reduce((a, x) => a + x.amount, 0);
  return {
    name: 'payments',
    title: 'Payments and refunds',
    columns: [
      { key: 'at', label: 'When (IST)', type: 'datetime' },
      { key: 'type', label: 'Type', type: 'text' },
      { key: 'order', label: 'Order', type: 'text' },
      { key: 'detail', label: 'Method / reason', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'reference', label: 'Gateway reference', type: 'text' },
    ],
    rows: out,
    totals: { at: 'Net', type: null, order: null, detail: `${istLabel(received)} in, ${istLabel(-returned)} out`, amount: received + returned, reference: null },
    truncated,
  };
}

const istLabel = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ───────────────────────── Delivery ─────────────────────────

async function delivery(r: Range, o: ReportOptions): Promise<Report> {
  const rows = await prisma.$queryRaw<
    { partner: string | null; email: string; city: string | null; assigned: bigint; delivered: bigint; failed: bigint; returned: bigint; rejected: bigint; minutes: number | null; earnings: bigint }[]
  >`
    SELECT pr."fullName" AS partner, pr."email", dp."serviceCity" AS city,
      (SELECT COUNT(*) FROM "DeliveryAssignment" a WHERE a."partnerId" = dp."id" AND a."assignedAt" >= ${r.from}::timestamp AND a."assignedAt" < ${r.to}::timestamp) AS assigned,
      (SELECT COUNT(*) FROM "DeliveryAssignment" a WHERE a."partnerId" = dp."id" AND a."status" = 'DELIVERED' AND a."deliveredAt" >= ${r.from}::timestamp AND a."deliveredAt" < ${r.to}::timestamp) AS delivered,
      (SELECT COUNT(*) FROM "DeliveryStatusHistory" h JOIN "DeliveryAssignment" a ON a."id" = h."assignmentId" WHERE a."partnerId" = dp."id" AND h."status" = 'FAILED' AND h."createdAt" >= ${r.from}::timestamp AND h."createdAt" < ${r.to}::timestamp) AS failed,
      (SELECT COUNT(*) FROM "DeliveryAssignment" a WHERE a."partnerId" = dp."id" AND a."status" = 'RETURNED_TO_ORIGIN' AND a."assignedAt" >= ${r.from}::timestamp AND a."assignedAt" < ${r.to}::timestamp) AS returned,
      (SELECT COUNT(*) FROM "DeliveryAssignment" a WHERE a."partnerId" = dp."id" AND a."status" = 'REJECTED' AND a."assignedAt" >= ${r.from}::timestamp AND a."assignedAt" < ${r.to}::timestamp) AS rejected,
      (SELECT AVG(EXTRACT(EPOCH FROM (a."deliveredAt" - a."pickedUpAt")) / 60)::float8 FROM "DeliveryAssignment" a WHERE a."partnerId" = dp."id" AND a."status" = 'DELIVERED' AND a."pickedUpAt" IS NOT NULL AND a."deliveredAt" >= ${r.from}::timestamp AND a."deliveredAt" < ${r.to}::timestamp) AS minutes,
      (SELECT COALESCE(SUM(a."payoutAmount"), 0) FROM "DeliveryAssignment" a WHERE a."partnerId" = dp."id" AND a."status" = 'DELIVERED' AND a."deliveredAt" >= ${r.from}::timestamp AND a."deliveredAt" < ${r.to}::timestamp) AS earnings
    FROM "DeliveryPartner" dp
    JOIN "Profile" pr ON pr."id" = dp."userId"
    WHERE dp."status" IN ('APPROVED', 'SUSPENDED')
    ORDER BY pr."fullName" ASC NULLS LAST, pr."email" ASC`;
  const shaped = rows.map((x) => {
    const delivered = n(x.delivered);
    const failed = n(x.failed);
    return {
      partner: x.partner ?? x.email,
      city: x.city,
      assigned: n(x.assigned),
      delivered,
      failed,
      returned: n(x.returned),
      rejected: n(x.rejected),
      successRate: delivered + failed > 0 ? Math.round((delivered / (delivered + failed)) * 1000) / 10 : null,
      minutes: x.minutes === null ? null : Math.round(x.minutes),
      earnings: n(x.earnings),
    };
  });
  const { rows: out, truncated } = capped(shaped, o.limit);
  return {
    name: 'delivery',
    title: 'Delivery performance',
    columns: [
      { key: 'partner', label: 'Partner', type: 'text' },
      { key: 'city', label: 'City', type: 'text' },
      { key: 'assigned', label: 'Assigned', type: 'int' },
      { key: 'delivered', label: 'Delivered', type: 'int' },
      { key: 'failed', label: 'Failed attempts', type: 'int' },
      { key: 'returned', label: 'Returned to origin', type: 'int' },
      { key: 'rejected', label: 'Declined', type: 'int' },
      { key: 'successRate', label: 'Delivered ÷ attempts (%)', type: 'percent' },
      { key: 'minutes', label: 'Avg minutes pickup→door', type: 'int' },
      { key: 'earnings', label: 'Earned', type: 'money' },
    ],
    rows: out,
    totals: { partner: 'Total', city: null, assigned: out.reduce((a, x) => a + x.assigned, 0), delivered: out.reduce((a, x) => a + x.delivered, 0), failed: out.reduce((a, x) => a + x.failed, 0), returned: out.reduce((a, x) => a + x.returned, 0), rejected: out.reduce((a, x) => a + x.rejected, 0), successRate: null, minutes: null, earnings: out.reduce((a, x) => a + x.earnings, 0) },
    truncated,
  };
}

export const REPORTS: Record<ReportName, (r: Range, o: ReportOptions) => Promise<Report>> = { sales, products, inventory, payments, delivery };

// ───────────────────────── CSV ─────────────────────────

function cell(type: ColumnType, value: string | number | Date | null | undefined): CsvCell {
  if (value === null || value === undefined) return '';
  if (type === 'money' && typeof value === 'number') return Math.round(value) / 100; // rupees, e.g. 1499.5
  if (type === 'datetime' && value instanceof Date) return istDateTimeString(value);
  return value;
}

/** The report exactly as shown on screen, as a spreadsheet-safe CSV (the totals row is the last line). */
export function reportToCsv(report: Report): string {
  const headers = report.columns.map((c) => (c.type === 'money' ? `${c.label} (INR)` : c.label));
  const body = report.rows.map((row) => report.columns.map((c) => cell(c.type, row[c.key])));
  if (report.totals) body.push(report.columns.map((c) => cell(c.type, report.totals![c.key])));
  return toCsv(headers, body);
}
