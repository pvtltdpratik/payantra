import { createHmac, randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Hostile input: mass-assignment, type confusion, SQL-injection and script payloads, oversized and malformed bodies,
 * CORS and response headers. The expectation throughout is the same: a clean 4xx (or harmless success), never a 500,
 * and never a side effect the caller was not entitled to.
 */
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

const request = (await import('supertest')).default;
const { createApp } = await import('../app.js');
const { prisma } = await import('../config/prisma.js');
const { makeCategory, makeProduct, resetDb } = await import('./helpers.js');
const { sim } = await import('./commerce-helpers.js');
const { makeWorld, IDS, ADDRESS } = await import('./commerce-world.js');

const app = createApp();
const w = makeWorld(app, prisma, { makeCategory, makeProduct });
const { admin } = w;
const alice = w.as('alice');
const bob = w.as('bob');
const api = (path: string) => request(app).get(`/api/v1${path}`);

beforeEach(async () => {
  await resetDb();
  await sim('reset');
  await w.reset();
});

const counts = async () => ({
  products: await prisma.product.count(),
  categories: await prisma.category.count(),
  profiles: await prisma.profile.count(),
  orders: await prisma.order.count(),
  addresses: await prisma.address.count(),
});

/** Nothing about an error response may reveal how the server is built. */
function expectNoInternals(body: unknown) {
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/\bat\s+\S+\s+\(|node_modules|\.ts:\d+|\.js:\d+|PrismaClient|Prisma\b|SELECT\s|INSERT\s|stack/i);
}

const SQLI = [
  "' OR '1'='1",
  "'; DROP TABLE \"Product\";--",
  '" OR ""="',
  "1; SELECT pg_sleep(5)--",
  "' UNION SELECT id, email, role FROM \"Profile\"--",
  "\\'; DELETE FROM \"Order\"; --",
  '%', '_', '\\', "%' OR 1=1 --",
  '${7*7}', '{{7*7}}', '$(id)', '`id`',
  '\u0000', '\u0000\u0001\u0002',
  'Robert\'); DROP TABLE Students;--',
];

const XSS = [
  '<script>alert(1)</script>',
  '"><img src=x onerror=alert(1)>',
  "'><svg/onload=alert(1)>",
  'javascript:alert(1)',
  '<iframe src="javascript:alert(1)"></iframe>',
  '{{constructor.constructor("alert(1)")()}}',
];

describe('mass assignment: fields the caller does not own are rejected or ignored', () => {
  it('PATCH /users/me refuses every privileged or identity field', async () => {
    for (const extra of [{ role: 'ADMIN' }, { status: 'SUSPENDED' }, { email: 'x@example.test' }, { id: IDS.bob }, { createdAt: '2001-01-01' }, { isAdmin: true }]) {
      const res = await alice.patch('/users/me', { fullName: 'Asha Rao', ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }
    const row = await prisma.profile.findUniqueOrThrow({ where: { id: IDS.alice } });
    expect(row.role).toBe('CUSTOMER');
    expect(row.email).toBe('alice@example.test');
  });

  it('an address cannot be created for, or moved to, somebody else', async () => {
    const created = await alice.post('/addresses', { ...ADDRESS, userId: IDS.bob });
    expect([201, 400]).toContain(created.status);
    expect(await prisma.address.count({ where: { userId: IDS.bob } })).toBe(0);

    const mine = (await alice.post('/addresses', ADDRESS)).body.data;
    const moved = await alice.patch(`/addresses/${mine.id}`, { userId: IDS.bob, city: 'Mumbai' });
    expect([200, 400]).toContain(moved.status);
    expect((await prisma.address.findUniqueOrThrow({ where: { id: mine.id } })).userId).toBe(IDS.alice);
  });

  it('a cart line takes its price from the catalogue, not from the request', async () => {
    const item = await w.sellable({ price: 250_000, onHand: 5 });
    const res = await alice.post('/cart/items', { variantId: item.variantId, quantity: 1, unitPrice: 1, price: 1, lineTotal: 1 });
    expect([200, 201, 400]).toContain(res.status);
    const cart = (await alice.get('/cart')).body.data;
    for (const line of cart.items) expect(line.unitPrice).toBe(250_000);
  });

  it('an order total is computed on the server, whatever the client claims', async () => {
    const item = await w.sellable({ price: 100_000, onHand: 5 });
    await alice.post('/cart/items', { variantId: item.variantId, quantity: 1 });
    const addressId = (await alice.post('/addresses', ADDRESS)).body.data.id;
    const res = await alice.post('/checkout', {
      addressId,
      paymentMethod: 'RAZORPAY',
      idempotencyKey: 'key-for-total-tampering-0001',
      grandTotal: 1,
      subtotal: 1,
      discountTotal: 99_999,
      shippingTotal: 0,
      paymentStatus: 'PAID',
      fulfilmentStatus: 'DELIVERED',
      userId: IDS.bob,
    });
    expect([201, 400]).toContain(res.status);
    const orders = await prisma.order.findMany();
    for (const o of orders) {
      expect(o.userId).toBe(IDS.alice);
      expect(o.grandTotal).toBeGreaterThanOrEqual(100_000);
      expect(o.paymentStatus).not.toBe('PAID');
      expect(o.fulfilmentStatus).not.toBe('DELIVERED');
    }
  });

  it('support requests and reviews cannot be created pre-approved, pre-answered or on behalf of someone else', async () => {
    const support = await alice.post('/support', { subject: 'A real problem', message: 'Describing it here in detail.', status: 'RESOLVED', adminReply: 'Done', userId: IDS.bob });
    expect([201, 400]).toContain(support.status);
    for (const row of await prisma.supportRequest.findMany()) {
      expect(row.userId).toBe(IDS.alice);
      expect(row.status).toBe('OPEN');
    }
    const item = await w.sellable({ onHand: 10 });
    const res = await alice.post('/reviews', { productId: item.productId, orderId: IDS.bob, rating: 5, isVisible: true, userId: IDS.bob, isVerifiedPurchase: true });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await prisma.review.count()).toBe(0);
  });

  it('admins are held to the same shape: unknown fields on an admin write are refused', async () => {
    expect((await admin.patch(`/admin/users/${IDS.alice}`, { role: 'CUSTOMER', passwordHash: 'x', id: IDS.bob })).status).toBe(400);
    expect((await admin.patch(`/admin/users/${IDS.alice}`, { role: 'NOT_A_ROLE' })).status).toBe(400);
  });
});

describe('malformed and hostile requests get a clean error, never a stack trace', () => {
  it('malformed JSON', async () => {
    const res = await request(app).post('/api/v1/addresses').set('Authorization', 'Bearer alice').set('Content-Type', 'application/json').send('{"fullName": "A", ');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: { code: 'BAD_REQUEST' } });
    expectNoInternals(res.body);
  });

  it('a body over the 100 kB limit', async () => {
    const res = await request(app).post('/api/v1/addresses').set('Authorization', 'Bearer alice').send({ ...ADDRESS, line1: 'x'.repeat(150_000) });
    expect(res.status).toBe(413);
    expect(res.body.error.message).toBe('Payload too large');
    expectNoInternals(res.body);
  });

  it('JSON sent under the wrong content type is not silently accepted', async () => {
    const res = await request(app).post('/api/v1/addresses').set('Authorization', 'Bearer alice').set('Content-Type', 'text/plain').send(JSON.stringify(ADDRESS));
    expect(res.status).toBe(400);
    expect(await prisma.address.count()).toBe(0);
  });

  it('a form-encoded body is not parsed (only JSON is accepted)', async () => {
    const res = await request(app).post('/api/v1/addresses').set('Authorization', 'Bearer alice').type('form').send(ADDRESS);
    expect(res.status).toBe(400);
  });

  it('prototype-pollution attempts change nothing', async () => {
    const res = await request(app)
      .post('/api/v1/addresses')
      .set('Authorization', 'Bearer alice')
      .set('Content-Type', 'application/json')
      .send(`{"__proto__":{"isAdmin":true,"role":"ADMIN"},"constructor":{"prototype":{"polluted":true}},"fullName":"Asha Rao","phone":"9876543210","line1":"1 Road","city":"Pune","state":"Maharashtra","postalCode":"411001"}`);
    expect(res.status).toBeLessThan(500);
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((await alice.get('/users/me')).body.data.role).toBe('CUSTOMER');
  });

  it('NUL characters (which PostgreSQL cannot store) are a 400 everywhere, not a 500', async () => {
    for (const path of ['/search?q=%00', '/products?q=a%00b', '/products/x%00y', '/categories/%00']) {
      const res = await api(path);
      expect(res.status, path).toBe(400);
      expectNoInternals(res.body);
    }
    const inBody = await alice.post('/addresses', { ...ADDRESS, line1: 'bad value' });
    expect(inBody.status).toBe(400);
    const inKey = await request(app).post('/api/v1/addresses').set('Authorization', 'Bearer alice').set('Content-Type', 'application/json').send('{"\u0000k":1}');
    expect(inKey.status).toBeLessThan(500);
    expect(await prisma.address.count()).toBe(0);
  });

  it('wrong types where a number, string or object is expected', async () => {
    const item = await w.sellable({ onHand: 5 });
    const badQuantities: unknown[] = [0, -1, 1.5, 1e9, '1', '1; DROP TABLE x', null, [], {}, true, 2 ** 53, Number.MAX_SAFE_INTEGER];
    for (const quantity of badQuantities) {
      const res = await alice.post('/cart/items', { variantId: item.variantId, quantity });
      expect(res.status, JSON.stringify(quantity)).toBeGreaterThanOrEqual(400);
      expect(res.status, JSON.stringify(quantity)).toBeLessThan(500);
    }
    for (const body of [[], 'a string', 42, null]) {
      const res = await request(app).post('/api/v1/cart/items').set('Authorization', 'Bearer alice').set('Content-Type', 'application/json').send(JSON.stringify(body));
      expect(res.status, JSON.stringify(body)).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
    expect((await alice.get('/cart')).body.data.items).toEqual([]);
  });

  it('money is whole paise: fractions, negatives and strings are refused', async () => {
    for (const basePrice of [99.5, -1, '1000', 1e15, null]) {
      const res = await admin.post('/admin/products', { name: 'Tampered', basePrice, categoryId: IDS.admin });
      expect(res.status, JSON.stringify(basePrice)).toBeGreaterThanOrEqual(400);
      expect(res.status, JSON.stringify(basePrice)).toBeLessThan(500);
    }
    expect(await prisma.product.count()).toBe(0);
  });

  it('ids must be UUIDs: junk and injection strings are refused before reaching the database', async () => {
    for (const id of ['1', 'abc', "1' OR '1'='1", '../../etc/passwd', '%00', '00000000-0000-4000-8000-00000000fff', `${'a'.repeat(300)}`]) {
      for (const path of [`/orders/${encodeURIComponent(id)}`, `/addresses/${encodeURIComponent(id)}`]) {
        const res = id.startsWith('..') ? await alice.get(path) : await alice.patch(path.replace('/orders', '/addresses'), { city: 'Pune' });
        expect(res.status, path).toBeGreaterThanOrEqual(400);
        expect(res.status, path).toBeLessThan(500);
        expectNoInternals(res.body);
      }
    }
  });

  it('pagination parameters are bounded', async () => {
    for (const qs of ['page=0', 'page=-5', 'page=abc', 'pageSize=100000', 'pageSize=0', 'page=99999999999999999999', 'page=2147483648', 'pageSize=1.5', 'page[]=1&page[]=2', 'page[$gt]=1']) {
      const res = await api(`/products?${qs}`);
      expect(res.status, qs).toBeLessThan(500);
      expectNoInternals(res.body);
    }
    // And on authenticated lists too.
    for (const qs of ['page=99999999999999999999', 'page=2147483648', 'pageSize=101']) {
      expect((await alice.get(`/orders?${qs}`)).status, qs).toBeLessThan(500);
      expect((await admin.get(`/admin/orders?${qs}`)).status, qs).toBeLessThan(500);
    }
  });

  it('enumerated query values come from a whitelist', async () => {
    for (const path of ['/products?sort=price;DROP TABLE x', '/products?gender=OTHER', '/admin/reports/sales?granularity=day\');DROP TABLE "Order";--', '/admin/reports/..%2Fsecret', '/admin/orders?status=PAID%27--']) {
      const res = path.startsWith('/admin') ? await admin.get(path) : await api(path);
      expect(res.status, path).toBeGreaterThanOrEqual(400);
      expect(res.status, path).toBeLessThan(500);
    }
  });
});

describe('SQL injection: values are data, never SQL', () => {
  it('no payload reaches an error, a timeout or a side effect on any text input', async () => {
    const cat = await makeCategory('Kurtas');
    await makeProduct({ name: 'Cotton Kurta', categoryId: cat.id });
    const before = await counts();
    const started = Date.now();

    for (const p of SQLI) {
      const q = encodeURIComponent(p);
      const paths = [
        `/search?q=${q}`,
        `/search/suggestions?q=${q}${q}`,
        `/products?q=${q}`,
        `/products?category=${q}&fabric=${q}&colour=${q}&size=${q}`,
        `/products/${q}`,
        `/categories/${q}`,
        `/reviews/product/${q}`,
        `/products/facets?q=${q}`,
      ];
      for (const path of paths) {
        const res = await api(path);
        expect(res.status, `${path}`).toBeLessThan(500);
        expectNoInternals(res.body);
      }
      expect((await alice.post('/coupons/validate', { code: p })).status, `coupon ${p}`).toBeLessThan(500);
      for (const path of [`/admin/inventory?q=${q}`, `/admin/customers?q=${q}`, `/admin/orders?q=${q}`, `/admin/products?q=${q}`, `/admin/newsletter?q=${q}`, `/admin/users?q=${q}`, `/admin/support?q=${q}`]) {
        const res = await admin.get(path);
        expect(res.status, path).toBeLessThan(500);
        expectNoInternals(res.body);
      }
    }
    expect(await counts()).toEqual(before);
    // pg_sleep(5) would have made one of ~300 requests take 5 s; the whole loop is comfortably faster than that.
    expect(Date.now() - started).toBeLessThan(60_000);
  });

  it('payloads are stored and returned verbatim, which is how you know they were never interpreted', async () => {
    const payload = `Robert'); DROP TABLE "Address";-- ${"' OR '1'='1"}`;
    const created = await alice.post('/addresses', { ...ADDRESS, line1: payload, fullName: "O'Brien \"Q\"" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const back = (await alice.get('/addresses')).body.data[0];
    expect(back.line1).toBe(payload);
    expect(back.fullName).toBe("O'Brien \"Q\"");
    expect(await prisma.address.count()).toBe(1);
  });

  it('LIKE wildcards in a search box match literally, they do not turn it into "match everything"', async () => {
    const cat = await makeCategory('Test');
    await makeProduct({ name: 'Plain Cotton Shirt', categoryId: cat.id });
    await makeProduct({ name: '50% Off Special', categoryId: cat.id });
    const inv = async (q: string) => (await admin.get(`/admin/inventory?q=${encodeURIComponent(q)}`)).body.data as unknown[];
    expect(await inv('%')).toHaveLength(1); // only the product with a literal "%" in its name
    expect(await inv('_')).toHaveLength(0);
    expect(await inv('\\')).toHaveLength(0);
  });
});

describe('script payloads are inert data on the way out', () => {
  it('are stored as typed and served as JSON that a browser will not render', async () => {
    for (const [i, x] of XSS.entries()) {
      const res = await alice.post('/addresses', { ...ADDRESS, fullName: x, line1: `${x} ${i}` });
      expect(res.status, x).toBe(201);
    }
    await alice.patch('/users/me', { fullName: XSS[0] });
    await alice.post('/support', { subject: XSS[1], message: `${XSS[2]} is how it began for me` });

    for (const path of ['/addresses', '/users/me', '/support']) {
      const res = await alice.get(path);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    }
    // The API does not "sanitise" by mangling: escaping is the renderer's job (React escapes text by default,
    // and the storefront has no dangerouslySetInnerHTML on user content). The API's job is to never serve it as HTML.
    expect((await alice.get('/users/me')).body.data.fullName).toBe(XSS[0]);
  });

  it('a reflected path in an error is JSON, not HTML', async () => {
    const res = await api(`/${encodeURIComponent('<script>alert(1)</script>')}`);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('spreadsheet formulas in customer-controlled text are neutralised in CSV exports', async () => {
    // The public form's validation may or may not let such an address through; the export must be safe either way,
    // so put the hostile values straight into the table.
    const hostile = ['=cmd+1@example.com', '+SUM(1)@example.com', '@attacker@example.com', '-2+3@example.com'];
    await prisma.newsletterSubscriber.createMany({ data: hostile.map((email) => ({ email })) });
    const res = await admin.get('/admin/newsletter?format=csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['cache-control']).toBe('no-store');
    const cells = res.text.split(/\r?\n/).flatMap((line) => line.split(',').map((c) => c.replace(/^"|"$/g, '')));
    for (const email of hostile) {
      expect(cells, email).toContain(`'${email}`); // defanged with a leading apostrophe…
      expect(cells, email).not.toContain(email); // …so no cell begins with the formula character
    }
  });
});

describe('CORS', () => {
  const ALLOWED = 'http://localhost:3000'; // the default in non-production

  it('answers the allowed origin, with credentials, and varies by Origin', async () => {
    const res = await request(app).get('/api/v1/health').set('Origin', ALLOWED);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['vary']).toMatch(/Origin/i);
  });

  it.each([
    ['another site', 'https://evil.example'],
    ['a look-alike suffix', 'http://localhost:3000.evil.example'],
    ['a look-alike prefix', 'http://evil-localhost:3000'],
    ['a different port', 'http://localhost:3001'],
    ['a different scheme', 'https://localhost:3000'],
    ['the null origin (sandboxed iframes, file://)', 'null'],
    ['a trailing-dot host', 'http://localhost.:3000'],
  ])('does not grant %s', async (_label, origin) => {
    const res = await request(app).get('/api/v1/users/me').set('Origin', origin).set('Authorization', 'Bearer alice');
    // (The cors package always adds Allow-Credentials; without Allow-Origin a browser ignores it and blocks the read.)
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('refuses a pre-flight from a stranger and permits one from the storefront, for the verbs the API uses', async () => {
    const bad = await request(app).options('/api/v1/orders').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();

    const good = await request(app).options('/api/v1/orders').set('Origin', ALLOWED).set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'authorization,content-type');
    expect(good.status).toBe(204);
    expect(good.headers['access-control-allow-origin']).toBe(ALLOWED);
    const methods = String(good.headers['access-control-allow-methods']).split(',');
    expect(methods).toEqual(expect.arrayContaining(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']));
    expect(methods).not.toContain('TRACE');
    expect(methods).not.toContain('CONNECT');
  });

  it('never reflects "*" together with credentials', async () => {
    const res = await request(app).get('/api/v1/health').set('Origin', ALLOWED);
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });
});

describe('response headers', () => {
  it('carry the standard hardening set', async () => {
    const res = await api('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['referrer-policy']).toBeDefined();
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['x-dns-prefetch-control']).toBeDefined();
    expect(res.headers['server']).toBeUndefined();
  });

  it('forbid shared caches from keeping anything fetched with a credential', async () => {
    const res = await alice.get('/users/me');
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect((await alice.get('/orders')).headers['cache-control']).toMatch(/no-store/);
    expect((await admin.get('/admin/orders')).headers['cache-control']).toMatch(/no-store/);
    expect((await bob.get('/addresses')).headers['cache-control']).toMatch(/no-store/);
  });

  it('give every response a request id, and only trust a caller-supplied one that is harmless', async () => {
    const fresh = await api('/health');
    expect(fresh.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const echoed = await api('/health').set('X-Request-Id', 'trace-abc_123.XYZ');
    expect(echoed.headers['x-request-id']).toBe('trace-abc_123.XYZ');

    for (const bad of ['short', 'has spaces in it!', '<script>alert(1)</script>', 'a'.repeat(200), 'semi;colon;injection', '../../etc/passwd']) {
      const res = await api('/health').set('X-Request-Id', bad);
      expect(res.headers['x-request-id'], bad).not.toBe(bad);
      expect(res.headers['x-request-id'], bad).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('are present on errors too (a refusal is also a response)', async () => {
    const res = await api('/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('payment webhook: only a correctly signed delivery is believed, and odd ones are refused cleanly', () => {
  const post = (raw: string | Buffer, headers: Record<string, string> = {}) => {
    const r = request(app).post('/api/v1/webhooks/razorpay');
    for (const [k, v] of Object.entries(headers)) r.set(k, v);
    return r.set('Content-Type', 'application/json').send(raw);
  };
  /** A genuine signature over `raw`, made with the webhook secret configured for tests (vitest.config.mts). */
  const sign = (raw: string | Buffer) => createHmac('sha256', 'dummy_webhook_secret').update(raw).digest('hex');
  const signed = (raw: string) => ({ 'x-razorpay-signature': sign(raw), 'x-razorpay-event-id': `evt_${randomUUID()}` });

  it('requires the signature header, and a signature of exactly the right shape', async () => {
    const raw = JSON.stringify({ entity: 'event', event: 'payment.captured' });
    const variants: Record<string, string>[] = [
      {},
      { 'x-razorpay-signature': '' },
      { 'x-razorpay-signature': 'short' },
      { 'x-razorpay-signature': 'z'.repeat(64) },
      { 'x-razorpay-signature': 'A'.repeat(64) },
      { 'x-razorpay-signature': `${sign(raw)}00` }, // right signature + garbage
      { 'x-razorpay-signature': 'a'.repeat(5000) },
    ];
    for (const headers of variants) {
      const res = await post(raw, { 'x-razorpay-event-id': 'evt_1', ...headers });
      expect(res.status, JSON.stringify(headers).slice(0, 80)).toBe(400);
      expectNoInternals(res.body);
    }
    expect(await prisma.webhookEvent.count()).toBe(0);
  });

  it('refuses the verbs and paths it does not serve', async () => {
    expect((await request(app).get('/api/v1/webhooks/razorpay')).status).toBe(404);
    expect((await request(app).put('/api/v1/webhooks/razorpay').send('{}')).status).toBe(404);
    expect((await request(app).post('/api/v1/webhooks/razorpay/extra').send('{}')).status).toBe(404);
  });

  it('does not accept a body that is too large, even before looking at its signature', async () => {
    const res = await post('x'.repeat(600_000), { 'x-razorpay-signature': 'a'.repeat(64), 'x-razorpay-event-id': 'evt_big' });
    expect(res.status).toBe(413);
    expect(await prisma.webhookEvent.count()).toBe(0);
  });

  it('validly signed but structurally odd payloads end in 4xx or an acknowledgement, never a 500', async () => {
    for (const raw of ['', 'null', '[]', '123', '"text"', '{}', '{"event":null}', '{"event":{"a":1}}', '{"event":"payment.captured"}', '{"event":"payment.captured","payload":null}', '{"event":"payment.captured","payload":{"payment":null}}', '{"event":"payment.captured","payload":{"payment":{"entity":{}}}}']) {
      const res = await post(raw, signed(raw));
      expect(res.status, JSON.stringify(raw)).toBeLessThan(500);
      expectNoInternals(res.body);
    }
  });

  it('an unconfigured metrics endpoint does not exist at all', async () => {
    expect((await api('/health/metrics')).status).toBe(404);
    expect((await api('/health/metrics').set('Authorization', 'Bearer anything')).status).toBe(404);
  });
});
