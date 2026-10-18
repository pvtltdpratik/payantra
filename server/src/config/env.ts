import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** The server/ folder, wherever the process was started from (src/config and dist/config are both two levels down). */
const SERVER_ROOT = fileURLToPath(new URL('../../', import.meta.url));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /**
   * Comma-separated list of allowed browser origins. Optional outside production (defaults to the local
   * storefront); REQUIRED and validated in production, where there is deliberately no default.
   */
  CORS_ORIGINS: z.string().optional(),

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
  /**
   * Path to a PEM file holding the CA bundle, instead of pasting the PEM into DATABASE_SSL_CA. A relative path is
   * resolved from the server/ folder, so `./certs/global-bundle.pem` works from any working directory. Set one of
   * the two, not both.
   */
  DATABASE_SSL_CA_FILE: z.string().optional(),

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
  /**
   * Secret behind delivery codes. A code is derived from this and the assignment, so it is never stored.
   * Required in production (32+ characters); a fixed development value is used elsewhere.
   */
  DELIVERY_OTP_SECRET: z.string().min(32).optional(),
  RAZORPAY_KEY_ID: z.string().min(1),
  RAZORPAY_KEY_SECRET: z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1),

  // ── Operations ──
  /** Reverse proxies between the internet and this process (ALB = 1). Drives req.ip and therefore rate limiting. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  /** Seconds to keep answering after SIGTERM with /health/ready = 503, so the load balancer stops sending traffic first. */
  SHUTDOWN_DRAIN_SECONDS: z.coerce.number().int().min(0).max(120).default(5),
  /** Seconds to let in-flight requests finish before the process exits anyway. */
  SHUTDOWN_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(300).default(25),
  /** Build identifier (git SHA) reported by /health and attached to error reports. */
  RELEASE: z.string().max(100).optional(),
  /** Optional error reporting to Sentry (or any Sentry-compatible endpoint). Unset = errors only go to the log. */
  SENTRY_DSN: z.string().url().optional(),
  /** Bearer token that unlocks GET /api/v1/health/metrics. Unset = the endpoint does not exist. */
  METRICS_TOKEN: z.string().min(24).optional(),
});

export type Env = z.infer<typeof schema> & { CORS_ORIGINS: string };

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const isLoopback = (hostname: string) => LOOPBACK.has(hostname) || hostname.endsWith('.localhost');

/** Values that mean "someone copied the example file and forgot to fill it in". */
const PLACEHOLDER = /^(change-?me|replace-?me|your[-_ ]|xxx|todo|secret$|password$|test$|dummy|example)/i;
const looksLikePlaceholder = (v: string) => PLACEHOLDER.test(v.trim()) || /(dummy|changeme|x{6,})/i.test(v);

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Extra rules that only apply to a production deployment. They are about configuration that would be
 * *silently* unsafe (plain-text database traffic, any website allowed to call the API, a placeholder
 * secret), so every one of them stops the process at boot with a message that names the variable.
 *
 * Loopback addresses are exempt from the transport rules: TLS is meaningless on 127.0.0.1, nothing
 * reachable from the internet can be loopback, and it keeps the production-mode end-to-end harness
 * (which runs the real API against local stand-ins) honest rather than special-cased.
 */
function productionProblems(e: z.infer<typeof schema>): string[] {
  const problems: string[] = [];
  const bad = (name: string, msg: string) => problems.push(`${name}: ${msg}`);

  // Database: TLS on, unless the database is on this machine.
  const dbHost = hostOf(e.DATABASE_URL.replace(/^postgres(ql)?:/, 'http:'));
  if (dbHost === null) bad('DATABASE_URL', 'is not a valid postgresql:// URL');
  else if (!e.DATABASE_SSL && !isLoopback(dbHost)) {
    bad('DATABASE_SSL', 'must be "true" for a non-local database (RDS requires TLS; set DATABASE_SSL_CA to the RDS CA bundle)');
  }
  if (!/^postgres(ql)?:\/\//.test(e.DATABASE_URL)) bad('DATABASE_URL', 'must start with postgresql://');

  // CORS: explicit, exact origins only.
  if (!e.CORS_ORIGINS?.trim()) {
    bad('CORS_ORIGINS', 'is required in production (comma-separated list of exact storefront origins, e.g. https://www.example.in)');
  } else {
    for (const raw of e.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)) {
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        bad('CORS_ORIGINS', `"${raw}" is not a valid origin`);
        continue;
      }
      if (raw.includes('*')) bad('CORS_ORIGINS', `"${raw}": wildcards are not allowed`);
      else if (url.origin !== raw) bad('CORS_ORIGINS', `"${raw}" must be a bare origin (${url.origin}), with no path or trailing slash`);
      else if (url.protocol !== 'https:' && !isLoopback(url.hostname)) bad('CORS_ORIGINS', `"${raw}" must use https`);
    }
  }

  // Auth provider and payment gateway: real endpoints, over TLS.
  const supabaseHost = hostOf(e.SUPABASE_URL);
  if (!e.SUPABASE_URL.startsWith('https://') && !(supabaseHost && isLoopback(supabaseHost))) bad('SUPABASE_URL', 'must use https');
  const rzpHost = hostOf(e.RAZORPAY_API_BASE);
  if (e.RAZORPAY_API_BASE !== 'https://api.razorpay.com/v1' && !(rzpHost && isLoopback(rzpHost))) {
    bad('RAZORPAY_API_BASE', 'must be left unset (or https://api.razorpay.com/v1) in production; it exists only for test stand-ins');
  }

  // Secrets: present, not placeholders, not too short to guess.
  if (!e.DELIVERY_OTP_SECRET) bad('DELIVERY_OTP_SECRET', 'is required in production (32+ random characters)');
  else if (looksLikePlaceholder(e.DELIVERY_OTP_SECRET)) bad('DELIVERY_OTP_SECRET', 'looks like a placeholder; generate a random value');
  if (looksLikePlaceholder(e.RAZORPAY_KEY_SECRET)) bad('RAZORPAY_KEY_SECRET', 'looks like a placeholder');
  if (looksLikePlaceholder(e.RAZORPAY_WEBHOOK_SECRET)) bad('RAZORPAY_WEBHOOK_SECRET', 'looks like a placeholder');
  else if (e.RAZORPAY_WEBHOOK_SECRET.length < 16) bad('RAZORPAY_WEBHOOK_SECRET', 'must be at least 16 characters');
  if (e.SUPABASE_JWT_SECRET && e.SUPABASE_JWT_SECRET.length < 32) bad('SUPABASE_JWT_SECRET', 'is too short to be a real Supabase JWT secret');

  // A leaked test key in a live deployment is the classic go-live mistake; key id and secret must agree on the mode.
  const keyIsTest = e.RAZORPAY_KEY_ID.startsWith('rzp_test_');
  const keyIsLive = e.RAZORPAY_KEY_ID.startsWith('rzp_live_');
  if (!keyIsTest && !keyIsLive && !(rzpHost && isLoopback(rzpHost))) bad('RAZORPAY_KEY_ID', 'must start with rzp_test_ or rzp_live_');

  return problems;
}

/**
 * The CA bundle to verify the database with: the inline PEM, or the contents of DATABASE_SSL_CA_FILE. A bad path or a
 * file that is not a PEM stops the process at boot with a message that says so, instead of surfacing later as
 * "self-signed certificate in certificate chain" on every query.
 */
function resolveCa(inline: string | undefined, file: string | undefined): string | undefined {
  if (!file) return inline;
  if (inline) throw new Error('Invalid environment configuration:\n  - DATABASE_SSL_CA_FILE: set either DATABASE_SSL_CA or DATABASE_SSL_CA_FILE, not both');
  const path = isAbsolute(file) ? file : resolve(SERVER_ROOT, file);
  let pem: string;
  try {
    pem = readFileSync(path, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'unreadable';
    throw new Error(`Invalid environment configuration:\n  - DATABASE_SSL_CA_FILE: cannot read "${path}" (${code})`);
  }
  if (!pem.includes('-----BEGIN CERTIFICATE-----')) {
    throw new Error(`Invalid environment configuration:\n  - DATABASE_SSL_CA_FILE: "${path}" does not contain a PEM certificate (expected -----BEGIN CERTIFICATE-----)`);
  }
  return pem;
}

/** Parses and validates an environment. Throws one error listing every problem. Exported for tests. */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  // `.env.example` ships blank values (`SENTRY_DSN=`); a blank is "not set", not an invalid empty string.
  const present = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ''));
  const parsed = schema.safeParse(present);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // Fail fast: a server that boots with missing secrets fails in confusing ways later.
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production') {
    const problems = productionProblems(parsed.data);
    if (problems.length) {
      throw new Error(`Invalid production configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    }
  }
  return {
    ...parsed.data,
    DATABASE_SSL_CA: resolveCa(parsed.data.DATABASE_SSL_CA, parsed.data.DATABASE_SSL_CA_FILE),
    CORS_ORIGINS: parsed.data.CORS_ORIGINS?.trim() || 'http://localhost:3000',
  };
}

export const env = parseEnv(process.env);
export const corsOrigins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
