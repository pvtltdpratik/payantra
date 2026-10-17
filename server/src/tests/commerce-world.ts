import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { prisma as Prisma } from '../config/prisma.js';
import { customerPays } from './commerce-helpers.js';

export const IDS = {
  admin: '00000000-0000-4000-8000-0000000000a1',
  alice: '00000000-0000-4000-8000-0000000000c1',
  bob: '00000000-0000-4000-8000-0000000000c2',
  carol: '00000000-0000-4000-8000-0000000000c3',
} as const;

export const ADDRESS = { fullName: 'Asha Rao', phone: '9876543210', line1: '12 MG Road', city: 'Pune', state: 'Maharashtra', postalCode: '411001' };

type App = Parameters<typeof request>[0];
type Db = typeof Prisma;

/**
 * Scenario helpers shared by the commerce integration tests. The app/prisma/product helpers are
 * passed in (not imported) so each test file can install its own `jose` mock before loading them.
 */
export function makeWorld(
  app: App,
  prisma: Db,
  h: {
    makeCategory: (name: string) => Promise<{ id: string }>;
    makeProduct: (p: any) => Promise<{ id: string; name: string; variants: { id: string }[] }>;
  },
) {
  const as = (token: string) => ({
    get: (p: string) => request(app).get(`/api/v1${p}`).set('Authorization', `Bearer ${token}`),
    post: (p: string, b?: object) => request(app).post(`/api/v1${p}`).set('Authorization', `Bearer ${token}`).send(b),
    put: (p: string, b?: object) => request(app).put(`/api/v1${p}`).set('Authorization', `Bearer ${token}`).send(b),
    patch: (p: string, b?: object) => request(app).patch(`/api/v1${p}`).set('Authorization', `Bearer ${token}`).send(b),
    delete: (p: string) => request(app).delete(`/api/v1${p}`).set('Authorization', `Bearer ${token}`),
  });
  type Client = ReturnType<typeof as>;

  let categoryId: string | null = null;

  async function reset() {
    categoryId = null;
    await prisma.profile.createMany({
      data: [
        { id: IDS.admin, email: 'admin@example.test', role: 'ADMIN' },
        { id: IDS.alice, email: 'alice@example.test' },
        { id: IDS.bob, email: 'bob@example.test' },
        { id: IDS.carol, email: 'carol@example.test' },
      ],
    });
    categoryId = (await h.makeCategory('Sarees')).id;
  }

  async function sellable(opts: { price?: number; onHand?: number; name?: string; taxRate?: number } = {}) {
    const p = await h.makeProduct({
      name: opts.name ?? 'Silk Saree',
      categoryId,
      basePrice: opts.price ?? 100_000,
      variants: [{ sku: `SKU-${randomUUID().slice(0, 8).toUpperCase()}`, size: 'M', colour: 'Red', onHand: opts.onHand ?? 10 }],
    });
    if (opts.taxRate !== undefined) await prisma.product.update({ where: { id: p.id }, data: { taxRatePercent: opts.taxRate } });
    return { productId: p.id, variantId: p.variants[0].id, name: p.name };
  }

  /** Cart → address → POST /checkout. Returns the full HTTP response. */
  async function checkout(c: Client, lines: { variantId: string; quantity?: number }[], opts: { method?: 'RAZORPAY' | 'COD'; key?: string } = {}) {
    for (const l of lines) await c.post('/cart/items', { variantId: l.variantId, quantity: l.quantity ?? 1 });
    const existing = (await c.get('/addresses')).body.data as { id: string }[];
    const addressId = existing[0]?.id ?? (await c.post('/addresses', ADDRESS)).body.data.id;
    return c.post('/checkout', { addressId, paymentMethod: opts.method ?? 'RAZORPAY', idempotencyKey: opts.key ?? randomUUID() });
  }

  async function placeOnline(c: Client, lines: { variantId: string; quantity?: number }[]) {
    const res = await checkout(c, lines);
    if (res.status !== 201) throw new Error(`checkout failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.data as { order: { id: string; orderNumber: string; grandTotal: number }; payment: { razorpayOrderId: string; amount: number } };
  }

  /** The customer completes Razorpay Checkout and the browser calls verify. */
  async function payAndVerify(c: Client, placed: Awaited<ReturnType<typeof placeOnline>>) {
    const paid = await customerPays(placed.payment.razorpayOrderId);
    const res = await c.post('/payments/verify', {
      razorpay_order_id: paid.razorpay_order_id,
      razorpay_payment_id: paid.razorpay_payment_id,
      razorpay_signature: paid.razorpay_signature,
    });
    return { paid, res };
  }

  /** Walks an order through the admin pipeline to DELIVERED. */
  async function deliver(orderId: string, from: 'PAYMENT_CONFIRMED' | 'PLACED' = 'PAYMENT_CONFIRMED') {
    const steps = from === 'PLACED' ? ['PAYMENT_CONFIRMED', 'PROCESSING'] : ['PROCESSING'];
    for (const status of [...steps, 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
      const r = await as('admin').patch(`/admin/orders/${orderId}/status`, { status });
      if (r.status !== 200) throw new Error(`status ${status} failed: ${JSON.stringify(r.body)}`);
    }
  }

  const inventoryOf = (variantId: string) => prisma.inventory.findUniqueOrThrow({ where: { variantId } });
  const orderOf = (id: string) => prisma.order.findUniqueOrThrow({ where: { id }, include: { payments: { include: { refunds: true } }, items: true } });

  return { as, reset, sellable, checkout, placeOnline, payAndVerify, deliver, inventoryOf, orderOf, admin: as('admin') };
}
