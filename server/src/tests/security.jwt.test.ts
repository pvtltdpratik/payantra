import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The other suites replace `jose` with a stub so they can act as any user. This one runs the REAL verification code
 * (src/middleware/auth.ts) against real signatures, so "a forged, expired or mis-addressed token is refused" is
 * proven rather than assumed. Only the network fetch of Supabase's key set is swapped for a local key set.
 */
const LEGACY_SECRET = 'legacy-hs256-secret-0123456789abcdef0123456789';
process.env.SUPABASE_JWT_SECRET = LEGACY_SECRET;

const ISSUER = 'https://test-project.supabase.co/auth/v1'; // SUPABASE_URL comes from vitest.config.mts
const USER_ID = '00000000-0000-4000-8000-0000000000e1';

const jose = await vi.importActual<typeof import('jose')>('jose');
const good = await jose.generateKeyPair('ES256', { extractable: true });
const other = await jose.generateKeyPair('ES256', { extractable: true });
const goodJwk = { ...(await jose.exportJWK(good.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };

vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>();
  return {
    ...actual,
    // The deployed code calls createRemoteJWKSet(<supabase url>); here the "remote" key set is a local one.
    createRemoteJWKSet: () => actual.createLocalJWKSet({ keys: [goodJwk as never] }),
  };
});

const request = (await import('supertest')).default;
const { createApp } = await import('../app.js');
const { prisma } = await import('../config/prisma.js');
const { resetDb } = await import('./helpers.js');
const app = createApp();

type Claims = Record<string, unknown>;
const base = (over: Claims = {}): Claims => ({ email: 'erin@example.test', ...over });

async function es256(claims: Claims, opts: { key?: CryptoKey; iss?: string; aud?: string; exp?: string | number; kid?: string } = {}) {
  return new jose.SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256', kid: opts.kid ?? 'k1' })
    .setSubject(USER_ID)
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? 'authenticated')
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '10m')
    .sign(opts.key ?? good.privateKey);
}

async function hs256(claims: Claims, secret: string | Uint8Array = LEGACY_SECRET, opts: { iss?: string; aud?: string; exp?: string } = {}) {
  return new jose.SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(USER_ID)
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? 'authenticated')
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '10m')
    .sign(typeof secret === 'string' ? new TextEncoder().encode(secret) : secret);
}

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const me = (token: string) => request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  await resetDb();
});

describe('a valid token', () => {
  it('is accepted when signed by the project’s published key', async () => {
    const res = await me(await es256(base()));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ id: USER_ID, email: 'erin@example.test', role: 'CUSTOMER' });
  });

  it('is accepted on the legacy HS256 path when the project still uses a shared secret', async () => {
    const res = await me(await hs256(base()));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });
});

describe('a token that should be refused', () => {
  it('has the wrong signature (valid shape, signed with someone else’s key)', async () => {
    expect((await me(await es256(base(), { key: other.privateKey }))).status).toBe(401);
  });

  it('is signed with the wrong shared secret', async () => {
    expect((await me(await hs256(base(), 'not-the-project-secret-not-the-project-secret'))).status).toBe(401);
  });

  it('has expired', async () => {
    expect((await me(await es256(base(), { exp: Math.floor(Date.now() / 1000) - 60 }))).status).toBe(401);
    expect((await me(await hs256(base(), LEGACY_SECRET, { exp: '-1m' as never }))).status).toBe(401);
  });

  it('was minted for a different audience (e.g. an anon key, or another service)', async () => {
    expect((await me(await es256(base(), { aud: 'anon' }))).status).toBe(401);
    expect((await me(await hs256(base(), LEGACY_SECRET, { aud: 'service_role' }))).status).toBe(401);
  });

  it('was minted by a different issuer (another Supabase project)', async () => {
    expect((await me(await es256(base(), { iss: 'https://someone-else.supabase.co/auth/v1' }))).status).toBe(401);
    expect((await me(await hs256(base(), LEGACY_SECRET, { iss: 'https://evil.example/auth/v1' }))).status).toBe(401);
  });

  it('claims alg "none" (unsigned)', async () => {
    const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: USER_ID, email: 'erin@example.test', iss: ISSUER, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 600 })}.`;
    expect((await me(unsigned)).status).toBe(401);
    expect((await me(`${unsigned}x`)).status).toBe(401);
  });

  it('has a tampered payload (signature no longer matches)', async () => {
    const [h, , s] = (await es256(base())).split('.');
    const forged = b64({ sub: '00000000-0000-4000-8000-0000000000a1', email: 'admin@example.test', iss: ISSUER, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 600 });
    expect((await me(`${h}.${forged}.${s}`)).status).toBe(401);
  });

  it('attempts algorithm confusion: HS256 signed with the PUBLIC key as the shared secret', async () => {
    const publicKeyAsSecret = new TextEncoder().encode(JSON.stringify(goodJwk));
    expect((await me(await hs256(base(), publicKeyAsSecret))).status).toBe(401);
  });

  it('lacks identity claims', async () => {
    expect((await me(await es256({}))).status).toBe(401); // no e-mail
  });

  it('is gibberish', async () => {
    for (const t of ['a.b.c', 'eyJhbGciOiJub25lIn0..', '....', 'ey', '{}']) expect((await me(t)).status, t).toBe(401);
  });
});

describe('claims never decide what a caller may do', () => {
  it('a token that SAYS it is an admin is still just a customer', async () => {
    const token = await es256(base({ role: 'ADMIN', user_role: 'ADMIN', app_metadata: { role: 'ADMIN', roles: ['ADMIN'] }, user_metadata: { role: 'ADMIN', isAdmin: true } }));
    const profile = await me(token);
    expect(profile.status).toBe(200);
    expect(profile.body.data.role).toBe('CUSTOMER');
    expect((await request(app).get('/api/v1/admin/users').set('Authorization', `Bearer ${token}`)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/settings').set('Authorization', `Bearer ${token}`)).status).toBe(403);
    expect((await prisma.profile.findUniqueOrThrow({ where: { id: USER_ID } })).role).toBe('CUSTOMER');
  });

  it('the role in OUR database is what counts — a promotion takes effect on the very next request', async () => {
    const token = await es256(base());
    await prisma.profile.update({ where: { id: USER_ID }, data: { role: 'ADMIN' } });
    expect((await request(app).get('/api/v1/admin/settings').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    await prisma.profile.update({ where: { id: USER_ID }, data: { role: 'CUSTOMER' } });
    expect((await request(app).get('/api/v1/admin/settings').set('Authorization', `Bearer ${token}`)).status).toBe(403);
  });

  it('suspension takes effect immediately, while the token is still valid', async () => {
    const token = await es256(base());
    await prisma.profile.update({ where: { id: USER_ID }, data: { status: 'SUSPENDED' } });
    expect((await me(token)).status).toBe(403);
    await prisma.profile.update({ where: { id: USER_ID }, data: { status: 'ACTIVE' } });
    expect((await me(token)).status).toBe(200);
  });

  it('a second identity cannot take over an existing e-mail address', async () => {
    // Same e-mail, different subject: refused with a conflict instead of silently merging into erin's account.
    const intruder = await new jose.SignJWT(base())
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setSubject('00000000-0000-4000-8000-0000000000e2')
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(good.privateKey);
    const res = await me(intruder);
    expect(res.status).toBe(409);
    expect(await prisma.profile.count({ where: { id: '00000000-0000-4000-8000-0000000000e2' } })).toBe(0);
  });
});
