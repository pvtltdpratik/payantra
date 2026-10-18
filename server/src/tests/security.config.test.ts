import { describe, expect, it } from 'vitest';
import { parseEnv } from '../config/env.js';
import { isSensitiveKey, passesLuhn, scrubDeep, scrubString } from '../lib/redact.js';

/** A complete, valid production environment. Each test breaks exactly one thing. */
const PROD: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://app:s3cr3t@payantra.c1a2b3.ap-south-1.rds.amazonaws.com:5432/payantra',
  DATABASE_SSL: 'true',
  CORS_ORIGINS: 'https://www.payantra.in,https://payantra.in',
  SUPABASE_URL: 'https://abcdefghijkl.supabase.co',
  RAZORPAY_KEY_ID: 'rzp_live_Ab12Cd34Ef56',
  RAZORPAY_KEY_SECRET: 'k9Qw3rT7yU1iO5pA8sD2fG4h',
  RAZORPAY_WEBHOOK_SECRET: 'wh_7fGh3KjL9mNq2RsT5vXz',
  DELIVERY_OTP_SECRET: '3f9a1c7e5b2d4086a1b3c5d7e9f0123456789abcdef0123456789abcdef01234',
};

const without = (...keys: string[]) => Object.fromEntries(Object.entries(PROD).filter(([k]) => !keys.includes(k)));
const parse = (over: NodeJS.ProcessEnv = {}) => parseEnv({ ...PROD, ...over });

describe('production configuration fails fast', () => {
  it('accepts a complete production environment', () => {
    const env = parse();
    expect(env.NODE_ENV).toBe('production');
    expect(env.DATABASE_SSL).toBe(true);
  });

  it('reports every problem at once, naming the variables', () => {
    expect(() => parseEnv({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL[\s\S]*SUPABASE_URL[\s\S]*RAZORPAY_KEY_ID/);
  });

  describe('database', () => {
    it('requires TLS for a remote database', () => {
      expect(() => parse({ DATABASE_SSL: 'false' })).toThrow(/DATABASE_SSL: must be "true"/);
      expect(() => parse({ DATABASE_SSL: undefined })).toThrow(/DATABASE_SSL/);
    });
    it('does not demand TLS on loopback (a sidecar or local test cluster)', () => {
      expect(() => parse({ DATABASE_URL: 'postgresql://u:p@127.0.0.1:5433/db', DATABASE_SSL: 'false' })).not.toThrow();
      expect(() => parse({ DATABASE_URL: 'postgresql://u:p@localhost:5433/db', DATABASE_SSL: 'false' })).not.toThrow();
    });
    it('rejects a URL that is not Postgres', () => {
      expect(() => parse({ DATABASE_URL: 'mysql://u:p@host/db' })).toThrow(/DATABASE_URL/);
    });
  });

  describe('CORS origins', () => {
    it('has no default: it must be set', () => {
      expect(() => parseEnv(without('CORS_ORIGINS'))).toThrow(/CORS_ORIGINS: is required/);
      expect(() => parse({ CORS_ORIGINS: '   ' })).toThrow(/CORS_ORIGINS: is required/);
    });
    it.each([
      ['a wildcard', '*'],
      ['a wildcard subdomain', 'https://*.payantra.in'],
      ['plain http on a public host', 'http://www.payantra.in'],
      ['a trailing slash', 'https://www.payantra.in/'],
      ['a path', 'https://www.payantra.in/shop'],
      ['garbage', 'not a url'],
    ])('rejects %s', (_label, origin) => {
      expect(() => parse({ CORS_ORIGINS: `https://payantra.in,${origin}` })).toThrow(/CORS_ORIGINS/);
    });
    it('is still permissive in development, where it defaults to the local storefront', () => {
      const env = parseEnv({ ...without('CORS_ORIGINS'), NODE_ENV: 'development', DATABASE_SSL: 'false' });
      expect(env.CORS_ORIGINS).toBe('http://localhost:3000');
    });
  });

  describe('secrets', () => {
    it('requires the delivery OTP secret, long enough', () => {
      expect(() => parseEnv(without('DELIVERY_OTP_SECRET'))).toThrow(/DELIVERY_OTP_SECRET/);
      expect(() => parse({ DELIVERY_OTP_SECRET: 'too-short' })).toThrow(/DELIVERY_OTP_SECRET/);
    });
    it.each([
      ['DELIVERY_OTP_SECRET', 'changeme-changeme-changeme-changeme-12'],
      ['DELIVERY_OTP_SECRET', 'dummy-secret-dummy-secret-dummy-secret-1'],
      ['RAZORPAY_KEY_SECRET', 'your-razorpay-secret'],
      ['RAZORPAY_KEY_SECRET', 'dummy_secret'],
      ['RAZORPAY_WEBHOOK_SECRET', 'dummy_webhook_secret'],
      ['RAZORPAY_WEBHOOK_SECRET', 'xxxxxxxxxxxxxxxxxxxx'],
    ])('rejects a placeholder %s (%s)', (name, value) => {
      expect(() => parse({ [name]: value })).toThrow(new RegExp(name));
    });
    it('rejects a very short webhook secret', () => {
      expect(() => parse({ RAZORPAY_WEBHOOK_SECRET: 'abc123' })).toThrow(/RAZORPAY_WEBHOOK_SECRET: must be at least 16/);
    });
    it('rejects a truncated legacy JWT secret', () => {
      expect(() => parse({ SUPABASE_JWT_SECRET: 'short' })).toThrow(/SUPABASE_JWT_SECRET/);
    });
    it('treats the blank values in .env.example as unset', () => {
      expect(() => parse({ SENTRY_DSN: '', METRICS_TOKEN: '', SUPABASE_JWT_SECRET: '', DATABASE_SSL_CA: '' })).not.toThrow();
    });
  });

  describe('external endpoints', () => {
    it('requires https for Supabase', () => {
      expect(() => parse({ SUPABASE_URL: 'http://abc.supabase.co' })).toThrow(/SUPABASE_URL: must use https/);
    });
    it('will not point the payment gateway at a stand-in', () => {
      expect(() => parse({ RAZORPAY_API_BASE: 'https://payments.evil.example/v1' })).toThrow(/RAZORPAY_API_BASE/);
      expect(() => parse({ RAZORPAY_API_BASE: 'https://api.razorpay.com/v1' })).not.toThrow();
    });
    it('insists the Razorpay key id declares its mode', () => {
      expect(() => parse({ RAZORPAY_KEY_ID: 'AKIA-something' })).toThrow(/RAZORPAY_KEY_ID/);
      expect(() => parse({ RAZORPAY_KEY_ID: 'rzp_test_Ab12Cd34Ef56' })).not.toThrow();
    });
  });

  it('applies none of this outside production', () => {
    const dev = parseEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://u:p@db.example.com/x',
      SUPABASE_URL: 'http://localhost:9999',
      RAZORPAY_KEY_ID: 'a',
      RAZORPAY_KEY_SECRET: 'dummy',
      RAZORPAY_WEBHOOK_SECRET: 'dummy',
    });
    expect(dev.DATABASE_SSL).toBe(false);
  });
});

describe('log and error-report redaction', () => {
  const FAKE_JWT = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJlLWJ5dGVz';

  it('removes e-mail addresses wherever they appear', () => {
    expect(scrubString('Unique constraint failed on the fields: (`email`) for bob.k+shop@example.co.in')).toBe(
      'Unique constraint failed on the fields: (`email`) for [redacted-email]',
    );
  });

  it('removes JWTs and bearer credentials', () => {
    expect(scrubString(`token ${FAKE_JWT} rejected`)).toBe('token [redacted-jwt] rejected');
    expect(scrubString('Authorization: Bearer abc123DEF456ghi789')).toBe('Authorization: Bearer [redacted]');
  });

  it('removes card numbers (Luhn-valid) but not other long numbers', () => {
    expect(passesLuhn('4111111111111111')).toBe(true);
    expect(scrubString('card 4111 1111 1111 1111 declined')).toBe('card [redacted-card] declined');
    expect(scrubString('card 4111-1111-1111-1111 declined')).toBe('card [redacted-card] declined');
    expect(scrubString('order 1234567890123456 placed')).toBe('order 1234567890123456 placed'); // fails Luhn
    expect(scrubString('placed at 1760000000000')).toBe('placed at 1760000000000'); // a timestamp
  });

  it('removes gateway and auth-provider keys that leak into free text', () => {
    expect(scrubString('using rzp_live_Ab12Cd34Ef56 now')).toBe('using [redacted-key] now');
  });

  it('blanks sensitive keys whatever they hold, at any depth', () => {
    const out = scrubDeep({
      userId: 'u1',
      headers: { authorization: 'Bearer x', cookie: 'a=b', 'user-agent': 'curl' },
      body: { password: 'hunter2', razorpay_signature: 'abcd', nested: [{ apiKey: 'k', city: 'Pune' }], phone: '9876543210', email: 'a@b.in' },
      SUPABASE_SERVICE_TOKEN: 'abc',
    });
    expect(out).toEqual({
      userId: 'u1',
      headers: { authorization: '[redacted]', cookie: '[redacted]', 'user-agent': 'curl' },
      body: { password: '[redacted]', razorpay_signature: '[redacted]', nested: [{ apiKey: '[redacted]', city: 'Pune' }], phone: '[redacted]', email: '[redacted]' },
      SUPABASE_SERVICE_TOKEN: '[redacted]',
    });
  });

  it('keeps useful non-sensitive keys, and survives cycles and errors', () => {
    expect(isSensitiveKey('statusCode')).toBe(false);
    expect(isSensitiveKey('code')).toBe(false);
    const loop: Record<string, unknown> = { a: 1 };
    loop.self = loop;
    expect(() => scrubDeep(loop)).not.toThrow();
    const err = Object.assign(new Error('failed for carol@example.in'), { code: 'P2002' });
    const out = scrubDeep({ err }) as { err: { message: string; code: string; stack: string } };
    expect(out.err.message).toBe('failed for [redacted-email]');
    expect(out.err.code).toBe('P2002');
    expect(out.err.stack).not.toContain('carol@example.in');
  });
});
