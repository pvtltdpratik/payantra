/**
 * Asserts that a running storefront sends the security headers promised by security-headers.ts.
 *
 *   node scripts/check-headers.mjs https://shop.example.in            # production deployment (expects a CSP)
 *   node scripts/check-headers.mjs http://127.0.0.1:3100 --expect-csp # a local `next start` of a build made with an https NEXT_PUBLIC_SITE_URL
 *
 * Also verifies the allow-list covers what the app actually calls: the Razorpay script/iframe and the API and Supabase
 * origins taken from the environment (set NEXT_PUBLIC_API_URL / NEXT_PUBLIC_SUPABASE_URL to the values the build used).
 */
const [target, ...flags] = process.argv.slice(2);
if (!target) {
  console.error('usage: check-headers.mjs <url> [--expect-csp]');
  process.exit(2);
}

const res = await fetch(new URL('/returns', target), { redirect: 'manual' });
const h = (name) => res.headers.get(name);
let failed = 0;
const check = (ok, what, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}${!ok && detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
};

check(res.status === 200, `GET /returns answers 200`, String(res.status));
check(h('x-content-type-options') === 'nosniff', 'X-Content-Type-Options: nosniff');
check(h('x-frame-options') === 'DENY', 'X-Frame-Options: DENY');
check(!!h('referrer-policy'), 'Referrer-Policy present');
check(!!h('permissions-policy'), 'Permissions-Policy present');
check(!h('x-powered-by'), 'no X-Powered-By');

const expectCsp = flags.includes('--expect-csp') || target.startsWith('https://');
const csp = h('content-security-policy') ?? h('content-security-policy-report-only');
if (!expectCsp) {
  console.log('  skip  Content-Security-Policy (plain-http target; pass --expect-csp to require it)');
} else {
  check(!!csp, 'Content-Security-Policy present');
  if (csp) {
    const dir = (name) => (csp.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name} `)) ?? '').split(/\s+/).slice(1);
    const origin = (u) => (u ? new URL(u).origin : null);
    check(dir('script-src').includes('https://*.razorpay.com'), 'script-src allows Razorpay Checkout');
    check(dir('frame-src').includes('https://*.razorpay.com'), 'frame-src allows the Razorpay iframe');
    check(dir('object-src').includes("'none'"), "object-src 'none'");
    check(dir('frame-ancestors').includes("'none'"), "frame-ancestors 'none'");
    check(dir('base-uri').includes("'self'"), "base-uri 'self'");
    const api = origin(process.env.NEXT_PUBLIC_API_URL);
    const supabase = origin(process.env.NEXT_PUBLIC_SUPABASE_URL);
    if (api) check(dir('connect-src').includes(api), `connect-src allows the API (${api})`);
    if (supabase) check(dir('connect-src').includes(supabase), `connect-src allows Supabase (${supabase})`);
    if (target.startsWith('https://')) check(!!h('strict-transport-security'), 'Strict-Transport-Security present');
  }
}

process.exit(failed ? 1 : 0);
