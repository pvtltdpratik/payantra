import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const IDS = {
  admin: '00000000-0000-4000-8000-0000000000a1',
  alice: '00000000-0000-4000-8000-0000000000c1',
  bob: '00000000-0000-4000-8000-0000000000c2',
  carol: '00000000-0000-4000-8000-0000000000c3',
  dave: '00000000-0000-4000-8000-0000000000c4',
  erin: '00000000-0000-4000-8000-0000000000c5',
} as const;

vi.mock('jose', () => ({
  createRemoteJWKSet: () => ({}),
  jwtVerify: async (token: string) => {
    const sub = (IDS as Record<string, string>)[token];
    if (!sub) throw new Error('invalid token');
    return { payload: { sub, email: `${token}@example.test` } };
  },
}));

const { createApp } = await import('../app.js');
const { prisma } = await import('../config/prisma.js');
const { makeCategory, makeProduct, resetDb } = await import('./helpers.js');
const { sim, simState } = await import('./commerce-helpers.js');

const app = createApp();
const as = (token: string) => ({
  get: (p: string) => request(app).get(`/api/v1${p}`).set('Authorization', `Bearer ${token}`),
  post: (p: string, b?: object) => request(app).post(`/api/v1${p}`).set('Authorization', `Bearer ${token}`).send(b),
  put: (p: string, b?: object) => request(app).put(`/api/v1${p}`).set('Authorization', `Bearer ${token}`).send(b),
  patch: (p: string, b?: object) => request(app).patch(`/api/v1${p}`).set('Authorization', `Bearer ${token}`).send(b),
  delete: (p: string) => request(app).delete(`/api/v1${p}`).set('Authorization', `Bearer ${token}`),
});
type Client = ReturnType<typeof as>;
const admin = as('admin');

let category: Awaited<ReturnType<typeof makeCategory>>;

beforeEach(async () => {
  await resetDb();
  await sim('reset');
  await prisma.profile.createMany({
    data: [
      { id: IDS.admin, email: 'admin@example.test', role: 'ADMIN' },
      ...(['alice', 'bob', 'carol', 'dave', 'erin'] as const).map((n) => ({ id: IDS[n], email: `${n}@example.test` })),
    ],
  });
  category = await makeCategory('Sarees');
});

async function sellable(opts: { price?: number; onHand?: number; name?: string } = {}) {
  const p = await makeProduct({
    name: opts.name ?? 'Silk Saree',
    categoryId: category.id,
    basePrice: opts.price ?? 100_000,
    variants: [{ sku: `SKU-${randomUUID().slice(0, 8).toUpperCase()}`, size: 'M', colour: 'Red', onHand: opts.onHand ?? 10 }],
  });
  return { productId: p.id, variantId: p.variants[0].id, name: p.name };
}

const ADDRESS = { fullName: 'Asha Rao', phone: '9876543210', line1: '12 MG Road', city: 'Pune', state: 'Maharashtra', postalCode: '411001' };

/** Fills the cart and returns the response of POST /checkout. */
async function checkout(c: Client, lines: { variantId: string; quantity?: number }[], opts: { method?: 'RAZORPAY' | 'COD'; key?: string; addressId?: string } = {}) {
  for (const l of lines) await c.post('/cart/items', { variantId: l.variantId, quantity: l.quantity ?? 1 });
  const addressId = opts.addressId ?? (await c.post('/addresses', ADDRESS)).body.data.id;
  return c.post('/checkout', { addressId, paymentMethod: opts.method ?? 'RAZORPAY', idempotencyKey: opts.key ?? randomUUID() });
}

const inventoryOf = (variantId: string) => prisma.inventory.findUniqueOrThrow({ where: { variantId } });

describe('checkout — online payment', () => {
  it('creates the order, reserves stock and opens a Razorpay order for exactly the payable amount', async () => {
    const a = await sellable({ price: 150_000, name: 'Banarasi' });
    const b = await sellable({ price: 50_000, name: 'Dupatta' });
    const alice = as('alice');

    const res = await checkout(alice, [{ variantId: a.variantId, quantity: 2 }, { variantId: b.variantId }]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { order, payment } = res.body.data;

    // 2×1500 + 1×500 = 3500 → above the ₹2,999 free-shipping threshold
    expect(order).toMatchObject({ grandTotal: 350_000, paymentMethod: 'RAZORPAY', paymentStatus: 'PENDING', fulfilmentStatus: 'PLACED' });
    expect(order.orderNumber).toMatch(/^PYN-\d{6}-[A-Z2-9]{6}$/);
    expect(payment).toMatchObject({ keyId: 'rzp_test_dummy', amount: 350_000, currency: 'INR' });
    expect(payment.razorpayOrderId).toMatch(/^order_/);
    expect(JSON.stringify(res.body)).not.toContain('dummy_secret'); // the key SECRET never reaches the browser

    // Stock is reserved, not yet sold.
    expect(await inventoryOf(a.variantId)).toMatchObject({ onHand: 10, reserved: 2 });
    expect(await inventoryOf(b.variantId)).toMatchObject({ onHand: 10, reserved: 1 });
    expect(await prisma.stockMovement.count({ where: { orderId: order.id, type: 'RESERVED' } })).toBe(2);

    // Snapshots: the order no longer depends on the live catalogue.
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true, payments: true } });
    expect(saved.items.map((i) => [i.productName, i.unitPrice, i.quantity, i.lineTotal]).sort()).toEqual([
      ['Banarasi', 150_000, 2, 300_000],
      ['Dupatta', 50_000, 1, 50_000],
    ]);
    expect(saved).toMatchObject({ shipFullName: 'Asha Rao', shipPostalCode: '411001', subtotal: 350_000, shippingTotal: 0 });
    expect(saved.payments).toHaveLength(1);
    expect(saved.payments[0]).toMatchObject({ providerOrderId: payment.razorpayOrderId, amount: 350_000, status: 'PENDING' });
    const minutes = (saved.stockExpiresAt!.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);

    // The provider was asked for the server-computed amount, tagged with our order number.
    const rz = (await simState()).orders;
    expect(rz).toHaveLength(1);
    expect(rz[0]).toMatchObject({ amount: 350_000, currency: 'INR', receipt: order.orderNumber });

    // The cart is kept until payment succeeds, so a failed payment loses nothing.
    expect((await alice.get('/cart')).body.data.items).toHaveLength(2);
  });

  it('charges shipping under the free threshold, and the database agrees with the total', async () => {
    const a = await sellable({ price: 100_000 });
    const res = await checkout(as('alice'), [{ variantId: a.variantId }]);
    expect(res.body.data.order.grandTotal).toBe(109_900);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: res.body.data.order.id } });
    expect(o.grandTotal).toBe(o.subtotal - o.discountTotal + o.shippingTotal);
  });

  it('prices from the database at the moment of checkout, ignoring the price in the cart view', async () => {
    const a = await sellable({ price: 100_000 });
    const alice = as('alice');
    await alice.post('/cart/items', { variantId: a.variantId, quantity: 1 });
    await prisma.product.update({ where: { id: a.productId }, data: { basePrice: 80_000, effectivePrice: 80_000 } });

    const addressId = (await alice.post('/addresses', ADDRESS)).body.data.id;
    const res = await alice.post('/checkout', { addressId, paymentMethod: 'RAZORPAY', idempotencyKey: randomUUID() });
    expect(res.body.data.order.grandTotal).toBe(80_000 + 9_900);
  });

  it('refuses any client-supplied money fields', async () => {
    const a = await sellable();
    const alice = as('alice');
    await alice.post('/cart/items', { variantId: a.variantId, quantity: 1 });
    const addressId = (await alice.post('/addresses', ADDRESS)).body.data.id;
    for (const extra of [{ amount: 1 }, { grandTotal: 100 }, { discountTotal: 99_999 }, { shippingTotal: 0 }, { items: [] }]) {
      const res = await alice.post('/checkout', { addressId, paymentMethod: 'RAZORPAY', idempotencyKey: randomUUID(), ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }
    expect(await prisma.order.count()).toBe(0);
    expect((await simState()).orders).toHaveLength(0);
  });

  it('applies a coupon, records it on the order and counts the redemption', async () => {
    const a = await sellable({ price: 400_000 });
    await admin.post('/admin/coupons', {
      code: 'SAVE10',
      discountType: 'PERCENTAGE',
      discountValue: 10,
      startsAt: new Date(Date.now() - 1e6).toISOString(),
      endsAt: new Date(Date.now() + 1e9).toISOString(),
    });
    const alice = as('alice');
    await alice.post('/cart/items', { variantId: a.variantId, quantity: 1 });
    await alice.put('/cart/coupon', { code: 'SAVE10' });
    const addressId = (await alice.post('/addresses', ADDRESS)).body.data.id;

    const res = await alice.post('/checkout', { addressId, paymentMethod: 'RAZORPAY', idempotencyKey: randomUUID() });
    expect(res.body.data.order.grandTotal).toBe(360_000); // 4000 − 400, free shipping
    const o = await prisma.order.findUniqueOrThrow({ where: { id: res.body.data.order.id } });
    expect(o).toMatchObject({ couponCode: 'SAVE10', discountTotal: 40_000 });
    expect((await prisma.coupon.findUniqueOrThrow({ where: { code: 'SAVE10' } })).usedCount).toBe(1);
  });

  it('enforces a coupon’s overall usage limit across simultaneous checkouts', async () => {
    await admin.post('/admin/coupons', {
      code: 'LASTONE',
      discountType: 'FLAT',
      discountValue: 10_000,
      usageLimit: 1,
      startsAt: new Date(Date.now() - 1e6).toISOString(),
      endsAt: new Date(Date.now() + 1e9).toISOString(),
    });
    const a = await sellable({ price: 400_000, onHand: 50 });
    const shoppers = (['alice', 'bob', 'carol'] as const).map((n) => as(n));
    const prepared = await Promise.all(
      shoppers.map(async (c) => {
        await c.post('/cart/items', { variantId: a.variantId, quantity: 1 });
        await c.put('/cart/coupon', { code: 'LASTONE' });
        return { c, addressId: (await c.post('/addresses', ADDRESS)).body.data.id as string };
      }),
    );
    const results = await Promise.all(
      prepared.map(({ c, addressId }) => c.post('/checkout', { addressId, paymentMethod: 'RAZORPAY', idempotencyKey: randomUUID() })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 422)).toHaveLength(2);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { code: 'LASTONE' } })).usedCount).toBe(1);
    // The losers did not leave stock reserved behind.
    expect((await inventoryOf(a.variantId)).reserved).toBe(1);
  });

  it('rejects an empty cart, a missing address and someone else’s address', async () => {
    const alice = as('alice');
    const bob = as('bob');
    const addressId = (await alice.post('/addresses', ADDRESS)).body.data.id;
    expect((await alice.post('/checkout', { addressId, paymentMethod: 'RAZORPAY', idempotencyKey: randomUUID() })).body.error.message).toMatch(/cart is empty/i);

    const a = await sellable();
    await bob.post('/cart/items', { variantId: a.variantId, quantity: 1 });
    // Bob tries to ship to Alice's saved address.
    expect((await bob.post('/checkout', { addressId, paymentMethod: 'RAZORPAY', idempotencyKey: randomUUID() })).status).toBe(422);
    expect((await bob.post('/checkout', { addressId: randomUUID(), paymentMethod: 'RAZORPAY', idempotencyKey: randomUUID() })).status).toBe(422);
    expect(await prisma.order.count()).toBe(0);
    expect((await inventoryOf(a.variantId)).reserved).toBe(0);
  });

  it('blocks checkout when stock changed since the item was added, and says which item', async () => {
    const a = await sellable({ onHand: 5, name: 'Popular' });
    const alice = as('alice');
    await alice.post('/cart/items', { variantId: a.variantId, quantity: 4 });
    await prisma.inventory.update({ where: { variantId: a.variantId }, data: { onHand: 2 } });

    const res = await alice.post('/checkout', {
      addressId: (await alice.post('/addresses', ADDRESS)).body.data.id,
      paymentMethod: 'RAZORPAY',
      idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe(409);
    expect(res.body.error.details[0]).toMatchObject({ name: 'Popular', issue: 'INSUFFICIENT_STOCK', available: 2 });
    expect(await prisma.order.count()).toBe(0);
  });
});

describe('checkout — idempotency', () => {
  it('returns the same order and the same Razorpay order for a repeated key', async () => {
    const a = await sellable();
    const alice = as('alice');
    const key = randomUUID();
    const first = await checkout(alice, [{ variantId: a.variantId }], { key });
    const second = await alice.post('/checkout', { addressId: (await alice.get('/addresses')).body.data[0].id, paymentMethod: 'RAZORPAY', idempotencyKey: key });

    expect(second.status).toBe(201);
    expect(second.body.data.order.id).toBe(first.body.data.order.id);
    expect(second.body.data.payment.razorpayOrderId).toBe(first.body.data.payment.razorpayOrderId);
    expect(await prisma.order.count()).toBe(1);
    expect((await simState()).orders).toHaveLength(1);
    expect((await inventoryOf(a.variantId)).reserved).toBe(1); // reserved once, not twice
  });

  it('survives a burst of simultaneous identical requests (double-click, retry storm)', async () => {
    const a = await sellable();
    const alice = as('alice');
    await alice.post('/cart/items', { variantId: a.variantId, quantity: 1 });
    const addressId = (await alice.post('/addresses', ADDRESS)).body.data.id;
    const key = randomUUID();

    const results = await Promise.all(Array.from({ length: 6 }, () => alice.post('/checkout', { addressId, paymentMethod: 'RAZORPAY', idempotencyKey: key })));
    expect(results.every((r) => r.status === 201), JSON.stringify(results.map((r) => [r.status, r.body?.error?.message ?? r.body?.error?.code]))).toBe(true);
    expect(new Set(results.map((r) => r.body.data.order.id)).size).toBe(1);
    expect(await prisma.order.count()).toBe(1);
    expect((await inventoryOf(a.variantId)).reserved).toBe(1);
  });

  it('does not let another shopper replay or probe a key', async () => {
    const a = await sellable();
    const key = randomUUID();
    await checkout(as('alice'), [{ variantId: a.variantId }], { key });

    const bob = as('bob');
    const addressId = (await bob.post('/addresses', ADDRESS)).body.data.id;
    const res = await bob.post('/checkout', { addressId, paymentMethod: 'RAZORPAY', idempotencyKey: key });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).not.toContain('PYN-'); // nothing about Alice's order leaks
  });

  it('rejects malformed idempotency keys', async () => {
    const alice = as('alice');
    const addressId = (await alice.post('/addresses', ADDRESS)).body.data.id;
    for (const key of ['short', 'has spaces and is long enough', '<script>alert(1)</script>0000']) {
      expect((await alice.post('/checkout', { addressId, paymentMethod: 'RAZORPAY', idempotencyKey: key })).status).toBe(400);
    }
  });
});

describe('checkout — overselling', () => {
  it('never sells more units than exist, however many shoppers race for them', async () => {
    const a = await sellable({ onHand: 3, name: 'Last three' });
    const shoppers = (['alice', 'bob', 'carol', 'dave', 'erin'] as const).map((n) => as(n));

    // Everyone gets the item into their cart while stock still shows 3, then all check out at once.
    const prepared = await Promise.all(
      shoppers.map(async (c) => {
        await c.post('/cart/items', { variantId: a.variantId, quantity: 1 });
        return { c, addressId: (await c.post('/addresses', ADDRESS)).body.data.id as string };
      }),
    );
    const results = await Promise.all(
      prepared.map(({ c, addressId }) => c.post('/checkout', { addressId, paymentMethod: 'RAZORPAY', idempotencyKey: randomUUID() })),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    const inv = await inventoryOf(a.variantId);
    expect(inv).toMatchObject({ onHand: 3, reserved: 3 });
    expect(inv.reserved).toBeLessThanOrEqual(inv.onHand);
    expect(await prisma.order.count()).toBe(3);
    // Only the winners reached the payment provider.
    expect((await simState()).orders).toHaveLength(3);
  });

  it('rolls back every reservation when one line of a multi-item order cannot be filled', async () => {
    const plenty = await sellable({ onHand: 10, name: 'Plenty' });
    const scarce = await sellable({ onHand: 1, name: 'Scarce' });
    const alice = as('alice');
    const bob = as('bob');
    await alice.post('/cart/items', { variantId: plenty.variantId, quantity: 2 });
    await alice.post('/cart/items', { variantId: scarce.variantId, quantity: 1 });
    const aliceAddr = (await alice.post('/addresses', ADDRESS)).body.data.id;

    // Bob takes the last "Scarce" first.
    await checkout(bob, [{ variantId: scarce.variantId }]);

    const res = await alice.post('/checkout', { addressId: aliceAddr, paymentMethod: 'RAZORPAY', idempotencyKey: randomUUID() });
    expect(res.status).toBe(409);
    expect((await inventoryOf(plenty.variantId)).reserved).toBe(0); // Alice's reservation on "Plenty" did not stick
    expect(await prisma.order.count({ where: { userId: IDS.alice } })).toBe(0);
  });
});

describe('checkout — Cash on Delivery', () => {
  it('is unavailable until an admin enables it', async () => {
    const a = await sellable();
    const res = await checkout(as('alice'), [{ variantId: a.variantId }], { method: 'COD' });
    expect(res.status).toBe(422);
    expect((await as('alice').get('/checkout/options')).body.data.codEnabled).toBe(false);
  });

  it('places a firm order: stock sold immediately, cart emptied, no provider call', async () => {
    await admin.put('/admin/settings/payments', { codEnabled: true, codMaxOrder: 500_000, reservationMinutes: 15 });
    const a = await sellable({ price: 100_000 });
    const alice = as('alice');
    const res = await checkout(alice, [{ variantId: a.variantId, quantity: 2 }], { method: 'COD' });

    expect(res.status).toBe(201);
    expect(res.body.data.payment).toBeNull();
    expect(res.body.data.order).toMatchObject({ paymentMethod: 'COD', paymentStatus: 'PENDING', fulfilmentStatus: 'PLACED', stockExpiresAt: null });
    expect(await inventoryOf(a.variantId)).toMatchObject({ onHand: 8, reserved: 0 });
    expect((await alice.get('/cart')).body.data.items).toEqual([]);
    expect((await simState()).orders).toHaveLength(0);
    expect(await prisma.notification.count({ where: { userId: IDS.alice } })).toBe(1);
  });

  it('refuses orders above the COD limit', async () => {
    await admin.put('/admin/settings/payments', { codEnabled: true, codMaxOrder: 200_000, reservationMinutes: 15 });
    const a = await sellable({ price: 300_000 });
    const res = await checkout(as('alice'), [{ variantId: a.variantId }], { method: 'COD' });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/limit/i);
    expect(await prisma.order.count()).toBe(0);
  });
});

describe('checkout — payment provider outage', () => {
  it('undoes the reservation and frees the key when Razorpay is down, so the shopper can simply retry', async () => {
    const a = await sellable();
    const alice = as('alice');
    await sim('fault', { match: '/orders', status: 503, count: 1 });
    const key = randomUUID();

    const failed = await checkout(alice, [{ variantId: a.variantId }], { key });
    expect(failed.status).toBe(502);
    expect(failed.body.error.code).toBe('PAYMENT_PROVIDER_ERROR');

    const o = await prisma.order.findFirstOrThrow();
    expect(o).toMatchObject({ fulfilmentStatus: 'CANCELLED', paymentStatus: 'FAILED', idempotencyKey: null });
    expect(await inventoryOf(a.variantId)).toMatchObject({ onHand: 10, reserved: 0 });
    expect((await alice.get('/cart')).body.data.items).toHaveLength(1); // cart intact

    // The provider recovers; the very same request succeeds.
    const addressId = (await alice.get('/addresses')).body.data[0].id;
    const retry = await alice.post('/checkout', { addressId, paymentMethod: 'RAZORPAY', idempotencyKey: key });
    expect(retry.status).toBe(201);
    expect(retry.body.data.payment.razorpayOrderId).toMatch(/^order_/);
    expect((await inventoryOf(a.variantId)).reserved).toBe(1);
  });

  it('hands the coupon redemption back when the payment cannot be started', async () => {
    await admin.post('/admin/coupons', {
      code: 'ONLYONE',
      discountType: 'FLAT',
      discountValue: 10_000,
      usageLimit: 1,
      startsAt: new Date(Date.now() - 1e6).toISOString(),
      endsAt: new Date(Date.now() + 1e9).toISOString(),
    });
    const a = await sellable({ price: 400_000 });
    const alice = as('alice');
    await alice.post('/cart/items', { variantId: a.variantId, quantity: 1 });
    await alice.put('/cart/coupon', { code: 'ONLYONE' });
    const addressId = (await alice.post('/addresses', ADDRESS)).body.data.id;

    await sim('fault', { match: '/orders', status: 500, count: 1 });
    expect((await alice.post('/checkout', { addressId, paymentMethod: 'RAZORPAY', idempotencyKey: randomUUID() })).status).toBe(502);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { code: 'ONLYONE' } })).usedCount).toBe(0);
  });
});
