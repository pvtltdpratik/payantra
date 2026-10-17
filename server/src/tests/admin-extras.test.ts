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
});

async function paid(customer = alice, price = 100_000) {
  const a = await w.sellable({ price, onHand: 20 });
  const placed = await w.placeOnline(customer, [{ variantId: a.variantId }]);
  await w.payAndVerify(customer, placed);
  return { id: placed.order.id, total: (await prisma.order.findUniqueOrThrow({ where: { id: placed.order.id } })).grandTotal };
}

describe('customers', () => {
  it('lists customers with what they have spent, searches, filters by status, and shows only customers', async () => {
    const a1 = await paid(alice, 100_000);
    const a2 = await paid(alice, 200_000);
    const cancelled = await paid(alice, 50_000);
    await admin.post(`/admin/orders/${cancelled.id}/cancel`, { reason: 'Oops' });
    await paid(bob, 300_000);
    await prisma.profile.update({ where: { id: IDS.carol }, data: { status: 'SUSPENDED', fullName: 'Carol Suspended' } });

    const list = (await admin.get('/admin/customers')).body.data as any[];
    expect(list.map((c) => c.email).sort()).toEqual(['alice@example.test', 'bob@example.test', 'carol@example.test']); // no admin
    const row = list.find((c) => c.email === 'alice@example.test');
    expect(row.orders).toBe(2); // the cancelled one is not counted
    expect(row.totalSpent).toBe(a1.total + a2.total + cancelled.total); // paid, even though one was later refunded
    expect(row.lastOrderAt).not.toBeNull();
    expect(list.find((c) => c.email === 'carol@example.test')).toMatchObject({ orders: 0, totalSpent: 0, lastOrderAt: null });

    expect((await admin.get('/admin/customers?q=carol')).body.data).toHaveLength(1);
    expect((await admin.get('/admin/customers?status=SUSPENDED')).body.data.map((c: any) => c.email)).toEqual(['carol@example.test']);
    expect((await admin.get('/admin/customers?q=zzz-nobody')).body.data).toHaveLength(0);
  });

  it('shows a customer in full: money, orders, addresses, requests', async () => {
    const a1 = await paid(alice, 100_000);
    const a2 = await paid(alice, 200_000);
    await admin.post(`/admin/orders/${a2.id}/refund`, { amount: 10_000, reason: 'Goodwill' });
    await alice.post('/addresses', { fullName: 'Asha Rao', phone: '9876543210', line1: '12 MG Road', city: 'Pune', state: 'Maharashtra', postalCode: '411001' });
    await prisma.supportRequest.create({ data: { userId: IDS.alice, subject: 'Hello', message: 'A question about sizes' } });

    const detail = (await admin.get(`/admin/customers/${IDS.alice}`)).body.data;
    expect(detail).toMatchObject({ email: 'alice@example.test', status: 'ACTIVE' });
    expect(detail.stats).toMatchObject({ orders: 2, paidOrders: 2, totalSpent: a1.total + a2.total, refunded: 10_000, netSpent: a1.total + a2.total - 10_000, averageOrder: Math.round((a1.total + a2.total) / 2) });
    expect(detail.recentOrders).toHaveLength(2);
    expect(detail.addresses).toHaveLength(2); // the one checkout created, and the one added above
    expect(detail.addresses.filter((a: { isDefault: boolean }) => a.isDefault)).toHaveLength(1);
    expect(detail.supportRequests).toHaveLength(1);
    // Never any credentials: this API has none to give, and the shape says so.
    expect(JSON.stringify(detail)).not.toMatch(/password|token|secret/i);

    expect((await admin.get(`/admin/customers/${IDS.admin}`)).status).toBe(404); // an admin is not a customer
    expect((await admin.get('/admin/customers/not-a-uuid')).status).toBe(400);
  });
});

describe('support requests', () => {
  it('lets a customer ask, and tells the admins', async () => {
    const order = await paid(alice);
    const res = await alice.post('/support', { subject: 'Wrong size sent', message: 'I ordered a medium but got a small.', orderId: order.id });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ subject: 'Wrong size sent', status: 'OPEN', reply: null, orderId: order.id });
    expect((await prisma.notification.findMany({ where: { userId: IDS.admin } })).map((n) => n.title)).toContain('New support request');
  });

  it('validates, refuses another customer’s order, and caps open requests', async () => {
    const bobs = await paid(bob);
    expect((await alice.post('/support', { subject: 'hi', message: 'short' })).status).toBe(400);
    expect((await alice.post('/support', { subject: 'Valid subject', message: 'A long enough message.', extra: 1 })).status).toBe(400);
    expect((await alice.post('/support', { subject: 'Valid subject', message: 'A long enough message.', orderId: bobs.id })).status).toBe(404);

    for (let i = 0; i < 5; i++) expect((await alice.post('/support', { subject: `Question ${i}`, message: 'A long enough message.' })).status).toBe(201);
    const sixth = await alice.post('/support', { subject: 'One more', message: 'A long enough message.' });
    expect(sixth.status).toBe(422);
    expect(sixth.body.error.message).toMatch(/5 open requests/);
    expect((await bob.post('/support', { subject: 'Bob asks', message: 'A long enough message.' })).status).toBe(201); // the cap is per customer
  });

  it('keeps each customer’s requests private', async () => {
    await alice.post('/support', { subject: 'Alice only', message: 'This is private to Alice.' });
    expect((await alice.get('/support')).body.data).toHaveLength(1);
    expect((await bob.get('/support')).body.data).toHaveLength(0);
    expect((await request(app).get('/api/v1/support')).status).toBe(401);
  });

  it('lets an admin reply and resolve; the customer is notified and sees the reply', async () => {
    const created = (await alice.post('/support', { subject: 'Refund status', message: 'Where is my refund please?' })).body.data;
    const queue = (await admin.get('/admin/support')).body.data as any[];
    expect(queue[0]).toMatchObject({ id: created.id, status: 'OPEN', user: { email: 'alice@example.test' } });

    const replied = await admin.patch(`/admin/support/${created.id}`, { reply: 'Your refund was sent today and reaches you in 3-5 days.' });
    expect(replied.status).toBe(200);
    expect(replied.body.data).toMatchObject({ status: 'IN_PROGRESS' }); // answering moves it along
    const row = await prisma.supportRequest.findUniqueOrThrow({ where: { id: created.id } });
    expect(row).toMatchObject({ repliedById: IDS.admin });
    expect(row.repliedAt).not.toBeNull();
    expect((await prisma.notification.findMany({ where: { userId: IDS.alice } })).map((n) => n.title).join()).toMatch(/Reply to your request: Refund status/);

    expect((await admin.patch(`/admin/support/${created.id}`, { status: 'RESOLVED' })).body.data.status).toBe('RESOLVED');
    const mine = (await alice.get('/support')).body.data[0];
    expect(mine).toMatchObject({ status: 'RESOLVED', reply: expect.stringContaining('refund was sent') });
    expect((await admin.get('/admin/support?status=OPEN')).body.data).toHaveLength(0);
    expect((await prisma.auditLog.findMany({ where: { action: 'support.respond' } })).length).toBe(2);
  });

  it('is admin-only to answer, and rejects an empty update', async () => {
    const created = (await alice.post('/support', { subject: 'Hello there', message: 'A long enough message.' })).body.data;
    expect((await alice.patch(`/admin/support/${created.id}`, { status: 'CLOSED' })).status).toBe(403);
    expect((await admin.patch(`/admin/support/${created.id}`, {})).status).toBe(400);
    expect((await admin.patch(`/admin/support/${created.id}`, { status: 'NOPE' })).status).toBe(400);
    expect((await admin.patch('/admin/support/00000000-0000-4000-8000-00000000ffff', { status: 'CLOSED' })).status).toBe(404);
  });
});

describe('banners', () => {
  const banner = (over: object = {}) => ({ title: 'Diwali Edit', imageUrl: '/placeholder/5c1a2b?label=Diwali', linkUrl: '/shop', placement: 'HOME_HERO', ...over });

  it('lets an admin create, edit, reorder and delete banners, all audited', async () => {
    const made = await admin.post('/admin/banners', banner());
    expect(made.status).toBe(201);
    expect(made.body.data).toMatchObject({ title: 'Diwali Edit', isActive: true, sortOrder: 0 });
    const id = made.body.data.id as string;

    expect((await admin.patch(`/admin/banners/${id}`, { title: 'Festive Edit', sortOrder: 3 })).body.data).toMatchObject({ title: 'Festive Edit', sortOrder: 3 });
    expect((await admin.get('/admin/banners')).body.data).toHaveLength(1);
    expect((await admin.delete(`/admin/banners/${id}`)).status).toBe(200);
    expect((await admin.delete(`/admin/banners/${id}`)).status).toBe(404);
    expect((await prisma.auditLog.findMany({ where: { entityType: 'Banner' }, orderBy: { createdAt: 'asc' } })).map((a) => a.action)).toEqual(['banner.create', 'banner.update', 'banner.delete']);
    expect((await alice.post('/admin/banners', banner())).status).toBe(403);
  });

  it('refuses dangerous or malformed links and images', async () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', '//evil.example/x.png', 'http://insecure.example/x.png', 'ftp://x', '/ok\\..\\evil', 'shop', '']) {
      expect((await admin.post('/admin/banners', banner({ imageUrl: bad }))).status, `imageUrl ${bad}`).toBe(400);
      expect((await admin.post('/admin/banners', banner({ linkUrl: bad }))).status, `linkUrl ${bad}`).toBe(400);
    }
    for (const good of ['/shop', '/category/silk-sarees', 'https://cdn.example.com/a.jpg']) {
      expect((await admin.post('/admin/banners', banner({ imageUrl: good, linkUrl: good }))).status, good).toBe(201);
    }
    expect((await admin.post('/admin/banners', banner({ placement: 'SOMEWHERE' }))).status).toBe(400);
    expect((await admin.post('/admin/banners', banner({ startsAt: '2026-10-10T00:00:00Z', endsAt: '2026-10-01T00:00:00Z' }))).status).toBe(400);
    // The date window is checked against the stored value when only one end is edited.
    const id = (await admin.post('/admin/banners', banner({ startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-10-10T00:00:00Z' }))).body.data.id;
    expect((await admin.patch(`/admin/banners/${id}`, { endsAt: '2026-09-01T00:00:00Z' })).status).toBe(422);
  });

  it('shows the public only what is live, in the admin’s order', async () => {
    const day = 86_400_000;
    const iso = (offset: number) => new Date(Date.now() + offset * day).toISOString();
    await admin.post('/admin/banners', banner({ title: 'Second', sortOrder: 2 }));
    await admin.post('/admin/banners', banner({ title: 'First', sortOrder: 1 }));
    await admin.post('/admin/banners', banner({ title: 'Switched off', isActive: false }));
    await admin.post('/admin/banners', banner({ title: 'Not yet', startsAt: iso(2) }));
    await admin.post('/admin/banners', banner({ title: 'Expired', endsAt: iso(-1), startsAt: iso(-5) }));
    await admin.post('/admin/banners', banner({ title: 'Live window', startsAt: iso(-1), endsAt: iso(1), sortOrder: 3 }));
    await admin.post('/admin/banners', banner({ title: 'Strip', placement: 'HOME_STRIP' }));

    const hero = (await request(app).get('/api/v1/banners?placement=HOME_HERO')).body.data as any[];
    expect(hero.map((b) => b.title)).toEqual(['First', 'Second', 'Live window']);
    expect(Object.keys(hero[0]).sort()).toEqual(['id', 'imageUrl', 'linkUrl', 'placement', 'subtitle', 'title']); // no admin fields leak
    expect((await request(app).get('/api/v1/banners')).body.data).toHaveLength(4); // all placements, still only live ones
    expect((await request(app).get('/api/v1/banners?placement=NOPE')).status).toBe(400);
  });
});

describe('newsletter', () => {
  const subscribe = (email: string) => request(app).post('/api/v1/newsletter/subscribe').send({ email });

  it('subscribes anyone, idempotently, without revealing who is already on the list', async () => {
    const first = await subscribe('Reader@Example.test');
    const again = await subscribe('reader@example.test');
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body); // identical answer: no enumeration
    expect(await prisma.newsletterSubscriber.count()).toBe(1);
    expect((await prisma.newsletterSubscriber.findFirstOrThrow()).email).toBe('reader@example.test'); // normalised
    expect((await subscribe('not-an-email')).status).toBe(400);
    expect((await request(app).post('/api/v1/newsletter/subscribe').send({ email: 'a@b.test', admin: true })).status).toBe(400);
  });

  it('lets admins list, filter, unsubscribe, restore and export', async () => {
    await subscribe('one@example.test');
    await subscribe('two@example.test');
    const two = await prisma.newsletterSubscriber.findFirstOrThrow({ where: { email: 'two@example.test' } });
    expect((await admin.patch(`/admin/newsletter/${two.id}`, { subscribed: false })).body.data.unsubscribedAt).not.toBeNull();

    const all = await admin.get('/admin/newsletter');
    expect(all.body.data).toHaveLength(2);
    expect(all.body.meta.subscribed).toBe(1);
    expect((await admin.get('/admin/newsletter?status=subscribed')).body.data.map((s: any) => s.email)).toEqual(['one@example.test']);
    expect((await admin.get('/admin/newsletter?status=unsubscribed')).body.data.map((s: any) => s.email)).toEqual(['two@example.test']);
    expect((await admin.get('/admin/newsletter?q=ONE')).body.data).toHaveLength(1);

    const csv = await admin.get('/admin/newsletter?format=csv&status=subscribed');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['cache-control']).toBe('no-store');
    expect(csv.text.slice(1).split('\r\n')[0]).toBe('Email,Subscribed (IST),Status,Unsubscribed (IST)');
    expect(csv.text).toContain('one@example.test');
    expect(csv.text).not.toContain('two@example.test');

    // Subscribing again after unsubscribing brings the person back.
    await subscribe('two@example.test');
    expect((await prisma.newsletterSubscriber.findUniqueOrThrow({ where: { id: two.id } })).unsubscribedAt).toBeNull();
    expect((await alice.get('/admin/newsletter')).status).toBe(403);
    expect((await carol.patch(`/admin/newsletter/${two.id}`, { subscribed: false })).status).toBe(403);
  });
});
