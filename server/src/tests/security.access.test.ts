import { readFileSync } from 'node:fs';
import type { Test } from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Authentication and authorisation boundaries, checked by SWEEPING every route the API registers rather than
 * by listing the ones somebody remembered. A route added tomorrow is covered automatically — and an
 * unauthenticated one has to be added to PUBLIC below, on purpose, in a reviewed diff.
 */
const TOKENS: Record<string, string> = {
  admin: '00000000-0000-4000-8000-0000000000a1',
  alice: '00000000-0000-4000-8000-0000000000c1',
  bob: '00000000-0000-4000-8000-0000000000c2',
  carol: '00000000-0000-4000-8000-0000000000c3',
  rider1: '00000000-0000-4000-8000-0000000000d1',
  rider2: '00000000-0000-4000-8000-0000000000d2',
  frozen: '00000000-0000-4000-8000-0000000000f1', // a suspended ADMIN
  frozenCustomer: '00000000-0000-4000-8000-0000000000f2',
};
vi.mock('jose', () => ({
  createRemoteJWKSet: () => ({}),
  jwtVerify: async (token: string) => {
    const ids: Record<string, string> = {
      admin: '00000000-0000-4000-8000-0000000000a1',
      alice: '00000000-0000-4000-8000-0000000000c1',
      bob: '00000000-0000-4000-8000-0000000000c2',
      carol: '00000000-0000-4000-8000-0000000000c3',
      rider1: '00000000-0000-4000-8000-0000000000d1',
      rider2: '00000000-0000-4000-8000-0000000000d2',
      frozen: '00000000-0000-4000-8000-0000000000f1',
      frozenCustomer: '00000000-0000-4000-8000-0000000000f2',
    };
    if (!ids[token]) throw new Error('invalid token');
    return { payload: { sub: ids[token], email: `${token}@example.test` } };
  },
}));

const request = (await import('supertest')).default;
const { createApp } = await import('../app.js');
const { prisma } = await import('../config/prisma.js');
const { sensitiveLimiter } = await import('../middleware/rateLimit.js');
const { requireAuth } = await import('../middleware/auth.js');
const { makeCategory, makeProduct, resetDb } = await import('./helpers.js');
const { sim } = await import('./commerce-helpers.js');
const { makeWorld, IDS } = await import('./commerce-world.js');

const { adminRouter } = await import('../modules/admin/admin.routes.js');
const { addressesRouter } = await import('../modules/addresses/addresses.routes.js');
const { cartRouter } = await import('../modules/cart/cart.routes.js');
const { categoriesRouter, collectionsRouter, productsRouter, searchRouter } = await import('../modules/catalogue/catalogue.routes.js');
const { checkoutRouter } = await import('../modules/checkout/checkout.routes.js');
const { couponsRouter } = await import('../modules/coupons/coupons.routes.js');
const { deliveryRouter } = await import('../modules/delivery/delivery.routes.js');
const { healthRouter } = await import('../modules/health/health.routes.js');
const { marketingPublicRouter } = await import('../modules/marketing/marketing.routes.js');
const { notificationsRouter } = await import('../modules/notifications/notifications.routes.js');
const { ordersRouter } = await import('../modules/orders/orders.routes.js');
const { paymentsRouter } = await import('../modules/payments/payments.routes.js');
const { recentlyViewedRouter } = await import('../modules/recently-viewed/recently-viewed.routes.js');
const { reviewsRouter } = await import('../modules/reviews/reviews.routes.js');
const { publicSettingsRouter } = await import('../modules/settings/settings.routes.js');
const { supportRouter } = await import('../modules/support/support.routes.js');
const { usersRouter } = await import('../modules/users/users.routes.js');
const { wishlistRouter } = await import('../modules/wishlist/wishlist.routes.js');

const app = createApp();
const w = makeWorld(app, prisma, { makeCategory, makeProduct });
const alice = w.as('alice');
const bob = w.as('bob');
const FAKE_ID = '00000000-0000-4000-8000-00000000ffff';

// ── route inventory ──────────────────────────────────────────────────────────

interface RouteInfo {
  method: string;
  /** Full path under /api/v1, with :params still in it. */
  pattern: string;
  /** Names of the handlers in the route's own chain (middleware included). */
  chain: unknown[];
}

/** Express keeps registered routes in `router.stack`; sub-routers are layers that carry their own stack. */
function collect(router: any, prefix: string, into: RouteInfo[] = []): RouteInfo[] {
  for (const layer of router.stack as any[]) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        into.push({ method: method.toUpperCase(), pattern: `${prefix}${layer.route.path === '/' ? '' : layer.route.path}`, chain: layer.route.stack.map((l: any) => l.handle) });
      }
    } else if (layer.handle?.stack) {
      collect(layer.handle, prefix, into); // mounted without a path: `router.use(subRouter)`
    }
  }
  return into;
}

/** Mirrors the mounts in app.ts; the first test below fails if the two drift apart. */
const MOUNTS: Record<string, any> = {
  '/health': healthRouter,
  '/users': usersRouter,
  '/categories': categoriesRouter,
  '/collections': collectionsRouter,
  '/products': productsRouter,
  '/search': searchRouter,
  '/addresses': addressesRouter,
  '/wishlist': wishlistRouter,
  '/cart': cartRouter,
  '/coupons': couponsRouter,
  '/checkout': checkoutRouter,
  '/payments': paymentsRouter,
  '/orders': ordersRouter,
  '/delivery': deliveryRouter,
  '/support': supportRouter,
  '/reviews': reviewsRouter,
  '/settings': publicSettingsRouter,
  '/recently-viewed': recentlyViewedRouter,
  '': marketingPublicRouter,
  '/notifications': notificationsRouter,
  '/admin': adminRouter,
};

const ALL = Object.entries(MOUNTS).flatMap(([prefix, router]) => collect(router, prefix));
const concrete = (r: RouteInfo) => r.pattern.replace(/:[A-Za-z]+/g, (p) => (p === ':key' ? 'shipping' : p === ':slug' ? 'some-slug' : FAKE_ID));
const label = (r: RouteInfo) => `${r.method} ${r.pattern}`;

/** Endpoints that are meant to be reachable without signing in. Everything else must answer 401. */
const PUBLIC = new Set<string>([
  'GET /health',
  'GET /health/ready',
  'GET /health/metrics',
  'GET /categories',
  'GET /categories/:slug',
  'GET /collections',
  'GET /products',
  'GET /products/facets',
  'GET /products/:slug',
  'GET /search',
  'GET /search/suggestions',
  'GET /reviews/featured',
  'GET /reviews/product/:slug',
  'GET /settings/public',
  'GET /banners',
  'POST /newsletter/subscribe',
]);

const send = (method: string, path: string, token?: string, body: object = {}) => {
  const req = (request(app) as any)[method.toLowerCase()](`/api/v1${path}`) as Test;
  if (token) req.set('Authorization', `Bearer ${token}`);
  return ['POST', 'PUT', 'PATCH'].includes(method) ? req.send(body) : req;
};

beforeAll(async () => {
  await resetDb();
  await sim('reset');
  await w.reset();
  await prisma.profile.createMany({
    data: [
      { id: TOKENS.rider1, email: 'rider1@example.test', role: 'DELIVERY_PARTNER' },
      { id: TOKENS.rider2, email: 'rider2@example.test', role: 'DELIVERY_PARTNER' },
      { id: TOKENS.frozen, email: 'frozen@example.test', role: 'ADMIN', status: 'SUSPENDED' },
      { id: TOKENS.frozenCustomer, email: 'frozenCustomer@example.test', status: 'SUSPENDED' },
    ],
  });
});

describe('route inventory', () => {
  it('knows every router that app.ts mounts', () => {
    const source = readFileSync(new URL('../app.ts', import.meta.url), 'utf8');
    const prefixed = [...source.matchAll(/v1\.use\('([^']+)'/g)].map((m) => m[1]);
    const bare = [...source.matchAll(/v1\.use\((\w+)\)/g)].length;
    expect(Object.keys(MOUNTS).filter(Boolean).sort()).toEqual([...prefixed].sort());
    expect(bare).toBe(Object.keys(MOUNTS).filter((k) => k === '').length);
  });

  it('finds the whole API (guards the sweeps below against silently testing nothing)', () => {
    expect(ALL.length).toBeGreaterThan(100);
    expect(ALL.filter((r) => r.pattern.startsWith('/admin')).length).toBeGreaterThan(50);
    expect(ALL.some((r) => r.method === 'DELETE')).toBe(true);
  });

  it('lists only real routes in the public allow-list (a typo there would hide a route)', () => {
    const known = new Set(ALL.map(label));
    for (const p of PUBLIC) expect(known.has(p), `${p} is not a registered route`).toBe(true);
  });
});

describe('authentication: nothing but the public allow-list answers an anonymous caller', () => {
  const protectedRoutes = ALL.filter((r) => !PUBLIC.has(label(r)));

  it.each(protectedRoutes.map((r) => [label(r), r] as const))('%s → 401', async (_l, r) => {
    const res = await send(r.method, concrete(r));
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
  });

  it.each([...PUBLIC].map((p) => [p] as const))('public: %s is reachable without a token', async (p) => {
    const r = ALL.find((x) => label(x) === p)!;
    const res = await send(r.method, concrete(r));
    expect(res.status, JSON.stringify(res.body)).not.toBe(401);
  });

  it('refuses malformed Authorization headers', async () => {
    for (const header of ['Bearer', 'Bearer ', 'bearer alice', 'Basic YWxpY2U6cHc=', 'alice', 'Token alice', 'Bearer  ']) {
      const res = await request(app).get('/api/v1/users/me').set('Authorization', header);
      expect(res.status, header).toBe(401);
    }
  });

  it('refuses tokens that do not verify', async () => {
    for (const t of ['nobody', "' OR '1'='1", '<script>alert(1)</script>', 'a'.repeat(5_000)]) {
      const res = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${t}`);
      expect(res.status).toBe(401);
    }
  });
});

describe('suspended accounts lose every protected route, whatever their role', () => {
  const protectedRoutes = ALL.filter((r) => !PUBLIC.has(label(r)));
  it.each(['frozen', 'frozenCustomer'])('%s is refused with 403 everywhere', async (who) => {
    for (const r of protectedRoutes) {
      const res = await send(r.method, concrete(r), who);
      expect(res.status, label(r)).toBe(403);
    }
  });
});

describe('authorisation: the admin API', () => {
  const adminRoutes = ALL.filter((r) => r.pattern.startsWith('/admin'));

  it('has a single router-level guard in front of every admin route', () => {
    // The first layer of the admin router must be the authentication middleware; the role check follows it.
    const layers = (adminRouter as any).stack.slice(0, 2).map((l: any) => l.handle);
    expect(layers[0]).toBe(requireAuth);
    expect(layers).toHaveLength(2);
  });

  it.each([
    ['a customer', 'alice'],
    ['a delivery partner', 'rider1'],
  ])('refuses %s on every admin route (403) and changes nothing', async (_who, token) => {
    const before = await snapshot();
    for (const r of adminRoutes) {
      const res = await send(r.method, concrete(r), token);
      expect(res.status, label(r)).toBe(403);
      expect(res.body).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
    }
    expect(await snapshot()).toEqual(before);
  });

  it('lets a real admin in (the sweep above is not passing because everything is blocked)', async () => {
    for (const p of ['/admin/settings', '/admin/orders', '/admin/users', '/admin/audit-logs']) {
      expect((await send('GET', p, 'admin')).status, p).toBe(200);
    }
  });

  it('cannot be reached by claiming a role in the token or on the request', async () => {
    // The mocked verifier hands back no role claim; the jwt suite proves real tokens carrying one are ignored.
    const res = await alice.get('/admin/users').set('X-User-Role', 'ADMIN').set('X-Role', 'ADMIN').query({ role: 'ADMIN', isAdmin: 'true' });
    expect(res.status).toBe(403);
  });

  it('cannot be reached via method override, path tricks or case changes', async () => {
    expect((await request(app).post('/api/v1/admin/products').set('Authorization', 'Bearer alice').set('X-HTTP-Method-Override', 'GET').send({})).status).toBe(403);
    for (const path of ['/api/v1/admin/../admin/users', '/api/v1//admin/users', '/api/v1/ADMIN/users', '/api/v1/admin/users/', '/api/v1/admin%2Fusers', '/api/v1/admin;/users']) {
      const res = await request(app).get(path).set('Authorization', 'Bearer alice');
      expect([401, 403, 404], path).toContain(res.status);
      expect(res.body?.data, path).toBeUndefined(); // never data
    }
  });
});

describe('authorisation: the delivery API', () => {
  const deliveryRoutes = ALL.filter((r) => r.pattern.startsWith('/delivery'));
  /** Open to any signed-in user: look at your own application, or apply. */
  const ANY_SIGNED_IN = new Set(['GET /delivery/me', 'POST /delivery/apply']);

  it.each(deliveryRoutes.filter((r) => !ANY_SIGNED_IN.has(label(r))).map((r) => [label(r), r] as const))(
    '%s refuses customers and admins (403)',
    async (_l, r) => {
      for (const who of ['alice', 'admin']) {
        const res = await send(r.method, concrete(r), who);
        expect(res.status, `${label(r)} as ${who}`).toBe(403);
      }
    },
  );

  it('lets the open endpoints through to any signed-in user', async () => {
    expect((await alice.get('/delivery/me')).status).toBe(200);
  });

  it('gives partners no way into customer-only or admin data', async () => {
    for (const p of ['/admin/orders', '/admin/customers', '/admin/delivery-partners']) expect((await send('GET', p, 'rider1')).status, p).toBe(403);
  });
});

describe('abuse limits are wired onto the sensitive endpoints', () => {
  // express-rate-limit's behaviour is proven in rateLimit.test.ts; this proves the limiter is actually IN FRONT of
  // each endpoint that needs it, which is the thing that goes missing when a route is added.
  const LIMITED = [
    'PUT /cart/coupon',
    'POST /coupons/validate',
    'POST /checkout',
    'POST /payments/verify',
    'POST /payments/:orderId/retry',
    'POST /orders/:id/cancel',
    'POST /orders/:id/returns',
    'POST /reviews',
    'POST /support',
    'POST /delivery/apply',
    'POST /delivery/assignments/:id/status',
    'POST /newsletter/subscribe',
    'PATCH /admin/users/:id', // role and suspension changes
    'POST /admin/orders/:id/cancel',
    'POST /admin/orders/:id/refund',
    'POST /admin/refunds/:id/retry',
    'PATCH /admin/delivery-partners/:id',
    'POST /admin/orders/:id/assignment',
    'DELETE /admin/orders/:id/assignment',
    'POST /admin/orders/:id/assignment/reissue-code',
    'PATCH /admin/support/:id',
  ];
  it.each(LIMITED.map((p) => [p] as const))('%s', (p) => {
    const route = ALL.find((r) => label(r) === p);
    if (!route) return void expect.soft(p, 'registered route').toBe('missing');
    expect(route.chain, p).toContain(sensitiveLimiter);
  });
});

// ── IDOR: somebody else's id looks exactly like a missing one ───────────────

async function snapshot() {
  const [products, coupons, orders, addresses, reviews, banners, profiles, audit] = await Promise.all([
    prisma.product.count(),
    prisma.coupon.count(),
    prisma.order.count(),
    prisma.address.count(),
    prisma.review.count(),
    prisma.banner.count(),
    prisma.profile.findMany({ select: { id: true, role: true, status: true }, orderBy: { id: 'asc' } }),
    prisma.auditLog.count(),
  ]);
  return { products, coupons, orders, addresses, reviews, banners, profiles, audit };
}

describe('IDOR: one customer cannot read or touch another customer’s records', () => {
  // Each case starts from an empty shop: leftovers from one case must not leak into another's "bob sees nothing".
  beforeEach(async () => {
    await resetDb();
    await sim('reset');
    await w.reset();
  });

  it('orders: every per-order endpoint answers 404, identically to an order that does not exist', async () => {
    const item = await w.sellable({ onHand: 20 });
    const placed = await w.placeOnline(alice, [{ variantId: item.variantId }]);
    const id = placed.order.id;
    const before = await w.orderOf(id);

    const attempts: [string, string, object?][] = [
      ['GET', `/orders/${id}`],
      ['GET', `/orders/${id}/invoice`],
      ['POST', `/orders/${id}/cancel`, { reason: 'not mine' }],
      ['POST', `/orders/${id}/returns`, { type: 'RETURN', reason: 'not mine' }],
      ['POST', `/orders/${id}/reorder`],
      ['POST', `/payments/${id}/retry`],
    ];
    for (const [method, path, body] of attempts) {
      const stranger = await send(method, path, 'bob', body);
      const missing = await send(method, path.replace(id, FAKE_ID), 'bob', body);
      expect(stranger.status, `${method} ${path}`).toBe(404);
      // Same status AND same body: nothing tells a prober which ids exist.
      expect(stranger.body, `${method} ${path}`).toEqual(missing.body);
    }
    const after = await w.orderOf(id);
    expect(after.fulfilmentStatus).toBe(before.fulfilmentStatus);
    expect(after.paymentStatus).toBe(before.paymentStatus);
    expect(after.grandTotal).toBe(before.grandTotal);
    // …and it is really the owner's, so the 404 above was about ownership, not about a broken route.
    expect((await alice.get(`/orders/${id}`)).status).toBe(200);
  });

  it('orders: lists never include another customer’s orders', async () => {
    const item = await w.sellable({ onHand: 20 });
    await w.placeOnline(alice, [{ variantId: item.variantId }]);
    const list = await bob.get('/orders');
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([]);
  });

  it('addresses: another customer’s address cannot be read, changed or deleted', async () => {
    const mine = (await alice.post('/addresses', { fullName: 'Asha Rao', phone: '9876543210', line1: '12 MG Road', city: 'Pune', state: 'Maharashtra', postalCode: '411001' })).body.data;
    expect((await bob.get('/addresses')).body.data).toEqual([]);
    for (const attempt of [bob.patch(`/addresses/${mine.id}`, { city: 'Hacked' }), bob.delete(`/addresses/${mine.id}`)]) {
      expect((await attempt).status).toBe(404);
    }
    expect((await prisma.address.findUniqueOrThrow({ where: { id: mine.id } })).city).toBe('Pune');
    // Checking out to someone else's address is the same boundary from the other side.
    const item = await w.sellable({ onHand: 5 });
    await bob.post('/cart/items', { variantId: item.variantId, quantity: 1 });
    const res = await bob.post('/checkout', { addressId: mine.id, paymentMethod: 'RAZORPAY', idempotencyKey: 'a-perfectly-fine-key-123' });
    expect([404, 422]).toContain(res.status);
    expect(await prisma.order.count({ where: { userId: IDS.bob } })).toBe(0);
  });

  it('wishlist, cart and recently-viewed are per-person', async () => {
    const item = await w.sellable({ onHand: 5 });
    expect((await alice.post(`/wishlist/${item.productId}`)).status).toBeLessThan(300);
    expect((await alice.post('/cart/items', { variantId: item.variantId, quantity: 2 })).status).toBeLessThan(300);
    expect((await alice.post(`/recently-viewed/${item.productId}`)).status).toBeLessThan(300);

    expect((await bob.get('/wishlist')).body.data).toEqual([]);
    expect((await bob.get('/recently-viewed')).body.data).toEqual([]);
    expect((await bob.get('/cart')).body.data.items ?? []).toEqual([]);

    await bob.delete(`/wishlist/${item.productId}`); // bob removing "his" entry must not remove alice's
    await bob.delete(`/cart/items/${item.variantId}`);
    await bob.delete(`/recently-viewed/${item.productId}`);
    expect((await alice.get('/wishlist')).body.data).toHaveLength(1);
    expect((await alice.get('/cart')).body.data.items).toHaveLength(1);
    expect((await alice.get('/recently-viewed')).body.data).toHaveLength(1);
  });

  it('reviews: only the author edits or deletes; the author’s list is private', async () => {
    const item = await w.sellable({ onHand: 20 });
    const placed = await w.placeOnline(alice, [{ variantId: item.variantId }]);
    await w.payAndVerify(alice, placed);
    await w.deliver(placed.order.id);
    const made = (await alice.post('/reviews', { productId: item.productId, orderId: placed.order.id, rating: 4 })).body.data;

    expect((await bob.patch(`/reviews/${made.id}`, { rating: 1 })).status).toBe(404);
    expect((await bob.delete(`/reviews/${made.id}`)).status).toBe(404);
    expect((await bob.get('/reviews/mine')).body.data).toEqual({ toReview: [], reviewed: [] });
    // Nor can bob review on the strength of alice's order.
    expect((await bob.post('/reviews', { productId: item.productId, orderId: placed.order.id, rating: 1 })).status).toBeGreaterThanOrEqual(400);
    expect((await prisma.review.findUniqueOrThrow({ where: { id: made.id } })).rating).toBe(4);
    expect(await prisma.review.count()).toBe(1);
  });

  it('support: requests are listed only to their author, and cannot be attached to another customer’s order', async () => {
    const item = await w.sellable({ onHand: 20 });
    const placed = await w.placeOnline(alice, [{ variantId: item.variantId }]);
    const own = await alice.post('/support', { subject: 'Where is my parcel', message: 'It has not arrived yet, please check.', orderId: placed.order.id });
    expect(own.status).toBe(201);

    expect((await bob.get('/support')).body.data).toEqual([]);
    const sneaky = await bob.post('/support', { subject: 'About that order', message: 'Trying to attach to a stranger’s order.', orderId: placed.order.id });
    expect(sneaky.status).toBeGreaterThanOrEqual(400);
    expect(sneaky.status).toBeLessThan(500);
    expect(await prisma.supportRequest.count({ where: { userId: IDS.bob } })).toBe(0);
  });

  it('notifications: marking someone else’s notification read changes nothing', async () => {
    const n = await prisma.notification.create({ data: { userId: IDS.alice, title: 'Hello', body: 'Private' } });
    await bob.patch(`/notifications/${n.id}/read`);
    await bob.post('/notifications/read-all');
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).isRead).toBe(false);
    expect((await bob.get('/notifications')).body.data).toEqual([]);
  });

  it('delivery assignments: an approved partner sees only their own jobs (cross-partner cases live in delivery.test.ts)', async () => {
    const applied = await w.as('carol').post('/delivery/apply', {
      fullName: 'Ravi Kumar',
      phone: '9811122233',
      vehicleType: 'Motorcycle',
      vehicleNumber: 'MH12AB1234',
      serviceCity: 'Pune',
      idDocumentType: 'Driving licence',
      idDocumentRef: 'DL-…4321',
    });
    expect(applied.status, JSON.stringify(applied.body)).toBe(201);
    expect((await w.admin.patch(`/admin/delivery-partners/${applied.body.data.id}`, { action: 'approve' })).status).toBe(200);

    const carol = w.as('carol');
    expect((await carol.get(`/delivery/assignments/${FAKE_ID}`)).status).toBe(404);
    expect((await carol.post(`/delivery/assignments/${FAKE_ID}/status`, { status: 'ACCEPTED' })).status).toBe(404);
    const list = await carol.get('/delivery/assignments');
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([]);
  });
});
