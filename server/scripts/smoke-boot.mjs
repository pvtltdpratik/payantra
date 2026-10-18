/**
 * Boot smoke test for the BUILT server (dist/server.js) in production mode.
 *
 *   npm run build && npm run smoke:boot
 *
 * Proves what unit tests cannot: that the compiled artifact starts under NODE_ENV=production, that a bad production
 * configuration stops it at boot with a clear message, that the health / metrics / security-header surface is wired,
 * that every log line is JSON, and (on Linux/macOS, where signals work) that SIGTERM drains and exits 0.
 *
 * Uses a private in-memory PGlite database on a random port. It never touches any other database.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort, startPglite } from './lib/pglite-server.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'dist', 'server.js');
if (!existsSync(entry)) {
  console.error('dist/server.js not found — run `npm run build` first.');
  process.exit(2);
}

let failures = 0;
const check = (ok, what, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}${!ok && detail ? `\n         ${detail}` : ''}`);
  if (!ok) failures++;
};
const hex = (n) => randomBytes(n).toString('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A scratch cwd, so dotenv cannot pick up a developer's server/.env and change what is being tested. */
const cwd = mkdtempSync(join(tmpdir(), 'payantra-smoke-'));

function boot(env) {
  const child = spawn(process.execPath, [entry], { cwd, env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = { stdout: '', stderr: '', exit: null };
  child.stdout.on('data', (d) => (out.stdout += d));
  child.stderr.on('data', (d) => (out.stderr += d));
  out.done = new Promise((resolve) =>
    child.on('exit', (code, signal) => {
      out.exit = { code, signal };
      resolve(out.exit);
    }),
  );
  return { child, out };
}

async function waitFor(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* not yet */
    }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(150);
  }
}

const SECRETS = {
  RAZORPAY_KEY_ID: 'rzp_test_smoke0001',
  RAZORPAY_KEY_SECRET: hex(12),
  RAZORPAY_WEBHOOK_SECRET: hex(16),
  DELIVERY_OTP_SECRET: hex(32),
};

// ── 1. a bad production configuration must not boot ──
console.log('\n1. production configuration is validated at boot');
{
  const { out } = boot({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://app:pw@db.internal.example.com:5432/payantra',
    DATABASE_SSL: 'false',
    CORS_ORIGINS: '*',
    SUPABASE_URL: 'http://auth.example.com',
    ...SECRETS,
    RAZORPAY_WEBHOOK_SECRET: 'dummy_webhook_secret',
  });
  const exit = await Promise.race([out.done, sleep(15_000).then(() => null)]);
  check(exit !== null && exit.code !== 0, 'exits non-zero', JSON.stringify(exit));
  for (const name of ['DATABASE_SSL', 'CORS_ORIGINS', 'SUPABASE_URL', 'RAZORPAY_WEBHOOK_SECRET']) {
    check(out.stderr.includes(name), `names ${name} in the error`, out.stderr.slice(0, 300));
  }
}

// ── 2. a good one boots and behaves ──
console.log('\n2. the built server boots and serves');
const db = await startPglite();
const port = await freePort();
const metricsToken = hex(16);
const base = `http://127.0.0.1:${port}`;
const { child, out } = boot({
  NODE_ENV: 'production',
  PORT: String(port),
  DATABASE_URL: db.url, // loopback: TLS not required
  DATABASE_POOL_MAX: '1', // PGlite is a single session
  CORS_ORIGINS: 'https://shop.example.test',
  SUPABASE_URL: 'https://smoke-project.supabase.co',
  METRICS_TOKEN: metricsToken,
  RELEASE: 'smoke-1',
  ORDER_EXPIRY_SWEEP_SECONDS: '0',
  SHUTDOWN_DRAIN_SECONDS: '1',
  SHUTDOWN_TIMEOUT_SECONDS: '10',
  ...SECRETS,
});

try {
  await waitFor(async () => (await fetch(`${base}/api/v1/health/ready`)).status === 200, 30_000, 'readiness');
  check(true, 'becomes ready (database reachable)');

  const live = await fetch(`${base}/api/v1/health`);
  const liveBody = await live.json();
  check(live.status === 200 && liveBody.data.release === 'smoke-1', 'liveness reports the release');
  check(/^[0-9a-f-]{36}$/.test(live.headers.get('x-request-id') ?? ''), 'every response has a request id');
  check(live.headers.get('x-content-type-options') === 'nosniff' && !live.headers.get('x-powered-by'), 'security headers present, no X-Powered-By');
  check((live.headers.get('content-security-policy') ?? '').includes("default-src 'none'"), 'API sends a locked-down CSP');

  check((await fetch(`${base}/api/v1/orders`)).status === 401, 'protected routes demand a token');
  check((await fetch(`${base}/api/v1/admin/orders`, { headers: { authorization: 'Bearer not-a-token' } })).status === 401, 'a forged token is refused');
  check((await fetch(`${base}/api/v1/health/metrics`)).status === 401, 'metrics refuse anonymous callers');
  const metrics = await fetch(`${base}/api/v1/health/metrics`, { headers: { authorization: `Bearer ${metricsToken}` } });
  check(metrics.status === 200 && (await metrics.text()).includes('payantra_http_requests_total'), 'metrics answer to the token');

  const evil = await fetch(`${base}/api/v1/health`, { headers: { origin: 'https://evil.example' } });
  check(!evil.headers.get('access-control-allow-origin'), 'CORS refuses a foreign origin');
  const good = await fetch(`${base}/api/v1/health`, { headers: { origin: 'https://shop.example.test' } });
  check(good.headers.get('access-control-allow-origin') === 'https://shop.example.test', 'CORS allows the configured storefront');

  const lines = out.stdout.split('\n').filter(Boolean);
  const parsed = lines.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  });
  check(lines.length > 0 && parsed.every(Boolean), 'every log line is JSON', lines.find((_, i) => !parsed[i]));
  check(parsed.some((l) => l?.msg === 'Payantra API listening' && l.release === 'smoke-1'), 'logs a startup line tagged with the release');

  // ── 3. graceful shutdown ──
  console.log('\n3. graceful shutdown');
  if (process.platform === 'win32') {
    console.log('  skip  SIGTERM handling cannot be exercised on Windows (kill() is a hard stop); covered by unit tests and by Linux CI');
  } else {
    child.kill('SIGTERM');
    await sleep(200);
    const draining = await fetch(`${base}/api/v1/health/ready`).catch(() => null);
    check(draining?.status === 503, 'readiness turns 503 immediately (drain window)', String(draining?.status));
    const exit = await Promise.race([out.done, sleep(15_000).then(() => null)]);
    check(exit?.code === 0, 'exits 0 after draining', JSON.stringify(exit));
    check(out.stdout.includes('Shutdown complete'), 'logs "Shutdown complete"');
  }
} catch (err) {
  check(false, 'smoke run', String(err?.stack ?? err));
  console.log(out.stdout.slice(-1500), out.stderr.slice(-1500));
} finally {
  if (out.exit === null) child.kill('SIGKILL');
  await db.stop().catch(() => undefined);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
