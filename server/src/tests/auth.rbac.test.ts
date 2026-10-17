import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks: no network, no database ──
const jwtVerify = vi.fn();
vi.mock('jose', () => ({
  createRemoteJWKSet: () => ({}),
  jwtVerify: (...args: unknown[]) => jwtVerify(...args),
}));

const upsert = vi.fn();
const update = vi.fn();
const findUniqueOrThrow = vi.fn();
vi.mock('../config/prisma.js', () => ({
  prisma: {
    profile: { upsert, update, findUniqueOrThrow },
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
  },
}));

const { createApp } = await import('../app.js');
const { requireAuth, requireRole } = await import('../middleware/auth.js');
const { errorHandler } = await import('../middleware/error.js');

const app = createApp();

function tokenFor(sub: string, email: string) {
  jwtVerify.mockResolvedValueOnce({ payload: { sub, email } });
  return 'Bearer valid.token.value';
}

function dbProfile(role: 'CUSTOMER' | 'DELIVERY_PARTNER' | 'ADMIN', status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') {
  upsert.mockResolvedValueOnce({ id: 'u1', email: 'a@b.in', role, status });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('authentication', () => {
  it('rejects requests with no token', async () => {
    const res = await request(app).get('/api/v1/users/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects tokens that fail verification', async () => {
    jwtVerify.mockRejectedValueOnce(new Error('bad signature'));
    const res = await request(app).get('/api/v1/users/me').set('Authorization', 'Bearer forged');
    expect(res.status).toBe(401);
  });

  it('blocks suspended accounts even with a valid token', async () => {
    dbProfile('CUSTOMER', 'SUSPENDED');
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', tokenFor('u1', 'a@b.in'));
    expect(res.status).toBe(403);
  });

  it('serves the profile for a valid token', async () => {
    dbProfile('CUSTOMER');
    findUniqueOrThrow.mockResolvedValueOnce({ id: 'u1', email: 'a@b.in', role: 'CUSTOMER' });
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', tokenFor('u1', 'a@b.in'));
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('a@b.in');
  });
});

describe('role is never trusted from the client', () => {
  it('rejects a body that tries to set role', async () => {
    dbProfile('CUSTOMER');
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', tokenFor('u1', 'a@b.in'))
      .send({ fullName: 'Asha Rao', role: 'ADMIN' });
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('ignores role claims in the token — database role wins', async () => {
    // Token claims admin in metadata; DB says CUSTOMER.
    jwtVerify.mockResolvedValueOnce({
      payload: { sub: 'u1', email: 'a@b.in', app_metadata: { role: 'ADMIN' }, role: 'ADMIN' },
    });
    dbProfile('CUSTOMER');

    const probe = express();
    probe.get('/admin-only', requireAuth, requireRole('ADMIN'), (_req, res) => void res.json({ ok: true }));
    probe.use(errorHandler);

    const res = await request(probe).get('/admin-only').set('Authorization', 'Bearer x');
    expect(res.status).toBe(403);
  });
});

describe('role guard', () => {
  const probe = express();
  probe.get('/admin-only', requireAuth, requireRole('ADMIN'), (_req, res) => void res.json({ ok: true }));
  probe.get('/partner-only', requireAuth, requireRole('DELIVERY_PARTNER'), (_req, res) => void res.json({ ok: true }));
  probe.use(errorHandler);

  it('lets an admin through admin routes', async () => {
    dbProfile('ADMIN');
    const res = await request(probe).get('/admin-only').set('Authorization', tokenFor('u1', 'a@b.in'));
    expect(res.status).toBe(200);
  });

  it('keeps customers out of the delivery partner API', async () => {
    dbProfile('CUSTOMER');
    const res = await request(probe).get('/partner-only').set('Authorization', tokenFor('u1', 'a@b.in'));
    expect(res.status).toBe(403);
  });

  it('keeps delivery partners out of admin routes', async () => {
    dbProfile('DELIVERY_PARTNER');
    const res = await request(probe).get('/admin-only').set('Authorization', tokenFor('u1', 'a@b.in'));
    expect(res.status).toBe(403);
  });
});

describe('platform basics', () => {
  it('reports liveness without touching the database', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
  });

  it('returns the standard envelope for unknown routes', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  it('sets security headers', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
