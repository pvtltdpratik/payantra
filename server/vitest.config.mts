import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globalSetup: ['./src/tests/globalSetup.ts'],
    // Integration tests share one database, so test files run one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // DATABASE_URL is provided by globalSetup (a real in-memory Postgres). Dummy values for the rest
    // so config/env.ts validates; no test reaches a real external service.
    env: {
      NODE_ENV: 'test',
      // Production keeps the strict defaults (300/min, 30 per 15 min). The integration tests make far more
      // calls than that from one address; rate limiting itself is covered in rateLimit.test.ts.
      RATE_LIMIT_MAX: '1000000',
      RATE_LIMIT_SENSITIVE_MAX: '1000000',
      // PGlite is one Postgres session shared by every connection, so overlapping transactions
      // from different pool connections would interleave: tests use ONE connection there.
      // Against a real server (TEST_DB=postgres) use a real pool so requests genuinely race.
      DATABASE_POOL_MAX: process.env.TEST_DB === 'postgres' ? '10' : '1',
      // config/env.ts loads server/.env (dotenv). A developer's real settings there — e.g. DATABASE_SSL=true for RDS —
      // must never reach the throwaway test database, which does not speak TLS (every query would hang).
      DATABASE_SSL: 'false',
      DATABASE_SSL_CA: '',
      DELIVERY_OTP_SECRET: 'test-only-delivery-otp-secret-0123456789',
      ORDER_EXPIRY_SWEEP_SECONDS: '0',
      SUPABASE_URL: 'https://test-project.supabase.co',
      RAZORPAY_KEY_ID: 'rzp_test_dummy',
      RAZORPAY_KEY_SECRET: 'dummy_secret',
      RAZORPAY_WEBHOOK_SECRET: 'dummy_webhook_secret',
    },
  },
});
