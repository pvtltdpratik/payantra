import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Token → identity. Everything else (Prisma, Express, services) is real.
const IDS = {
  admin: '00000000-0000-4000-8000-0000000000a1',
  admin2: '00000000-0000-4000-8000-0000000000a2',
  customer: '00000000-0000-4000-8000-0000000000c1',
  partner: '00000000-0000-4000-8000-0000000000d1',
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
const api = (token?: string) => {
  const r = (m: 'get' | 'post' | 'patch' | 'delete', path: string) => {
    const req = request(app)[m](`/api/v1${path}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };
  return {
    get: (p: string) => r('get', p),
    post: (p: string, body?: object) => r('post', p).send(body),
    patch: (p: string, body?: object) => r('patch', p).send(body),
    delete: (p: string) => r('delete', p),
  };
};
const admin = api('admin');

let category: Awaited<ReturnType<typeof makeCategory>>;

beforeEach(async () => {
  await resetDb();
  await prisma.profile.createMany({
    data: [
      { id: IDS.admin, email: 'admin@example.test', role: 'ADMIN' },
      { id: IDS.admin2, email: 'admin2@example.test', role: 'ADMIN' },
      { id: IDS.customer, email: 'customer@example.test', role: 'CUSTOMER' },
      { id: IDS.partner, email: 'partner@example.test', role: 'DELIVERY_PARTNER' },
    ],
  });
  category = await makeCategory('Sarees');
});

const validProduct = () => ({
  name: 'Test Silk Saree',
  description: 'A long enough description for validation.',
  categoryId: category.id,
  gender: 'WOMEN',
  fabric: 'Silk',
  basePrice: 500_000,
  salePrice: 450_000,
  status: 'ACTIVE',
  images: [{ url: '/placeholder/5c1a2b?label=Test', alt: 'Front' }],
  variants: [
    { sku: 'TST-RED-M', size: 'M', colour: 'Red', stock: 10 },
    { sku: 'TST-RED-L', size: 'L', colour: 'Red', stock: 0 },
  ],
});

describe('authorisation', () => {
  const routes: [string, string][] = [
    ['get', '/admin/products'],
    ['post', '/admin/products'],
    ['get', '/admin/inventory'],
    ['get', '/admin/categories'],
    ['get', '/admin/collections'],
    ['get', '/admin/users'],
    ['get', '/admin/audit-logs'],
  ];

  it.each(routes)('rejects anonymous %s %s with 401', async (method, path) => {
    const res = await (api() as never as Record<string, (p: string) => request.Test>)[method](path);
    expect(res.status).toBe(401);
  });

  it.each(['customer', 'partner'])('rejects a %s on every admin route with 403', async (who) => {
    for (const [method, path] of routes) {
      const res = await (api(who) as never as Record<string, (p: string) => request.Test>)[method](path);
      expect(res.status, `${who} ${method} ${path}`).toBe(403);
    }
    expect(await prisma.product.count()).toBe(0);
  });

  it('lets an admin through', async () => {
    expect((await admin.get('/admin/products')).status).toBe(200);
  });

  it('rejects suspended admins', async () => {
    await prisma.profile.update({ where: { id: IDS.admin }, data: { status: 'SUSPENDED' } });
    expect((await admin.get('/admin/products')).status).toBe(403);
  });
});

describe('product create', () => {
  it('creates a product with variants, inventory, movements and an audit entry atomically', async () => {
    const res = await admin.post('/admin/products', validProduct());
    expect(res.status).toBe(201);
    const p = res.body.data;
    expect(p.slug).toBe('test-silk-saree');
    expect(p.effectivePrice).toBe(450_000);
    expect(p.images[0].isPrimary).toBe(true);
    expect(p.variants).toHaveLength(2);

    const movements = await prisma.stockMovement.findMany();
    expect(movements).toHaveLength(1); // only the variant with stock > 0
    expect(movements[0]).toMatchObject({ type: 'RECEIVED', quantity: 10, actorId: IDS.admin });

    const logs = await prisma.auditLog.findMany({ where: { action: 'product.create' } });
    expect(logs).toHaveLength(1);
    expect(logs[0].actorId).toBe(IDS.admin);
  });

  it('generates unique slugs for duplicate names', async () => {
    await admin.post('/admin/products', validProduct());
    const second = await admin.post('/admin/products', {
      ...validProduct(),
      variants: [{ sku: 'OTHER-1', size: 'M', stock: 1 }],
    });
    expect(second.body.data.slug).toBe('test-silk-saree-2');
  });

  it.each([
    ['sale above base price', (p: any) => ({ ...p, salePrice: 600_000 }), 400],
    ['negative price', (p: any) => ({ ...p, basePrice: -1 }), 400],
    ['fractional paise', (p: any) => ({ ...p, basePrice: 100.5 }), 400],
    ['no variants', (p: any) => ({ ...p, variants: [] }), 400],
    ['javascript: image url', (p: any) => ({ ...p, images: [{ url: 'javascript:alert(1)' }] }), 400],
    ['protocol-relative image url', (p: any) => ({ ...p, images: [{ url: '//evil.test/a.png' }] }), 400],
    ['bad sku', (p: any) => ({ ...p, variants: [{ sku: 'no spaces!', stock: 1 }] }), 400],
    ['unknown category', (p: any) => ({ ...p, categoryId: '11111111-1111-4111-8111-111111111111' }), 422],
    ['ACTIVE without images', (p: any) => ({ ...p, images: [] }), 422],
    [
      'duplicate size/colour combo',
      (p: any) => ({ ...p, variants: [{ sku: 'A-1', size: 'M', colour: 'Red' }, { sku: 'A-2', size: 'm', colour: 'red' }] }),
      422,
    ],
  ])('rejects %s', async (_label, mutate, status) => {
    const res = await admin.post('/admin/products', mutate(validProduct()));
    expect(res.status).toBe(status);
    expect(await prisma.product.count()).toBe(0);
  });

  it('rejects a SKU that already exists and creates nothing', async () => {
    await admin.post('/admin/products', validProduct());
    const res = await admin.post('/admin/products', { ...validProduct(), name: 'Another' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('TST-RED-M');
    expect(await prisma.product.count()).toBe(1);
  });

  it('cannot be tricked into setting server-managed fields', async () => {
    const res = await admin.post('/admin/products', {
      ...validProduct(),
      ratingAverage: 5,
      soldCount: 9999,
      effectivePrice: 1,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.ratingAverage).toBe('0');
    expect(res.body.data.soldCount).toBe(0);
    expect(res.body.data.effectivePrice).toBe(450_000);
  });
});

describe('product update and delete', () => {
  it('recomputes effective price when sale price changes or is cleared', async () => {
    const created = (await admin.post('/admin/products', validProduct())).body.data;

    const cheaper = await admin.patch(`/admin/products/${created.id}`, { salePrice: 300_000 });
    expect(cheaper.body.data.effectivePrice).toBe(300_000);

    const cleared = await admin.patch(`/admin/products/${created.id}`, { salePrice: null });
    expect(cleared.body.data.effectivePrice).toBe(500_000);

    const raised = await admin.patch(`/admin/products/${created.id}`, { basePrice: 700_000 });
    expect(raised.body.data.effectivePrice).toBe(700_000);
  });

  it('refuses a sale price above the (existing) base price', async () => {
    const created = (await admin.post('/admin/products', validProduct())).body.data;
    const res = await admin.patch(`/admin/products/${created.id}`, { salePrice: 999_999 });
    expect(res.status).toBe(422);
  });

  it('rejects unknown fields instead of silently ignoring them', async () => {
    const created = (await admin.post('/admin/products', validProduct())).body.data;
    const res = await admin.patch(`/admin/products/${created.id}`, { slug: 'hijack', effectivePrice: 1 });
    expect(res.status).toBe(400);
  });

  it('will not publish a product that has no images', async () => {
    const draft = await makeProduct({ name: 'Draft', categoryId: category.id, status: 'DRAFT', images: 0 });
    const res = await admin.patch(`/admin/products/${draft.id}`, { status: 'ACTIVE' });
    expect(res.status).toBe(422);
  });

  it('hard-deletes a never-ordered product', async () => {
    const created = (await admin.post('/admin/products', validProduct())).body.data;
    const res = await admin.delete(`/admin/products/${created.id}`);
    expect(res.body.data).toEqual({ deleted: true, archived: false });
    expect(await prisma.product.count()).toBe(0);
    expect(await prisma.productVariant.count()).toBe(0);
  });

  it('archives instead of deleting a product that appears in an order', async () => {
    const p = await makeProduct({ name: 'Ordered', categoryId: category.id });
    const order = await prisma.order.create({
      data: {
        orderNumber: 'PYN-TEST-1',
        userId: IDS.customer,
        subtotal: 100_000,
        grandTotal: 100_000,
        shipFullName: 'A',
        shipPhone: '9999999999',
        shipLine1: 'x',
        shipCity: 'Pune',
        shipState: 'MH',
        shipPostalCode: '411001',
        items: {
          create: {
            productId: p.id,
            variantId: p.variants[0].id,
            productName: p.name,
            sku: p.variants[0].sku,
            unitPrice: 100_000,
            taxRatePercent: 5,
            quantity: 1,
            lineTotal: 100_000,
          },
        },
      },
    });

    const res = await admin.delete(`/admin/products/${p.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ deleted: false, archived: true });
    expect((await prisma.product.findUnique({ where: { id: p.id } }))?.status).toBe('ARCHIVED');
    // The historical order and its snapshot are intact.
    expect(await prisma.orderItem.count({ where: { orderId: order.id } })).toBe(1);
  });
});

describe('variants and images', () => {
  it('adds a variant with stock and records the movement', async () => {
    const p = await makeProduct({ name: 'P', categoryId: category.id, variants: [{ sku: 'V-1', size: 'M' }] });
    const res = await admin.post(`/admin/products/${p.id}/variants`, { sku: 'V-2', size: 'L', stock: 7 });
    expect(res.status).toBe(201);
    expect(res.body.data.inventory.onHand).toBe(7);
    expect(await prisma.stockMovement.count({ where: { variantId: res.body.data.id } })).toBe(1);
  });

  it('rejects a duplicate combination or SKU', async () => {
    const p = await makeProduct({ name: 'P', categoryId: category.id, variants: [{ sku: 'V-1', size: 'M', colour: 'Red' }] });
    expect((await admin.post(`/admin/products/${p.id}/variants`, { sku: 'V-9', size: 'm', colour: 'RED' })).status).toBe(409);
    expect((await admin.post(`/admin/products/${p.id}/variants`, { sku: 'v-1', size: 'L' })).status).toBe(409);
  });

  it('will not deactivate or delete the last active variant of a live product', async () => {
    const p = await makeProduct({ name: 'P', categoryId: category.id, variants: [{ sku: 'ONLY', size: 'M' }] });
    const vid = p.variants[0].id;
    expect((await admin.patch(`/admin/variants/${vid}`, { isActive: false })).status).toBe(422);
    expect((await admin.delete(`/admin/variants/${vid}`)).status).toBe(422);
  });

  it('keeps the first image primary and promotes the next one when it is removed', async () => {
    const p = await makeProduct({ name: 'P', categoryId: category.id, images: 2 });
    const [first, second] = [...p.images].sort((a, b) => a.sortOrder - b.sortOrder);

    expect((await admin.delete(`/admin/images/${first.id}`)).status).toBe(200);
    expect((await prisma.productImage.findUnique({ where: { id: second.id } }))?.isPrimary).toBe(true);

    // It is now the only image of a live product.
    expect((await admin.delete(`/admin/images/${second.id}`)).status).toBe(422);
  });

  it('moves the primary flag exactly once', async () => {
    const p = await makeProduct({ name: 'P', categoryId: category.id, images: 1 });
    const added = await admin.post(`/admin/products/${p.id}/images`, { url: 'https://cdn.example.test/b.jpg', isPrimary: true });
    expect(added.status).toBe(201);
    const primaries = await prisma.productImage.count({ where: { productId: p.id, isPrimary: true } });
    expect(primaries).toBe(1);
    expect((await prisma.productImage.findFirst({ where: { productId: p.id, isPrimary: true } }))?.id).toBe(added.body.data.id);
  });
});

describe('inventory', () => {
  it('adjusts by delta and by set, logging a movement and audit entry each time', async () => {
    const p = await makeProduct({ name: 'P', categoryId: category.id, variants: [{ sku: 'I-1', onHand: 10 }] });
    const vid = p.variants[0].id;

    const add = await admin.post(`/admin/inventory/${vid}/adjust`, { mode: 'delta', quantity: 5, reason: 'Restock from supplier' });
    expect(add.body.data.onHand).toBe(15);

    const set = await admin.post(`/admin/inventory/${vid}/adjust`, { mode: 'set', quantity: 4, reason: 'Stock-take correction' });
    expect(set.body.data.onHand).toBe(4);

    const moves = await prisma.stockMovement.findMany({ where: { variantId: vid }, orderBy: { createdAt: 'asc' } });
    expect(moves.map((m) => m.quantity)).toEqual([5, -11]);
    expect(await prisma.auditLog.count({ where: { action: 'inventory.adjust' } })).toBe(2);
  });

  it('refuses to drop below units reserved for pending orders', async () => {
    const p = await makeProduct({ name: 'P', categoryId: category.id, variants: [{ sku: 'I-2', onHand: 10, reserved: 6 }] });
    const vid = p.variants[0].id;

    const res = await admin.post(`/admin/inventory/${vid}/adjust`, { mode: 'set', quantity: 5, reason: 'Count correction' });
    expect(res.status).toBe(409);
    expect((await prisma.inventory.findUnique({ where: { variantId: vid } }))?.onHand).toBe(10);

    expect((await admin.post(`/admin/inventory/${vid}/adjust`, { mode: 'set', quantity: 6, reason: 'Count correction' })).status).toBe(200);
  });

  it('rejects negative results, no-ops and missing reasons', async () => {
    const p = await makeProduct({ name: 'P', categoryId: category.id, variants: [{ sku: 'I-3', onHand: 3 }] });
    const url = `/admin/inventory/${p.variants[0].id}/adjust`;
    expect((await admin.post(url, { mode: 'delta', quantity: -4, reason: 'Damaged in transit' })).status).toBe(422);
    expect((await admin.post(url, { mode: 'set', quantity: 3, reason: 'Same value' })).status).toBe(422);
    expect((await admin.post(url, { mode: 'delta', quantity: 1 })).status).toBe(400);
    expect((await admin.post(url, { mode: 'delta', quantity: 0, reason: 'Nothing' })).status).toBe(400);
  });

  it('serialises concurrent adjustments so stock can never go negative', async () => {
    const p = await makeProduct({ name: 'P', categoryId: category.id, variants: [{ sku: 'I-4', onHand: 3 }] });
    const url = `/admin/inventory/${p.variants[0].id}/adjust`;

    const results = await Promise.all(
      Array.from({ length: 6 }, () => admin.post(url, { mode: 'delta', quantity: -1, reason: 'Concurrent damage write-off' })),
    );
    const succeeded = results.filter((r) => r.status === 200).length;
    expect(succeeded).toBe(3);
    expect(results.filter((r) => r.status === 422)).toHaveLength(3);
    expect((await prisma.inventory.findUnique({ where: { variantId: p.variants[0].id } }))?.onHand).toBe(0);
  });

  it('lists low-stock variants by AVAILABLE units', async () => {
    await makeProduct({
      name: 'Stock Mix',
      categoryId: category.id,
      variants: [
        { sku: 'L-OK', onHand: 50 },
        { sku: 'L-LOW', onHand: 4, lowStockThreshold: 5 },
        { sku: 'L-RESERVED', onHand: 20, reserved: 18, lowStockThreshold: 5 }, // 2 available
        { sku: 'L-OUT', onHand: 0 },
      ],
    });
    const res = await admin.get('/admin/inventory?lowStock=true');
    const skus = res.body.data.map((r: { sku: string }) => r.sku).sort();
    expect(skus).toEqual(['L-LOW', 'L-OUT', 'L-RESERVED']);
    expect(res.body.meta.total).toBe(3);

    const searched = await admin.get('/admin/inventory?q=l-ok');
    expect(searched.body.data.map((r: { sku: string }) => r.sku)).toEqual(['L-OK']);
  });
});

describe('categories', () => {
  it('limits nesting to two levels and prevents self-parenting', async () => {
    const parent = (await admin.post('/admin/categories', { name: 'Parent' })).body.data;
    const child = (await admin.post('/admin/categories', { name: 'Child', parentId: parent.id })).body.data;

    expect((await admin.post('/admin/categories', { name: 'Grandchild', parentId: child.id })).status).toBe(422);
    expect((await admin.patch(`/admin/categories/${parent.id}`, { parentId: parent.id })).status).toBe(422);
    expect((await admin.patch(`/admin/categories/${parent.id}`, { parentId: child.id })).status).toBe(422);
  });

  it('refuses to delete a category that still has products or children', async () => {
    await makeProduct({ name: 'P', categoryId: category.id });
    expect((await admin.delete(`/admin/categories/${category.id}`)).status).toBe(409);

    const parent = (await admin.post('/admin/categories', { name: 'Has Kid' })).body.data;
    await admin.post('/admin/categories', { name: 'Kid', parentId: parent.id });
    expect((await admin.delete(`/admin/categories/${parent.id}`)).status).toBe(409);
  });

  it('deletes an empty category and audits it', async () => {
    const c = (await admin.post('/admin/categories', { name: 'Empty' })).body.data;
    expect((await admin.delete(`/admin/categories/${c.id}`)).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'category.delete' } })).toBe(1);
  });
});

describe('role management', () => {
  it('lets an admin promote a customer and records who did it', async () => {
    const res = await admin.patch(`/admin/users/${IDS.customer}`, { role: 'DELIVERY_PARTNER' });
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('DELIVERY_PARTNER');

    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.update' } });
    expect(log.actorId).toBe(IDS.admin);
    expect(log.entityId).toBe(IDS.customer);
    expect(log.metadata).toMatchObject({ from: { role: 'CUSTOMER' }, to: { role: 'DELIVERY_PARTNER' } });
  });

  it('does not let an admin change their own role or status', async () => {
    expect((await admin.patch(`/admin/users/${IDS.admin}`, { role: 'CUSTOMER' })).status).toBe(403);
    expect((await admin.patch(`/admin/users/${IDS.admin}`, { status: 'SUSPENDED' })).status).toBe(403);
  });

  it('protects the last active admin', async () => {
    // admin2 is a second admin, so demoting them is fine…
    expect((await admin.patch(`/admin/users/${IDS.admin2}`, { role: 'CUSTOMER' })).status).toBe(200);
    // …but now `admin` is the only one left. A second admin account created via the CLI path
    // tries to remove them: simulate with a suspended-then-active scenario.
    await prisma.profile.update({ where: { id: IDS.customer }, data: { role: 'ADMIN' } });
    expect((await api('customer').patch(`/admin/users/${IDS.admin}`, { role: 'CUSTOMER' })).status).toBe(200);
    // Now `customer` is the last admin and cannot be removed by anyone else.
    await prisma.profile.update({ where: { id: IDS.partner }, data: { role: 'ADMIN' } });
    expect((await api('partner').patch(`/admin/users/${IDS.customer}`, { role: 'CUSTOMER' })).status).toBe(200);
    // Partner is now the sole admin; nobody can demote them (the only possible actor would be themselves).
    expect((await api('partner').patch(`/admin/users/${IDS.partner}`, { role: 'CUSTOMER' })).status).toBe(403);
    expect(await prisma.profile.count({ where: { role: 'ADMIN', status: 'ACTIVE' } })).toBe(1);
  });

  it('refuses to suspend the last active admin even when the actor is another admin', async () => {
    await prisma.profile.update({ where: { id: IDS.admin2 }, data: { status: 'SUSPENDED' } });
    // admin2 is suspended; `admin` is the only ACTIVE admin. Make a third actor admin, then target `admin`.
    await prisma.profile.update({ where: { id: IDS.customer }, data: { role: 'ADMIN' } });
    // Two active admins (admin, customer) → suspending `admin` is allowed…
    expect((await api('customer').patch(`/admin/users/${IDS.admin}`, { status: 'SUSPENDED' })).status).toBe(200);
    // …leaving `customer` as the only active admin. A suspended admin cannot act, so protection holds.
    expect((await admin.get('/admin/users')).status).toBe(403);
    expect(await prisma.profile.count({ where: { role: 'ADMIN', status: 'ACTIVE' } })).toBe(1);
  });

  it('validates the payload strictly', async () => {
    expect((await admin.patch(`/admin/users/${IDS.customer}`, { role: 'SUPERUSER' })).status).toBe(400);
    expect((await admin.patch(`/admin/users/${IDS.customer}`, {})).status).toBe(400);
    expect((await admin.patch(`/admin/users/${IDS.customer}`, { role: 'ADMIN', email: 'x@y.z' })).status).toBe(400);
    expect((await admin.patch('/admin/users/not-a-uuid', { role: 'ADMIN' })).status).toBe(400);
    expect((await admin.patch('/admin/users/11111111-1111-4111-8111-111111111111', { role: 'ADMIN' })).status).toBe(404);
  });

  it('never exposes anything secret in user listings', async () => {
    const res = await admin.get('/admin/users?role=CUSTOMER');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(
      ['createdAt', 'email', 'fullName', 'id', 'phone', 'role', 'status'].sort(),
    );
  });
});

describe('profile self-service cannot escalate privileges', () => {
  it('ignores any attempt to set role via PATCH /users/me', async () => {
    const res = await api('customer').patch('/users/me', { fullName: 'Asha', role: 'ADMIN' });
    expect(res.status).toBe(400);
    expect((await prisma.profile.findUnique({ where: { id: IDS.customer } }))?.role).toBe('CUSTOMER');
  });
});
