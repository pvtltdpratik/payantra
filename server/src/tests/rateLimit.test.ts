import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

// This file runs with deliberately tiny limits (the rest of the suite uses huge ones).
process.env.RATE_LIMIT_MAX = '8';
process.env.RATE_LIMIT_SENSITIVE_MAX = '3';

vi.mock('jose', () => ({
  createRemoteJWKSet: () => ({}),
  jwtVerify: async () => ({ payload: { sub: '00000000-0000-4000-8000-0000000000c1', email: 'alice@example.test' } }),
}));

const { createApp } = await import('../app.js');
const { prisma } = await import('../config/prisma.js');
const { resetDb } = await import('./helpers.js');

describe('rate limiting', () => {
  it('slows a script that guesses coupon codes, with a clear error', async () => {
    await resetDb();
    await prisma.profile.create({ data: { id: '00000000-0000-4000-8000-0000000000c1', email: 'alice@example.test' } });
    const app = createApp();
    const guess = (code: string) => request(app).post('/api/v1/coupons/validate').set('Authorization', 'Bearer t').send({ code });

    const statuses: number[] = [];
    for (const code of ['AAA', 'BBB', 'CCC', 'DDD']) statuses.push((await guess(code)).status);

    // First three guesses are answered (422 = not a valid code); the fourth is refused outright.
    expect(statuses).toEqual([422, 422, 422, 429]);
    const blocked = await guess('EEE');
    expect(blocked.body).toMatchObject({ success: false, error: { code: 'RATE_LIMITED' } });
    expect(blocked.headers['ratelimit']).toBeDefined();
  });

  it('also caps the whole API per IP', async () => {
    const app = createApp();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await request(app).get('/api/v1/health')).status);
    expect(codes.filter((c) => c === 200).length).toBeLessThanOrEqual(8);
    expect(codes).toContain(429);
  });
});
