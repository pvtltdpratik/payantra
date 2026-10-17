import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('jose', () => ({
  createRemoteJWKSet: () => ({}),
  jwtVerify: async (token: string) => {
    const ids: Record<string, string> = {
      admin: '00000000-0000-4000-8000-0000000000a1',
      alice: '00000000-0000-4000-8000-0000000000c1',
      bob: '00000000-0000-4000-8000-0000000000c2',
      carol: '00000000-0000-4000-8000-0000000000c3',
    };
    if (!ids[token]) throw new Error('invalid token');
    return { payload: { sub: ids[token], email: `${token}@example.test` } };
  },
}));

const { createApp } = await import('../app.js');
const { prisma } = await import('../config/prisma.js');
const { makeCategory, makeProduct, resetDb } = await import('./helpers.js');
const { sim } = await import('./commerce-helpers.js');
const { makeWorld, IDS } = await import('./commerce-world.js');
const { toCsv, csvCell } = await import('../lib/csv.js');
const { istDateKey, istDayStart, parseIstDate } = await import('../lib/time.js');
const request = (await import('supertest')).default;

const app = createApp();
const w = makeWorld(app, prisma, { makeCategory, makeProduct });
const { admin } = w;
const alice = w.as('alice');
const bob = w.as('bob');

beforeEach(async () => {
  await resetDb();
  await sim('reset');
  await w.reset();
});

const RANGE = 'from=2026-10-01&to=2026-10-31';
/** An instant → the IST day it falls on. 18:30Z is exactly midnight IST. */
const at = (iso: string) => new Date(iso);

async function paidOrder(customer = alice, opts: { price?: number; qty?: number; name?: string; paidAt?: string } = {}) {
  const a = await w.sellable({ price: opts.price ?? 100_000, onHand: 50, name: opts.name });
  const placed = await w.placeOnline(customer, [{ variantId: a.variantId, quantity: opts.qty ?? 1 }]);
  await w.payAndVerify(customer, placed);
  if (opts.paidAt) await prisma.order.update({ where: { id: placed.order.id }, data: { paidAt: at(opts.paidAt), createdAt: at(opts.paidAt) } });
  const order = await prisma.order.findUniqueOrThrow({ where: { id: placed.order.id } });
  return { a, id: placed.order.id, grandTotal: order.grandTotal, order };
}

const overview = async (qs = RANGE) => (await admin.get(`/admin/analytics/overview?${qs}`)).body.data;

describe('time helpers (India calendar days)', () => {
  it('splits days at midnight IST, not UTC', () => {
    expect(istDateKey(at('2026-10-16T18:29:59Z'))).toBe('2026-10-16');
    expect(istDateKey(at('2026-10-16T18:30:00Z'))).toBe('2026-10-17');
    expect(istDayStart(at('2026-10-17T03:00:00Z')).toISOString()).toBe('2026-10-16T18:30:00.000Z');
    expect(parseIstDate('2026-10-17')?.toISOString()).toBe('2026-10-16T18:30:00.000Z');
  });
  it('rejects dates that do not exist', () => {
    expect(parseIstDate('2026-02-31')).toBeNull();
    expect(parseIstDate('2026-13-01')).toBeNull();
    expect(parseIstDate('17-10-2026')).toBeNull();
  });
});

describe('CSV safety', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe('');
  });
  it('defuses spreadsheet formulas in text, but leaves real numbers alone', () => {
    for (const evil of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\t=1', '=HYPERLINK("http://evil","x")']) {
      expect(csvCell(evil).replace(/^"/, '')).toMatch(/^'/);
    }
    expect(csvCell(-12050)).toBe('-12050');
    expect(csvCell(0)).toBe('0');
  });
  it('writes a BOM and CRLF line endings', () => {
    const out = toCsv(['a', 'b'], [[1, 'x']]);
    expect(out.startsWith('﻿')).toBe(true);
    expect(out).toBe('﻿a,b\r\n1,x\r\n');
  });
});

describe('access', () => {
  it('is for admins only', async () => {
    for (const path of ['/admin/analytics/overview', '/admin/reports/sales', '/admin/customers']) {
      expect((await alice.get(path)).status).toBe(403);
      expect((await request(app).get(`/api/v1${path}`)).status).toBe(401);
    }
  });
  it('validates the date range', async () => {
    expect((await admin.get('/admin/analytics/overview?from=2026-02-31')).status).toBe(400);
    expect((await admin.get('/admin/analytics/overview?from=yesterday')).status).toBe(400);
    expect((await admin.get('/admin/analytics/overview?from=2026-10-10&to=2026-10-01')).status).toBe(400);
    expect((await admin.get('/admin/analytics/overview?from=2025-01-01&to=2026-10-01')).status).toBe(400); // over a year
    expect((await admin.get('/admin/reports/nonsense')).status).toBe(400);
  });
});

describe('overview', () => {
  it('computes sales, refunds and net revenue from real orders', async () => {
    const o1 = await paidOrder(alice, { paidAt: '2026-10-05T06:00:00Z' });
    const o2 = await paidOrder(bob, { paidAt: '2026-10-06T06:00:00Z', price: 250_000 });
    const o3 = await paidOrder(alice, { paidAt: '2026-10-06T08:00:00Z' });

    // o3 is cancelled: the money goes back, but it WAS received, so gross sales keep it and refunds subtract.
    expect((await admin.post(`/admin/orders/${o3.id}/cancel`, { reason: 'Out of stock at packing' })).status).toBe(200);
    const refund = await prisma.refund.findFirstOrThrow({ where: { payment: { orderId: o3.id } } });
    expect(refund.status).toBe('PROCESSED');
    await prisma.refund.update({ where: { id: refund.id }, data: { processedAt: at('2026-10-07T06:00:00Z') } });

    const data = await overview();
    const gross = o1.grandTotal + o2.grandTotal + o3.grandTotal;
    expect(data.totals).toMatchObject({
      grossSales: gross,
      refunds: o3.grandTotal,
      netRevenue: gross - o3.grandTotal,
      paidOrders: 3,
      averageOrderValue: Math.round(gross / 3),
    });
    expect(data.totals.taxCollected).toBe((await prisma.order.aggregate({ _sum: { taxTotal: true } }))._sum.taxTotal);
    expect(data.range).toEqual({ from: '2026-10-01', to: '2026-10-31', days: 31 });
  });

  it('counts an unpaid Cash on Delivery order only once it is delivered', async () => {
    await admin.put('/admin/settings/payments', { codEnabled: true, codMaxOrder: 5_000_000, reservationMinutes: 15 });
    const a = await w.sellable({ onHand: 5 });
    const res = await w.checkout(alice, [{ variantId: a.variantId }], { method: 'COD' });
    const id = res.body.data.order.id as string;
    await prisma.order.update({ where: { id }, data: { createdAt: at('2026-10-10T06:00:00Z') } });

    let data = await overview();
    expect(data.totals.paidOrders).toBe(0);
    expect(data.totals.grossSales).toBe(0);
    expect(data.ordersPlaced).toBe(1); // placed, not yet revenue

    await w.deliver(id, 'PLACED');
    await prisma.order.update({ where: { id }, data: { paidAt: at('2026-10-11T06:00:00Z') } });
    data = await overview();
    expect(data.totals.paidOrders).toBe(1);
    expect(data.totals.grossSales).toBe((await prisma.order.findUniqueOrThrow({ where: { id } })).grandTotal);
  });

  it('places each rupee on the right India day and zero-fills quiet days', async () => {
    // 18:29Z is 23:59 IST on the 9th; 18:30Z is 00:00 IST on the 10th.
    const a = await paidOrder(alice, { paidAt: '2026-10-09T18:29:00Z' });
    const b = await paidOrder(alice, { paidAt: '2026-10-09T18:30:00Z' });
    const data = await overview('from=2026-10-08&to=2026-10-12');

    expect(data.salesByDay.map((d: { date: string }) => d.date)).toEqual(['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12']);
    const by = Object.fromEntries(data.salesByDay.map((d: { date: string; gross: number; orders: number }) => [d.date, d]));
    expect(by['2026-10-09']).toMatchObject({ gross: a.grandTotal, orders: 1 });
    expect(by['2026-10-10']).toMatchObject({ gross: b.grandTotal, orders: 1 });
    expect(by['2026-10-08']).toMatchObject({ gross: 0, orders: 0 });
    // The chart and the headline can never disagree.
    expect(data.salesByDay.reduce((s: number, d: { gross: number }) => s + d.gross, 0)).toBe(data.totals.grossSales);
    expect(data.salesByDay.reduce((s: number, d: { net: number }) => s + d.net, 0)).toBe(data.totals.netRevenue);
  });

  it('excludes orders outside the range and compares with the previous period', async () => {
    const inRange = await paidOrder(alice, { paidAt: '2026-10-15T06:00:00Z' });
    const before = await paidOrder(alice, { paidAt: '2026-10-05T06:00:00Z', price: 300_000 });
    await paidOrder(alice, { paidAt: '2026-09-01T06:00:00Z' }); // long before

    // 10 days: 2026-10-11 … 2026-10-20; the previous 10 days are 2026-10-01 … 2026-10-10.
    const data = await overview('from=2026-10-11&to=2026-10-20');
    expect(data.totals.grossSales).toBe(inRange.grandTotal);
    expect(data.previous).toMatchObject({ from: '2026-10-01', to: '2026-10-10' });
    expect(data.previous.totals.grossSales).toBe(before.grandTotal);
  });

  it('breaks orders down by status and counts customers, partners and pending work', async () => {
    await paidOrder(alice, { paidAt: '2026-10-05T06:00:00Z' });
    const second = await paidOrder(bob, { paidAt: '2026-10-05T07:00:00Z' });
    await w.deliver(second.id);
    // A return waiting for a decision, and a refund waiting for the provider.
    await prisma.returnRequest.create({ data: { orderId: second.id, userId: IDS.bob, type: 'RETURN', reason: 'Too big', status: 'REQUESTED' } });
    const pay = await prisma.payment.findFirstOrThrow({ where: { orderId: second.id } });
    await prisma.refund.create({ data: { paymentId: pay.id, amount: 100, status: 'PENDING', source: 'ADMIN', idempotencyKey: 'pending-1' } });
    await prisma.supportRequest.create({ data: { userId: IDS.alice, subject: 'Where is my order', message: 'It has been three days' } });
    await prisma.order.updateMany({ data: { createdAt: at('2026-10-05T06:00:00Z') } });

    const data = await overview();
    expect(data.orderStatus).toMatchObject({ PAYMENT_CONFIRMED: 1, DELIVERED: 1 });
    expect(data.ordersPlaced).toBe(2);
    expect(data.customers.total).toBe(3); // alice, bob, carol
    expect(data.pending).toMatchObject({ returnRequests: 1, refundsAwaitingConfirmation: 1, supportRequests: 1 });
    expect(data.partners).toMatchObject({ approved: 0, online: 0, pendingApplications: 0 });
    expect(data.recentTransactions.length).toBeGreaterThanOrEqual(2);
    expect(data.recentTransactions.every((t: { type: string; amount: number }) => (t.type === 'REFUND' ? t.amount < 0 : t.amount > 0))).toBe(true);
  });

  it('lists low-stock items (active products only) from live inventory', async () => {
    const low = await w.sellable({ onHand: 3, name: 'Nearly Gone Kurta' });
    await w.sellable({ onHand: 40, name: 'Plenty Kurta' });
    const archived = await w.sellable({ onHand: 1, name: 'Archived Kurta' });
    await prisma.product.update({ where: { id: archived.productId }, data: { status: 'ARCHIVED' } });
    await prisma.inventory.update({ where: { variantId: low.variantId }, data: { lowStockThreshold: 5 } });

    const data = await overview();
    expect(data.lowStock.count).toBe(1);
    expect(data.lowStock.items[0]).toMatchObject({ name: 'Nearly Gone Kurta', onHand: 3, available: 3, lowStockThreshold: 5 });
    // Reserved units are not available: reserving makes a healthy variant "low".
    await prisma.inventory.updateMany({ where: { onHand: 40 }, data: { reserved: 37 } });
    expect((await overview()).lowStock.count).toBe(2);
  });
});

describe('reports', () => {
  it('sales: groups by day, week and month and totals match the overview', async () => {
    const a = await paidOrder(alice, { paidAt: '2026-10-05T06:00:00Z' }); // Monday 5 Oct
    const b = await paidOrder(alice, { paidAt: '2026-10-06T06:00:00Z' });
    const c = await paidOrder(alice, { paidAt: '2026-10-14T06:00:00Z' }); // the following week

    const day = (await admin.get(`/admin/reports/sales?${RANGE}&granularity=day`)).body.data;
    expect(day.rows.map((r: { period: string }) => r.period)).toEqual(['2026-10-05', '2026-10-06', '2026-10-14']);
    const week = (await admin.get(`/admin/reports/sales?${RANGE}&granularity=week`)).body.data;
    expect(week.rows.map((r: { period: string; orders: number }) => [r.period, r.orders])).toEqual([['2026-10-05', 2], ['2026-10-12', 1]]);
    const month = (await admin.get(`/admin/reports/sales?${RANGE}&granularity=month`)).body.data;
    expect(month.rows).toHaveLength(1);
    expect(month.rows[0]).toMatchObject({ period: '2026-10-01', orders: 3, gross: a.grandTotal + b.grandTotal + c.grandTotal });
    expect(month.totals).toMatchObject({ orders: 3, gross: a.grandTotal + b.grandTotal + c.grandTotal, net: a.grandTotal + b.grandTotal + c.grandTotal });
    expect(month.columns.map((x: { key: string }) => x.key)).toEqual(['period', 'orders', 'gross', 'discounts', 'shipping', 'tax', 'refunds', 'net', 'aov']);
  });

  it('products: ranks by revenue, ignores cancelled orders and counts returned units', async () => {
    const saree = await paidOrder(alice, { name: 'Zari Saree', price: 500_000, qty: 2, paidAt: '2026-10-05T06:00:00Z' });
    await paidOrder(bob, { name: 'Cotton Kurti', price: 90_000, paidAt: '2026-10-05T07:00:00Z' });
    const gone = await paidOrder(bob, { name: 'Cancelled Shawl', price: 700_000, paidAt: '2026-10-05T08:00:00Z' });
    await admin.post(`/admin/orders/${gone.id}/cancel`, { reason: 'Customer request' });
    await prisma.order.update({ where: { id: saree.id }, data: { fulfilmentStatus: 'RETURNED' } });

    const report = (await admin.get(`/admin/reports/products?${RANGE}`)).body.data;
    expect(report.rows.map((r: { product: string }) => r.product)).toEqual(['Zari Saree', 'Cotton Kurti']); // no Cancelled Shawl
    expect(report.rows[0]).toMatchObject({ units: 2, returned: 2, revenue: 1_000_000, orders: 1 });
    expect(report.rows[1]).toMatchObject({ units: 1, returned: 0, revenue: 90_000 });
  });

  it('inventory: flags out-of-stock and low items, and values stock at selling price', async () => {
    const ok = await w.sellable({ onHand: 20, name: 'Healthy', price: 100_000 });
    const low = await w.sellable({ onHand: 4, name: 'Running Low', price: 200_000 });
    const out = await w.sellable({ onHand: 0, name: 'Sold Out', price: 300_000 });
    const full = (await admin.get('/admin/reports/inventory')).body.data;
    const status = Object.fromEntries(full.rows.map((r: { product: string; status: string }) => [r.product, r.status]));
    expect(status).toEqual({ Healthy: 'OK', 'Running Low': 'Low', 'Sold Out': 'Out of stock' });
    expect(full.rows[0].product).toBe('Sold Out'); // most urgent first
    expect(full.rows.find((r: { product: string }) => r.product === 'Running Low')).toMatchObject({ onHand: 4, available: 4, value: 4 * 200_000 });
    expect(full.totals.value).toBe(20 * 100_000 + 4 * 200_000);

    const lowOnly = (await admin.get('/admin/reports/inventory?lowStockOnly=true')).body.data;
    expect(lowOnly.rows.map((r: { product: string }) => r.product)).toEqual(['Sold Out', 'Running Low']);
    void ok; void low; void out;
  });

  it('payments: lists captures and refunds in one ledger, refunds as negative amounts', async () => {
    const a = await paidOrder(alice, { paidAt: '2026-10-05T06:00:00Z' });
    await prisma.payment.updateMany({ where: { orderId: a.id }, data: { capturedAt: at('2026-10-05T06:00:00Z') } });
    await admin.post(`/admin/orders/${a.id}/refund`, { amount: 25_000, reason: 'Late delivery goodwill' });
    await prisma.refund.updateMany({ data: { processedAt: at('2026-10-06T06:00:00Z') } });

    const report = (await admin.get(`/admin/reports/payments?${RANGE}`)).body.data;
    expect(report.rows).toHaveLength(2);
    expect(report.rows[0]).toMatchObject({ type: 'Refund', amount: -25_000 }); // newest first
    expect(report.rows[1]).toMatchObject({ type: 'Payment', amount: a.grandTotal });
    expect(report.totals.amount).toBe(a.grandTotal - 25_000);
  });

  it('delivery: summarises each partner from real assignments', async () => {
    const o = await paidOrder(alice, { paidAt: '2026-10-05T06:00:00Z' });
    await prisma.profile.create({ data: { id: '00000000-0000-4000-8000-0000000000d1', email: 'rider@example.test', fullName: 'Ravi Kumar', role: 'DELIVERY_PARTNER' } });
    const partner = await prisma.deliveryPartner.create({ data: { userId: '00000000-0000-4000-8000-0000000000d1', status: 'APPROVED', serviceCity: 'Pune', perDeliveryPayout: 5000 } });
    const job = await prisma.deliveryAssignment.create({
      data: { orderId: o.id, partnerId: partner.id, status: 'DELIVERED', assignedAt: at('2026-10-05T07:00:00Z'), pickedUpAt: at('2026-10-05T08:00:00Z'), deliveredAt: at('2026-10-05T08:40:00Z'), payoutAmount: 5000 },
    });
    await prisma.deliveryStatusHistory.create({ data: { assignmentId: job.id, status: 'FAILED', createdAt: at('2026-10-05T08:20:00Z') } });

    const report = (await admin.get(`/admin/reports/delivery?${RANGE}`)).body.data;
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ partner: 'Ravi Kumar', city: 'Pune', assigned: 1, delivered: 1, failed: 1, minutes: 40, earnings: 5000, successRate: 50 });
  });

  it('exports CSV: rupees not paise, safe against formulas, never cached', async () => {
    await paidOrder(alice, { name: '=HYPERLINK("http://evil.example","Click")', price: 149_950, paidAt: '2026-10-05T06:00:00Z' });
    const res = await admin.get(`/admin/reports/products?${RANGE}&format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv; charset=utf-8/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="payantra-products-2026-10-01_to_2026-10-31\.csv"/);
    expect(res.headers['cache-control']).toBe('no-store');

    const text = res.text;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).split('\r\n');
    expect(lines[0]).toBe('Product,Orders,Units sold,Units returned,Revenue (item prices) (INR)');
    // The product name begins with "=": it must be defused, and the quotes inside it escaped.
    expect(lines[1]).toBe(`"'=HYPERLINK(""http://evil.example"",""Click"")",1,1,0,1499.5`);
    expect(lines[2]).toMatch(/^Total,/); // the totals row travels with the file
  });

  it('lets the storefront (another origin) read the file name of a download', async () => {
    const res = await admin.get(`/admin/reports/sales?${RANGE}&format=csv`).set('Origin', 'http://localhost:3000');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-expose-headers']).toMatch(/Content-Disposition/i);
    // …and a stranger's origin gets neither the data's permission nor the exposure.
    const other = await admin.get(`/admin/reports/sales?${RANGE}&format=csv`).set('Origin', 'https://evil.example');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('exports the same numbers it shows', async () => {
    await paidOrder(alice, { paidAt: '2026-10-05T06:00:00Z' });
    const json = (await admin.get(`/admin/reports/sales?${RANGE}`)).body.data;
    const csv = (await admin.get(`/admin/reports/sales?${RANGE}&format=csv`)).text.slice(1).split('\r\n');
    expect(csv[1]).toContain(String(json.rows[0].gross / 100));
    expect(csv).toHaveLength(json.rows.length + 3); // header + rows + totals + trailing newline
  });
});
