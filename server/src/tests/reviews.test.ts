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
const { displayName } = await import('../modules/reviews/reviews.service.js');
const request = (await import('supertest')).default;

const app = createApp();
const w = makeWorld(app, prisma, { makeCategory, makeProduct });
const { admin } = w;
const alice = w.as('alice');
const bob = w.as('bob');
const carol = w.as('carol');

beforeEach(async () => {
  await resetDb();
  await sim('reset');
  await w.reset();
  await prisma.profile.update({ where: { id: IDS.alice }, data: { fullName: 'Asha Rao' } });
  await prisma.profile.update({ where: { id: IDS.bob }, data: { fullName: 'Bhavesh' } });
});

/** A product bought and DELIVERED to `customer`. */
async function delivered(customer: ReturnType<typeof w.as>, a?: Awaited<ReturnType<typeof w.sellable>>) {
  const item = a ?? (await w.sellable({ onHand: 30, name: 'Banarasi Saree' }));
  const placed = await w.placeOnline(customer, [{ variantId: item.variantId }]);
  await w.payAndVerify(customer, placed);
  await w.deliver(placed.order.id);
  return { orderId: placed.order.id, productId: item.productId, a: item };
}
const review = (c: ReturnType<typeof w.as>, d: { orderId: string; productId: string }, body: object = {}) => c.post('/reviews', { productId: d.productId, orderId: d.orderId, rating: 5, ...body });
const productOf = (id: string) => prisma.product.findUniqueOrThrow({ where: { id } });
const slugOf = async (id: string) => (await productOf(id)).slug;

describe('who may review', () => {
  it('requires a delivered order that contained the product', async () => {
    const item = await w.sellable({ onHand: 10 });
    const placed = await w.placeOnline(alice, [{ variantId: item.variantId }]);
    await w.payAndVerify(alice, placed);
    const d = { orderId: placed.order.id, productId: item.productId };

    // Paid but not delivered yet.
    const early = await review(alice, d);
    expect(early.status).toBe(403);
    expect(early.body.error.message).toMatch(/delivered/);

    await w.deliver(placed.order.id);
    expect((await review(alice, d, { rating: 4, title: 'Lovely drape', body: 'The zari work is gorgeous.' })).status).toBe(201);
  });

  it('refuses another customer’s order, a product not in the order, and strangers', async () => {
    const d = await delivered(alice);
    const other = await w.sellable({ name: 'Different Kurta' });

    expect((await review(bob, d)).status).toBe(403); // bob never bought it
    expect((await review(alice, { orderId: d.orderId, productId: other.productId })).status).toBe(403); // not in that order
    expect((await request(app).post('/api/v1/reviews').send({ productId: d.productId, orderId: d.orderId, rating: 5 })).status).toBe(401);
  });

  it('allows one review per product per order, but a new order earns a new review', async () => {
    const item = await w.sellable({ onHand: 30 });
    const first = await delivered(alice, item);
    expect((await review(alice, first)).status).toBe(201);
    const again = await review(alice, first, { rating: 1 });
    expect(again.status).toBe(409);
    expect(await prisma.review.count()).toBe(1);

    const second = await delivered(alice, item);
    expect((await review(alice, second, { rating: 3 })).status).toBe(201);
    expect(await prisma.review.count()).toBe(2);
  });

  it('validates the review', async () => {
    const d = await delivered(alice);
    for (const rating of [0, 6, 2.5, '5', null]) expect((await review(alice, d, { rating })).status, `rating ${rating}`).toBe(400);
    expect((await review(alice, d, { title: 'x'.repeat(101) })).status).toBe(400);
    expect((await review(alice, d, { body: 'x'.repeat(2001) })).status).toBe(400);
    expect((await review(alice, d, { userId: IDS.bob })).status).toBe(400); // strict: the author is always the signed-in user
    expect((await review(alice, d, { isVisible: false })).status).toBe(400);
    expect(await prisma.review.count()).toBe(0);
    const ok = await review(alice, d, { title: null, body: null });
    expect(ok.status).toBe(201);
    expect((await prisma.review.findFirstOrThrow()).userId).toBe(IDS.alice);
  });
});

describe('ratings', () => {
  it('keep the product’s average and count in step with every change', async () => {
    const item = await w.sellable({ onHand: 50 });
    const a = await delivered(alice, item);
    const b = await delivered(bob, item);
    const c = await delivered(carol, item);
    expect(Number((await productOf(item.productId)).ratingAverage)).toBe(0);

    const ra = (await review(alice, a, { rating: 5 })).body.data;
    await review(bob, b, { rating: 4 });
    let p = await productOf(item.productId);
    expect([Number(p.ratingAverage), p.ratingCount]).toEqual([4.5, 2]);

    await review(carol, c, { rating: 2 });
    p = await productOf(item.productId);
    expect([Number(p.ratingAverage), p.ratingCount]).toEqual([3.67, 3]); // 11 ÷ 3, rounded to two places

    expect((await alice.patch(`/reviews/${ra.id}`, { rating: 1 })).status).toBe(200);
    p = await productOf(item.productId);
    expect([Number(p.ratingAverage), p.ratingCount]).toEqual([2.33, 3]);

    expect((await alice.delete(`/reviews/${ra.id}`)).status).toBe(200);
    p = await productOf(item.productId);
    expect([Number(p.ratingAverage), p.ratingCount]).toEqual([3, 2]);
  });

  it('stay correct when several customers review at the same moment', async () => {
    const item = await w.sellable({ onHand: 50 });
    const [a, b, c] = [await delivered(alice, item), await delivered(bob, item), await delivered(carol, item)];
    const results = await Promise.all([review(alice, a, { rating: 5 }), review(bob, b, { rating: 3 }), review(carol, c, { rating: 1 })]);
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    const p = await productOf(item.productId);
    expect([Number(p.ratingAverage), p.ratingCount]).toEqual([3, 3]);
  });

  it('feed the shop’s rating sort and filter', async () => {
    const high = await w.sellable({ onHand: 20, name: 'Highly Rated' });
    const low = await w.sellable({ onHand: 20, name: 'Poorly Rated' });
    await review(alice, await delivered(alice, high), { rating: 5 });
    await review(alice, await delivered(alice, low), { rating: 2 });

    const sorted = (await request(app).get('/api/v1/products?sort=rating')).body.data as { name: string; ratingAverage: number; ratingCount: number }[];
    expect(sorted.map((p) => p.name)).toEqual(['Highly Rated', 'Poorly Rated']);
    expect(sorted[0]).toMatchObject({ ratingAverage: 5, ratingCount: 1 });
    expect((await request(app).get('/api/v1/products?minRating=4')).body.data.map((p: { name: string }) => p.name)).toEqual(['Highly Rated']);
  });
});

describe('what the public sees', () => {
  it('shows visible reviews with masked names, a histogram, sorting and paging — and no private data', async () => {
    const item = await w.sellable({ onHand: 50 });
    await review(alice, await delivered(alice, item), { rating: 5, title: 'Beautiful', body: 'Worth every rupee.' });
    await review(bob, await delivered(bob, item), { rating: 2, title: 'Too long' });
    const slug = await slugOf(item.productId);

    const res = await request(app).get(`/api/v1/reviews/product/${slug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.summary).toEqual({ average: 3.5, count: 2, histogram: { 1: 0, 2: 1, 3: 0, 4: 0, 5: 1 } });
    expect(res.body.data.items.map((r: { reviewer: string }) => r.reviewer)).toEqual(['Bhavesh', 'Asha R.']); // newest first; surname reduced to an initial
    expect(res.body.data.items[0]).toMatchObject({ rating: 2, verifiedPurchase: true });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/example\.test|Rao|userId|orderId|isVisible/);

    expect((await request(app).get(`/api/v1/reviews/product/${slug}?sort=highest`)).body.data.items.map((r: { rating: number }) => r.rating)).toEqual([5, 2]);
    expect((await request(app).get(`/api/v1/reviews/product/${slug}?sort=lowest`)).body.data.items.map((r: { rating: number }) => r.rating)).toEqual([2, 5]);
    const paged = await request(app).get(`/api/v1/reviews/product/${slug}?pageSize=1&page=2`);
    expect(paged.body.data.items).toHaveLength(1);
    expect(paged.body.meta).toMatchObject({ total: 2, totalPages: 2, page: 2 });
  });

  it('headlines only what the list shows, even when the stored product rating is wrong', async () => {
    const item = await w.sellable({ onHand: 20 });
    const slug = await slugOf(item.productId);
    // e.g. demo data once claimed "4.5 stars from 30 reviews" with no reviews behind it.
    await prisma.product.update({ where: { id: item.productId }, data: { ratingAverage: 4.5, ratingCount: 30 } });

    const none = (await request(app).get(`/api/v1/reviews/product/${slug}`)).body.data;
    expect(none.summary).toEqual({ average: 0, count: 0, histogram: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
    expect(none.items).toEqual([]);

    await review(alice, await delivered(alice, item), { rating: 4 });
    const one = (await request(app).get(`/api/v1/reviews/product/${slug}`)).body.data;
    expect(one.summary).toMatchObject({ average: 4, count: 1 });
    expect(one.items).toHaveLength(1);
    // The first real review also repairs the stored aggregate the shop sorts by.
    const p = await productOf(item.productId);
    expect([Number(p.ratingAverage), p.ratingCount]).toEqual([4, 1]);
  });

  it('404s for unknown or unpublished products', async () => {
    const item = await w.sellable();
    const slug = await slugOf(item.productId);
    await prisma.product.update({ where: { id: item.productId }, data: { status: 'ARCHIVED' } });
    expect((await request(app).get(`/api/v1/reviews/product/${slug}`)).status).toBe(404);
    expect((await request(app).get('/api/v1/reviews/product/no-such-product')).status).toBe(404);
  });

  it('masks names consistently', () => {
    expect(displayName('Asha Rao')).toBe('Asha R.');
    expect(displayName('  priya   kumari  sharma ')).toBe('priya S.');
    expect(displayName('Bhavesh')).toBe('Bhavesh');
    expect(displayName(null)).toBe('Verified buyer');
    expect(displayName('   ')).toBe('Verified buyer');
  });
});

describe('featured reviews (the home page)', () => {
  const LONG = 'The weave is beautiful and it arrived beautifully packed.';
  const featured = async (qs = '') => (await request(app).get(`/api/v1/reviews/featured${qs}`)).body.data as any[];

  it('is empty — never invented — until real reviews exist', async () => {
    expect(await featured()).toEqual([]);
  });

  it('shows only visible, positive reviews with substance, one per product, newest first, with masked names', async () => {
    const mk = async (name: string) => w.sellable({ onHand: 30, name });
    const [a, b, c, d, e, f] = [await mk('Saree A'), await mk('Saree B'), await mk('Saree C'), await mk('Saree D'), await mk('Saree E'), await mk('Saree F')];

    const ra1 = (await review(alice, await delivered(alice, a), { rating: 5, body: 'First thoughts on this saree, quite lovely.' })).body.data;
    await sleepMs(15);
    await review(bob, await delivered(bob, b), { rating: 4, title: 'Nice', body: LONG });
    await sleepMs(15);
    await review(alice, await delivered(alice, c), { rating: 3, body: LONG }); // too lukewarm
    await review(alice, await delivered(alice, d), { rating: 5, body: 'Great' }); // no substance
    await review(alice, await delivered(alice, e), { rating: 5 }); // no words at all
    const hidden = (await review(carol, await delivered(carol, f), { rating: 5, body: LONG })).body.data;
    await admin.patch(`/admin/reviews/${hidden.id}`, { isVisible: false });
    await sleepMs(15);
    // A second, newer review of product A: only the newest per product is shown.
    await review(alice, await delivered(alice, a), { rating: 5, body: 'Second order, even better than the first.' });
    void ra1;

    const list = await featured();
    expect(list.map((r) => r.productName)).toEqual(['Saree A', 'Saree B']);
    expect(list[0]).toMatchObject({ rating: 5, body: 'Second order, even better than the first.', reviewer: 'Asha R.' });
    expect(list[1]).toMatchObject({ rating: 4, title: 'Nice', reviewer: 'Bhavesh' });
    expect(typeof list[0].productSlug).toBe('string');
    expect(JSON.stringify(list)).not.toMatch(/example\.test|userId|orderId|isVisible|Rao/);
  });

  it('leaves out archived products, trims long reviews, and honours the limit', async () => {
    const items = [];
    for (let i = 0; i < 4; i++) items.push(await w.sellable({ onHand: 30, name: `Kurta ${i}` }));
    for (const it of items) await review(alice, await delivered(alice, it), { rating: 5, body: `${LONG} ${'x'.repeat(400)}` });
    expect((await featured('?limit=2')).length).toBe(2);
    expect((await featured())[0].body.length).toBeLessThanOrEqual(280);
    expect((await featured())[0].body.endsWith('…')).toBe(true);

    await prisma.product.update({ where: { id: items[3].productId }, data: { status: 'ARCHIVED' } });
    expect((await featured()).map((r) => r.productName)).not.toContain('Kurta 3');
    expect((await request(app).get('/api/v1/reviews/featured?limit=50')).status).toBe(400);
    expect((await request(app).get('/api/v1/reviews/featured?limit=0')).status).toBe(400);
  });
});

const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('my reviews', () => {
  it('lists what is waiting to be reviewed, then moves it across once reviewed', async () => {
    const d = await delivered(alice);
    const notDelivered = await w.sellable({ name: 'Still In Transit' });
    const placed = await w.placeOnline(alice, [{ variantId: notDelivered.variantId }]);
    await w.payAndVerify(alice, placed);

    let mine = (await alice.get('/reviews/mine')).body.data;
    expect(mine.reviewed).toHaveLength(0);
    expect(mine.toReview).toHaveLength(1); // the undelivered one is not offered
    expect(mine.toReview[0]).toMatchObject({ orderId: d.orderId, productId: d.productId, name: 'Banarasi Saree' });
    expect(mine.toReview[0].slug).toBeTruthy();

    await review(alice, d, { rating: 4 });
    mine = (await alice.get('/reviews/mine')).body.data;
    expect(mine.toReview).toHaveLength(0);
    expect(mine.reviewed).toHaveLength(1);
    expect(mine.reviewed[0]).toMatchObject({ rating: 4, name: 'Banarasi Saree', isVisible: true });
    expect((await bob.get('/reviews/mine')).body.data).toEqual({ toReview: [], reviewed: [] });
  });
});

describe('editing and deleting', () => {
  it('belongs to the author alone', async () => {
    const d = await delivered(alice);
    const made = (await review(alice, d, { rating: 4 })).body.data;

    expect((await bob.patch(`/reviews/${made.id}`, { rating: 1 })).status).toBe(404);
    expect((await bob.delete(`/reviews/${made.id}`)).status).toBe(404);
    expect((await admin.patch(`/reviews/${made.id}`, { rating: 1 })).status).toBe(404); // not even an admin edits someone's words
    expect((await prisma.review.findUniqueOrThrow({ where: { id: made.id } })).rating).toBe(4);

    expect((await alice.patch(`/reviews/${made.id}`, { title: 'Updated title' })).body.data).toMatchObject({ rating: 4, title: 'Updated title' });
    expect((await alice.patch(`/reviews/${made.id}`, {})).status).toBe(400);
    expect((await alice.patch(`/reviews/${made.id}`, { rating: 9 })).status).toBe(400);
    expect((await alice.patch(`/reviews/${made.id}`, { orderId: d.orderId })).status).toBe(400);
  });
});

describe('moderation', () => {
  it('lets an admin hide and restore a review, which removes it from the public rating', async () => {
    const item = await w.sellable({ onHand: 50 });
    const bad = (await review(alice, await delivered(alice, item), { rating: 1, body: 'Rude words here' })).body.data;
    await review(bob, await delivered(bob, item), { rating: 5 });
    const slug = await slugOf(item.productId);
    expect(Number((await productOf(item.productId)).ratingAverage)).toBe(3);

    expect((await admin.patch(`/admin/reviews/${bad.id}`, { isVisible: false })).body.data.isVisible).toBe(false);
    let p = await productOf(item.productId);
    expect([Number(p.ratingAverage), p.ratingCount]).toEqual([5, 1]);
    expect((await request(app).get(`/api/v1/reviews/product/${slug}`)).body.data.items).toHaveLength(1);
    // The author still sees it, marked hidden.
    expect((await alice.get('/reviews/mine')).body.data.reviewed[0]).toMatchObject({ isVisible: false });

    expect((await admin.patch(`/admin/reviews/${bad.id}`, { isVisible: true })).status).toBe(200);
    p = await productOf(item.productId);
    expect([Number(p.ratingAverage), p.ratingCount]).toEqual([3, 2]);
    expect((await prisma.auditLog.findMany({ where: { entityType: 'Review' }, orderBy: { createdAt: 'asc' } })).map((a) => a.action)).toEqual(['review.hide', 'review.show']);
  });

  it('lists reviews for moderators and is closed to everyone else', async () => {
    await review(alice, await delivered(alice), { rating: 2 });
    const list = await admin.get('/admin/reviews');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ rating: 2, productName: 'Banarasi Saree', user: { email: 'alice@example.test' } });
    expect((await admin.get('/admin/reviews?status=hidden')).body.data).toHaveLength(0);
    expect((await admin.get('/admin/reviews?rating=2')).body.data).toHaveLength(1);
    expect((await alice.get('/admin/reviews')).status).toBe(403);
    expect((await alice.patch(`/admin/reviews/${list.body.data[0].id}`, { isVisible: false })).status).toBe(403);
    expect((await admin.patch('/admin/reviews/00000000-0000-4000-8000-00000000ffff', { isVisible: false })).status).toBe(404);
  });
});

describe('recently viewed', () => {
  it('remembers what a signed-in shopper looked at, newest first, without duplicates', async () => {
    const [a, b, c] = [await w.sellable({ name: 'First Seen' }), await w.sellable({ name: 'Second Seen' }), await w.sellable({ name: 'Third Seen' })];
    for (const x of [a, b, c]) expect((await alice.post(`/recently-viewed/${x.productId}`)).status).toBe(200);
    await alice.post(`/recently-viewed/${a.productId}`); // looked again: moves to the front, no duplicate

    const list = (await alice.get('/recently-viewed')).body.data as { name: string }[];
    expect(list.map((p) => p.name)).toEqual(['First Seen', 'Third Seen', 'Second Seen']);
    expect((await bob.get('/recently-viewed')).body.data).toEqual([]); // private to the shopper
    expect((await request(app).get('/api/v1/recently-viewed')).status).toBe(401);
    expect((await request(app).post(`/api/v1/recently-viewed/${a.productId}`)).status).toBe(401);
  });

  it('ignores unknown or unpublished products, drops archived ones, and keeps only the newest 20', async () => {
    expect((await alice.post('/recently-viewed/00000000-0000-4000-8000-00000000ffff')).status).toBe(404);
    expect((await alice.post('/recently-viewed/not-a-uuid')).status).toBe(400);

    const hidden = await w.sellable({ name: 'Soon Archived' });
    await alice.post(`/recently-viewed/${hidden.productId}`);
    await prisma.product.update({ where: { id: hidden.productId }, data: { status: 'ARCHIVED' } });
    expect((await alice.get('/recently-viewed')).body.data).toEqual([]);
    expect((await alice.post(`/recently-viewed/${hidden.productId}`)).status).toBe(404);

    for (let i = 0; i < 22; i++) {
      const p = await w.sellable({ name: `Viewed ${i}` });
      await alice.post(`/recently-viewed/${p.productId}`);
    }
    expect(await prisma.recentlyViewed.count({ where: { userId: IDS.alice } })).toBe(20);
    const shown = (await alice.get('/recently-viewed')).body.data as { name: string }[];
    expect(shown).toHaveLength(12);
    expect(shown[0].name).toBe('Viewed 21');

    expect((await alice.delete('/recently-viewed')).body.data.cleared).toBeGreaterThan(0);
    expect((await alice.get('/recently-viewed')).body.data).toEqual([]);
  });
});
