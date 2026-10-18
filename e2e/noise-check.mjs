/**
 * Counts error lines the storefront writes while a signed-in person walks the private pages. A healthy build is
 * quiet: every line here is one a real operator would have to read past.
 *
 *   E2E_SKIP_BUILD=1 node noise-check.mjs     (reuse the last build; omit to rebuild first)
 */
import { launchBrowser, goto, login, newPage, settle } from './lib/browser.mjs';
import { startStack } from './lib/stack.mjs';

const stack = await startStack({ log: () => undefined });
const browser = await launchBrowser();
try {
  const page = await newPage(browser, stack, { isolated: true });
  await login(page, stack, 'alice');
  for (const path of ['/account', '/cart', '/wishlist', '/account/orders', '/account/notifications', '/account/addresses', '/account/reviews', '/account/support', '/account/security', '/checkout']) {
    await goto(page, stack, path);
    await settle(page, 300);
  }
  const admin = await newPage(browser, stack, { isolated: true });
  await login(admin, stack, 'admin');
  for (const path of ['/admin', '/admin/orders', '/admin/returns', '/admin/products']) {
    await goto(admin, stack, path);
    await settle(admin, 300);
  }
  const web = stack.logs().web;
  const lines = web.split('\n').filter((l) => /^(Error|⨯|TypeError)/.test(l));
  const kinds = {};
  for (const l of lines) kinds[l.replace(/Route "[^"]*"/, 'Route "…"').slice(0, 110)] = (kinds[l.replace(/Route "[^"]*"/, 'Route "…"').slice(0, 110)] ?? 0) + 1;
  console.log(`error lines in the storefront log: ${lines.length}`);
  for (const [k, n] of Object.entries(kinds)) console.log(`  ${n} × ${k}`);
} finally {
  await browser.close();
  await stack.stop();
}
