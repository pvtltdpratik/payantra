/**
 * Starts the entire Payantra stack for end-to-end tests:
 *
 *   PostgreSQL (PGlite by default, or a private real server with E2E_DB=postgres)
 *   mock Razorpay  ·  mock Supabase Auth
 *   the REAL Express API (tsx)  ·  the REAL Next.js storefront (production build)
 *
 * Nothing is faked inside Payantra's own code: only the two external SaaS providers are stand-ins,
 * reached through ordinary configuration (SUPABASE_URL, RAZORPAY_API_BASE).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const root = resolve(here, '..', '..');
const serverDir = join(root, 'server');
const clientDir = join(root, 'client');

const importServerLib = (name) => import(pathToFileURL(join(serverDir, 'scripts', 'lib', name)).href);

async function waitFor(url, label, { timeoutMs = 120_000, ok = (r) => r.ok } = {}) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (ok(res)) return;
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = e.message;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${label} did not become ready (${url}): ${last}`);
}

/** Runs a Node script to completion, failing loudly with its output. */
function runNode(args, { cwd, env, label }) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => (code === 0 ? resolveRun(out) : reject(new Error(`${label} failed (exit ${code}):\n${out.slice(-3000)}`))));
  });
}

export async function startStack({ log = console.log } = {}) {
  const useRealPg = process.env.E2E_DB === 'postgres';
  const ports = { api: Number(process.env.E2E_API_PORT ?? 4100), web: Number(process.env.E2E_WEB_PORT ?? 3100) };
  const stops = [];
  const children = [];
  const stopAll = async () => {
    for (const c of children) if (!c.killed) c.kill();
    for (const stop of stops.reverse()) await stop().catch(() => undefined);
  };

  try {
    // ── external dependencies ──
    log(`database: ${useRealPg ? 'private real PostgreSQL' : 'PGlite'}`);
    const db = useRealPg ? await (await importServerLib('real-postgres.mjs')).startRealPostgres() : await (await importServerLib('pglite-server.mjs')).startPglite();
    stops.push(() => db.stop());

    process.env.NODE_ENV = 'test'; // the mock Supabase refuses to start in production
    const razorpay = await (await importServerLib('mock-razorpay.mjs')).startMockRazorpay({ keyId: 'rzp_test_e2e', keySecret: 'e2e_secret' });
    stops.push(() => razorpay.stop());
    // A FIXED port: the storefront build bakes this URL in (NEXT_PUBLIC_SUPABASE_URL), so a reused build
    // (E2E_SKIP_BUILD=1) only works if the URL is stable between runs.
    const supabase = await (await importServerLib('mock-supabase.mjs')).startMockSupabase({ port: Number(process.env.E2E_SUPABASE_PORT ?? 4101) });
    stops.push(() => supabase.stop());

    const web = `http://localhost:${ports.web}`;
    const api = `http://127.0.0.1:${ports.api}/api/v1`;

    const serverEnv = {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(ports.api),
      LOG_LEVEL: 'warn',
      DATABASE_URL: db.url,
      DATABASE_POOL_MAX: useRealPg ? '10' : '1', // PGlite is one session: see README
      CORS_ORIGINS: web,
      SUPABASE_URL: supabase.url,
      RAZORPAY_KEY_ID: 'rzp_test_e2e',
      RAZORPAY_KEY_SECRET: 'e2e_secret',
      RAZORPAY_WEBHOOK_SECRET: 'e2e_webhook_secret',
      RAZORPAY_API_BASE: razorpay.apiBase,
      RATE_LIMIT_MAX: '100000',
      RATE_LIMIT_SENSITIVE_MAX: '100000',
      ORDER_EXPIRY_SWEEP_SECONDS: '2',
    };
    const tsx = join(serverDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');

    // ── data ──
    log('seeding the catalogue…');
    await runNode([tsx, 'prisma/seed.ts'], { cwd: serverDir, env: { ...serverEnv, SEED_ALLOW_PRODUCTION: 'yes' }, label: 'seed' });

    // ── API ──
    log('starting the API…');
    const apiProc = spawn(process.execPath, [tsx, 'src/server.ts'], { cwd: serverDir, env: serverEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(apiProc);
    let apiLog = '';
    apiProc.stdout.on('data', (d) => (apiLog += d));
    apiProc.stderr.on('data', (d) => (apiLog += d));
    await waitFor(`${api}/health/ready`, 'API');

    // ── storefront (production build, its own output folder) ──
    log('building the storefront (production)…');
    const webEnv = {
      ...process.env,
      NODE_ENV: 'production',
      NEXT_DIST_DIR: '.next-e2e',
      NEXT_PUBLIC_API_URL: api,
      NEXT_PUBLIC_SUPABASE_URL: supabase.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'e2e-anon-key',
      NEXT_PUBLIC_SITE_URL: web,
      NEXT_PUBLIC_RAZORPAY_KEY_ID: 'rzp_test_e2e',
      NEXT_TELEMETRY_DISABLED: '1',
    };
    const nextBin = join(clientDir, 'node_modules', 'next', 'dist', 'bin', 'next');
    if (!existsSync(nextBin)) throw new Error('client dependencies are not installed (run `npm install --include=dev` in client/)');
    // E2E_SKIP_BUILD=1 reuses the previous build while iterating on the specs themselves.
    // Never use it after changing client code: NEXT_PUBLIC_* values are baked in at build time.
    if (process.env.E2E_SKIP_BUILD === '1' && existsSync(join(clientDir, '.next-e2e', 'BUILD_ID'))) log('(reusing the previous build)');
    else await runNode([nextBin, 'build'], { cwd: clientDir, env: webEnv, label: 'next build' });
    log('starting the storefront…');
    const webProc = spawn(process.execPath, [nextBin, 'start', '-p', String(ports.web)], { cwd: clientDir, env: webEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(webProc);
    let webLog = '';
    webProc.stdout.on('data', (d) => (webLog += d));
    webProc.stderr.on('data', (d) => (webLog += d));
    await waitFor(`${web}/`, 'storefront');

    // ── people ──
    const post = async (url, body) => (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
    const accounts = {
      admin: { email: 'admin@payantra.test', password: 'Admin#2026pass', fullName: 'Ananya Admin' },
      alice: { email: 'alice@payantra.test', password: 'Alice#2026pass', fullName: 'Alice Rao' },
      bob: { email: 'bob@payantra.test', password: 'Bob#2026pass', fullName: 'Bob Iyer' },
    };
    for (const a of Object.values(accounts)) a.id = (await post(`${supabase.url}/__mock/users`, a)).id;
    const tokenFor = async (who) => (await post(`${supabase.url}/__mock/token`, { email: accounts[who].email })).access_token;

    // The first admin is promoted with the real CLI, exactly as an operator would.
    await fetch(`${api}/users/me`, { headers: { Authorization: `Bearer ${await tokenFor('admin')}` } }); // first sign-in creates the profile
    await runNode([tsx, 'scripts/make-admin.ts', accounts.admin.email], { cwd: serverDir, env: serverEnv, label: 'make-admin' });

    const razorpaySim = (path, body) => post(`${razorpay.simBase}/${path}`, body ?? {});

    return {
      web,
      api,
      accounts,
      supabase,
      razorpay,
      razorpaySim,
      tokenFor,
      /** Calls the API as a user, with a freshly minted token. */
      async apiAs(who, method, path, body) {
        const res = await fetch(`${api}${path}`, {
          method,
          headers: { 'content-type': 'application/json', Authorization: `Bearer ${await tokenFor(who)}` },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: res.status, body: await res.json().catch(() => null) };
      },
      logs: () => ({ api: apiLog, web: webLog }),
      stop: stopAll,
    };
  } catch (err) {
    await stopAll();
    throw err;
  }
}
