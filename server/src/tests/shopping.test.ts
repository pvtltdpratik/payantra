import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const IDS = {
  admin: '00000000-0000-4000-8000-0000000000a1',
  alice: '00000000-0000-4000-8000-0000000000c1',
  bob: '00000000-0000-4000-8000-0000000000c2',
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

const app = createApp();
const as = (token: string) => ({
  get: (p: string) => request(app).get(`/api/v1${p}`).set('Authorization', `Bearer ${token}`),
  post: (p: string, b?: object) => request(app).post(`/api/v1${p}`).set('Authorization', `Bearer ${token}`).send(b),
  put: (p: string, b?: object) => request(app).put(`/api/v1${p}`).set('Authorization', `Bearer ${token}`).send(b),
  patch: (p: string, b?: object) => request(app).patch(`/api/v1${p}`).set('Authorization', `Bearer ${token}`).send(b),
  delete: (p: string) => request(app).delete(`/api/v1${p}`).set('Authorization', `Bearer ${token}`),
});
const alice = as('alice');
const bob = as('bob');
const admin = as('admin');

let category: Awaited<ReturnType<typeof makeCategory>>;

beforeEach(async () => {
  await resetDb();
  await prisma.profile.createMany({
    data: [
      { id: IDS.admin, email: 'admin@example.test', role: 'ADMIN' },
      { id: IDS.alice, email: 'alice@example.test' },
      { id: IDS.bob, email: 'bob@example.test' },
    ],
  });
  category = await makeCategory('Sarees');
});

/** A product with a single variant; returns the variant id. */
async function sellable(opts: { price?: number; onHand?: number; reserved?: number; name?: string; status?: 'ACTIVE' | 'DRAFT' } = {}) {
  const p = await makeProduct({
    name: opts.name ?? 'Silk Saree',
    categoryId: category.id,
    basePrice: opts.price ?? 100_000,
    status: opts.status,
    variants: [{ sku: `SKU-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, size: 'M', colour: 'Red', onHand: opts.onHand ?? 10, reserved: opts.reserved ?? 0 }],
  });
  return { productId: p.id, variantId: p.variants[0].id };
}

const futureCoupon = (over: Record<string, unknown> = {}) => ({
  code: 'SAVE10',
  discountType: 'PERCENTAGE',
  discountValue: 10,
  startsAt: new Date(Date.now() - 86_400_000).toISOString(),
  endsAt: new Date(Date.now() + 86_400_000).toISOString(),
  ...over,
});

describe('cart', () => {
  it('requires sign-in', async () => {
    expect((await request(app).get('/api/v1/cart')).status).toBe(401);
    expect((await request(app).post('/api/v1/cart/items').send({})).status).toBe(401);
  });

  it('is empty at first, then adds and accumulates items', async () => {
    const { variantId } = await sellable();
    expect((await alice.get('/cart')).body.data).toMatchObject({ items: [], itemCount: 0, canCheckout: false });

    await alice.post('/cart/items', { variantId, quantity: 2 });
    const res = await alice.post('/cart/items', { variantId, quantity: 1 });
    expect(res.status).toBe(201);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0]).toMatchObject({ quantity: 3, unitPrice: 100_000, lineTotal: 300_000 });
    expect(res.body.data.itemCount).toBe(3);
    expect((await alice.get('/cart/summary')).body.data.count).toBe(3);
  });

  it('prices from the server, never from the client', async () => {
    const { variantId } = await sellable({ price: 123_456 });
    const res = await alice.post('/cart/items', { variantId, quantity: 1, unitPrice: 1, price: 1 });
    // Unknown fields are rejected outright rather than ignored.
    expect(res.status).toBe(400);
    const ok = await alice.post('/cart/items', { variantId, quantity: 1 });
    expect(ok.body.data.items[0].unitPrice).toBe(123_456);
  });

  it('uses a variant price override when present', async () => {
    const { variantId } = await sellable({ price: 100_000 });
    await prisma.productVariant.update({ where: { id: variantId }, data: { priceOverride: 80_000 } });
    const res = await alice.post('/cart/items', { variantId, quantity: 1 });
    expect(res.body.data.items[0].unitPrice).toBe(80_000);
  });

  it('refuses quantities above free stock, telling the shopper how many are left', async () => {
    const { variantId } = await sellable({ onHand: 5, reserved: 2 }); // 3 free
    const res = await alice.post('/cart/items', { variantId, quantity: 4 });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ available: 3 });
    expect((await alice.post('/cart/items', { variantId, quantity: 3 })).status).toBe(201);
    // …and a further add that would exceed it is refused too.
    expect((await alice.post('/cart/items', { variantId, quantity: 1 })).status).toBe(409);
  });

  it('refuses sold-out, unpublished and over-limit items', async () => {
    const soldOut = await sellable({ onHand: 0 });
    expect((await alice.post('/cart/items', { variantId: soldOut.variantId, quantity: 1 })).status).toBe(409);

    const draft = await sellable({ status: 'DRAFT', name: 'Draft' });
    expect((await alice.post('/cart/items', { variantId: draft.variantId, quantity: 1 })).status).toBe(422);

    const many = await sellable({ onHand: 100 });
    expect((await alice.post('/cart/items', { variantId: many.variantId, quantity: 11 })).status).toBe(400);
    expect((await alice.post('/cart/items', { variantId: many.variantId, quantity: 0 })).status).toBe(400);
    expect((await alice.post('/cart/items', { variantId: '11111111-1111-4111-8111-111111111111', quantity: 1 })).status).toBe(422);
  });

  it('sets, removes and clears lines', async () => {
    const a = await sellable({ name: 'A' });
    const b = await sellable({ name: 'B' });
    await alice.post('/cart/items', { variantId: a.variantId, quantity: 1 });
    await alice.post('/cart/items', { variantId: b.variantId, quantity: 1 });

    expect((await alice.patch(`/cart/items/${a.variantId}`, { quantity: 4 })).body.data.items[0].quantity).toBe(4);
    expect((await alice.patch(`/cart/items/${a.variantId}`, { quantity: 99 })).status).toBe(400);
    expect((await alice.delete(`/cart/items/${a.variantId}`)).body.data.items).toHaveLength(1);
    expect((await alice.delete('/cart')).body.data.items).toHaveLength(0);
    expect((await alice.patch(`/cart/items/${a.variantId}`, { quantity: 1 })).status).toBe(404);
  });

  it('keeps every shopper’s cart private', async () => {
    const { variantId } = await sellable();
    await alice.post('/cart/items', { variantId, quantity: 2 });

    expect((await bob.get('/cart')).body.data.items).toEqual([]);
    expect((await bob.patch(`/cart/items/${variantId}`, { quantity: 5 })).status).toBe(404);
    await bob.delete(`/cart/items/${variantId}`);
    expect((await alice.get('/cart')).body.data.items[0].quantity).toBe(2); // untouched by bob's delete
  });

  it('flags lines whose stock dropped after they were added, and blocks checkout', async () => {
    const { variantId } = await sellable({ onHand: 10 });
    await alice.post('/cart/items', { variantId, quantity: 5 });
    await prisma.inventory.update({ where: { variantId }, data: { onHand: 3 } });

    const view = (await alice.get('/cart')).body.data;
    expect(view.items[0]).toMatchObject({ issue: 'INSUFFICIENT_STOCK', quantity: 5, pricedQuantity: 3, available: 3 });
    expect(view.canCheckout).toBe(false);
    expect(view.pricing.subtotal).toBe(300_000); // priced for the 3 that can actually be bought

    await prisma.inventory.update({ where: { variantId }, data: { onHand: 0 } });
    expect((await alice.get('/cart')).body.data.items[0].issue).toBe('OUT_OF_STOCK');

    await prisma.product.updateMany({ data: { status: 'ARCHIVED' } });
    expect((await alice.get('/cart')).body.data.items[0].issue).toBe('UNAVAILABLE');
  });

  it('adds shipping under the free threshold and shows how much more unlocks free delivery', async () => {
    const { variantId } = await sellable({ price: 100_000 });
    const view = (await alice.post('/cart/items', { variantId, quantity: 1 })).body.data;
    expect(view.pricing).toMatchObject({ subtotal: 100_000, shippingTotal: 9_900, grandTotal: 109_900, freeShippingRemaining: 199_900 });

    const free = (await alice.patch(`/cart/items/${variantId}`, { quantity: 3 })).body.data;
    expect(free.pricing).toMatchObject({ subtotal: 300_000, shippingTotal: 0, grandTotal: 300_000, freeShippingRemaining: 0 });
  });

  it('follows admin-configured shipping rules', async () => {
    const { variantId } = await sellable({ price: 100_000 });
    expect((await admin.put('/admin/settings/shipping', { flatRate: 5_000, freeThreshold: 50_000 })).status).toBe(200);
    const view = (await alice.post('/cart/items', { variantId, quantity: 1 })).body.data;
    expect(view.pricing.shippingTotal).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'settings.update' } })).toBe(1);
  });
});

describe('coupons', () => {
  async function seedCoupon(over: Record<string, unknown> = {}) {
    const res = await admin.post('/admin/coupons', futureCoupon(over));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data;
  }

  it('applies a coupon to the cart and prices it server-side', async () => {
    await seedCoupon();
    const { variantId } = await sellable({ price: 400_000 });
    await alice.post('/cart/items', { variantId, quantity: 1 });

    const view = (await alice.put('/cart/coupon', { code: 'save10' })).body.data; // case-insensitive
    expect(view.pricing).toMatchObject({ couponCode: 'SAVE10', discountTotal: 40_000, grandTotal: 360_000 });

    const removed = (await alice.delete('/cart/coupon')).body.data;
    expect(removed.pricing).toMatchObject({ couponCode: null, discountTotal: 0 });
  });

  it('rejects unknown, expired, inactive and not-yet-valid codes with a reason', async () => {
    await seedCoupon({ code: 'OLD', startsAt: new Date(Date.now() - 9e8).toISOString(), endsAt: new Date(Date.now() - 1e8).toISOString() });
    await seedCoupon({ code: 'LATER', startsAt: new Date(Date.now() + 1e8).toISOString(), endsAt: new Date(Date.now() + 9e8).toISOString() });
    await seedCoupon({ code: 'OFF', isActive: false });

    expect((await alice.put('/cart/coupon', { code: 'NOPE' })).body.error.message).toMatch(/not valid/i);
    expect((await alice.put('/cart/coupon', { code: 'OLD' })).body.error.message).toMatch(/expired/i);
    expect((await alice.put('/cart/coupon', { code: 'LATER' })).body.error.message).toMatch(/not valid yet/i);
    expect((await alice.put('/cart/coupon', { code: 'OFF' })).body.error.message).toMatch(/no longer active/i);
  });

  it('keeps a coupon attached but explains when the basket is under the minimum', async () => {
    await seedCoupon({ code: 'BIG', minOrderValue: 500_000 });
    const { variantId } = await sellable({ price: 100_000 });
    await alice.post('/cart/items', { variantId, quantity: 1 });
    const view = (await alice.put('/cart/coupon', { code: 'BIG' })).body.data;
    expect(view.pricing.discountTotal).toBe(0);
    expect(view.pricing.couponNote).toBe('Add items worth ₹4,000 more to use BIG'.replace('₹4,000', '₹4000'));
  });

  it('honours the overall usage limit', async () => {
    await seedCoupon({ code: 'ONCE', usageLimit: 1 });
    await prisma.coupon.update({ where: { code: 'ONCE' }, data: { usedCount: 1 } });
    expect((await alice.put('/cart/coupon', { code: 'ONCE' })).body.error.message).toMatch(/fully redeemed/i);
  });

  it('previews a coupon without attaching it', async () => {
    await seedCoupon();
    const { variantId } = await sellable({ price: 200_000 });
    await alice.post('/cart/items', { variantId, quantity: 1 });

    const res = await alice.post('/coupons/validate', { code: 'SAVE10' });
    expect(res.body.data).toMatchObject({ valid: true, discount: 20_000 });
    expect((await alice.get('/cart')).body.data.pricing.couponCode).toBeNull();
    expect((await alice.post('/coupons/validate', { code: 'NOPE' })).status).toBe(422);
  });

  it('manages coupons through the admin API only', async () => {
    expect((await alice.post('/admin/coupons', futureCoupon())).status).toBe(403);
    const c = await seedCoupon({ code: 'Spring_26' });
    expect(c.code).toBe('SPRING_26'); // normalised

    expect((await admin.post('/admin/coupons', futureCoupon({ code: 'spring_26' }))).status).toBe(409);
    expect((await admin.post('/admin/coupons', futureCoupon({ code: 'BAD', discountValue: 150 }))).status).toBe(400);
    expect((await admin.post('/admin/coupons', futureCoupon({ code: 'BAD2', endsAt: new Date(Date.now() - 1e9).toISOString() }))).status).toBe(400);

    const patched = await admin.patch(`/admin/coupons/${c.id}`, { discountValue: 15 });
    expect(patched.body.data.discountValue).toBe(15);
    expect((await admin.patch(`/admin/coupons/${c.id}`, { code: 'HIJACK' })).status).toBe(400);
    expect((await admin.delete(`/admin/coupons/${c.id}`)).body.data).toEqual({ deleted: true, deactivated: false });
  });
});

describe('addresses', () => {
  const addr = (over: Record<string, unknown> = {}) => ({
    fullName: 'Asha Rao',
    phone: '9876543210',
    line1: '12 MG Road',
    city: 'Pune',
    state: 'Maharashtra',
    postalCode: '411001',
    ...over,
  });

  it('makes the first address the default and lets the shopper move the default', async () => {
    const a = (await alice.post('/addresses', addr())).body.data;
    const b = (await alice.post('/addresses', addr({ line1: '99 FC Road' }))).body.data;
    expect(a.isDefault).toBe(true);
    expect(b.isDefault).toBe(false);

    await alice.patch(`/addresses/${b.id}`, { isDefault: true });
    const list = (await alice.get('/addresses')).body.data;
    expect(list.filter((x: { isDefault: boolean }) => x.isDefault)).toHaveLength(1);
    expect(list[0].id).toBe(b.id);
  });

  it('promotes another address when the default is deleted', async () => {
    const a = (await alice.post('/addresses', addr())).body.data;
    const b = (await alice.post('/addresses', addr({ line1: 'second' }))).body.data;
    await alice.delete(`/addresses/${a.id}`);
    const list = (await alice.get('/addresses')).body.data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: b.id, isDefault: true });
  });

  it('validates phone and PIN code', async () => {
    expect((await alice.post('/addresses', addr({ phone: '12345' }))).status).toBe(400);
    expect((await alice.post('/addresses', addr({ phone: '5876543210' }))).status).toBe(400); // must start 6-9
    expect((await alice.post('/addresses', addr({ postalCode: '011001' }))).status).toBe(400);
    expect((await alice.post('/addresses', addr({ postalCode: '41100' }))).status).toBe(400);
  });

  it('never exposes or lets one shopper modify another’s address', async () => {
    const a = (await alice.post('/addresses', addr())).body.data;
    expect((await bob.get('/addresses')).body.data).toEqual([]);
    expect((await bob.patch(`/addresses/${a.id}`, { city: 'Hacked' })).status).toBe(404);
    expect((await bob.delete(`/addresses/${a.id}`)).status).toBe(404);
    expect((await prisma.address.findUnique({ where: { id: a.id } }))?.city).toBe('Pune');
  });

  it('caps the number of saved addresses', async () => {
    for (let i = 0; i < 10; i++) expect((await alice.post('/addresses', addr({ line1: `Line ${i}` }))).status).toBe(201);
    expect((await alice.post('/addresses', addr({ line1: 'one too many' }))).status).toBe(422);
  });
});

describe('wishlist', () => {
  it('saves idempotently, lists live products and removes', async () => {
    const { productId } = await sellable({ name: 'Loved' });
    expect((await alice.post(`/wishlist/${productId}`)).status).toBe(201);
    expect((await alice.post(`/wishlist/${productId}`)).status).toBe(201); // saving twice is fine
    expect((await alice.get('/wishlist/ids')).body.data).toEqual([productId]);

    const list = (await alice.get('/wishlist')).body.data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Loved', id: productId });

    await alice.delete(`/wishlist/${productId}`);
    expect((await alice.get('/wishlist')).body.data).toEqual([]);
  });

  it('refuses unpublished products and hides ones archived later', async () => {
    const draft = await sellable({ status: 'DRAFT', name: 'Draft' });
    expect((await alice.post(`/wishlist/${draft.productId}`)).status).toBe(404);

    const live = await sellable({ name: 'Live' });
    await alice.post(`/wishlist/${live.productId}`);
    await prisma.product.update({ where: { id: live.productId }, data: { status: 'ARCHIVED' } });
    expect((await alice.get('/wishlist')).body.data).toEqual([]);
  });

  it('is private to each shopper', async () => {
    const { productId } = await sellable();
    await alice.post(`/wishlist/${productId}`);
    expect((await bob.get('/wishlist')).body.data).toEqual([]);
    await bob.delete(`/wishlist/${productId}`); // must not remove alice's entry
    expect((await alice.get('/wishlist/ids')).body.data).toEqual([productId]);
  });
});
