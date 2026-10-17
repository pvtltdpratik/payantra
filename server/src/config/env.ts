import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** Comma-separated list of allowed browser origins. */
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1),
  /** Set true for AWS RDS, which requires TLS. */
  DATABASE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  /** PEM contents of the RDS CA bundle (newlines may be written as \n). */
  DATABASE_SSL_CA: z
    .string()
    .optional()
    .transform((v) => (v ? v.replace(/\\n/g, '\n') : undefined)),

  SUPABASE_URL: z.string().url(),
  /** Only needed for legacy projects that sign JWTs with a shared HS256 secret. */
  SUPABASE_JWT_SECRET: z.string().optional(),

  /** Requests per minute per IP across the whole API. */
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  /** Requests per 15 minutes per IP for sensitive actions (checkout, coupons, refunds, role changes). */
  RATE_LIMIT_SENSITIVE_MAX: z.coerce.number().int().min(1).default(30),
  /** Override only for tests/local mocks; production uses Razorpay's real API. */
  RAZORPAY_API_BASE: z.string().url().default('https://api.razorpay.com/v1'),
  /** Seconds between sweeps that release stock held by abandoned online-payment orders. 0 disables. */
  ORDER_EXPIRY_SWEEP_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),
  RAZORPAY_KEY_ID: z.string().min(1),
  RAZORPAY_KEY_SECRET: z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // Fail fast: a server that boots with missing secrets fails in confusing ways later.
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = load();
export const corsOrigins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
