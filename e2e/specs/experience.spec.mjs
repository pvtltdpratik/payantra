import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { deliverOrder, eventually, findStockedProduct, placeOrder } from '../lib/flows.mjs';
import { artifacts, clickText, fill, fillLabel, goto, login, newPage, settle, sleep, text } from '../lib/browser.mjs';

const toPaise = (s) => Math.round(parseFloat(String(s).replace(/[^0-9.]/g, '')) * 100);

/**
 * The Phase 4 screens around the order flow: the admin's overview and reports, customers, support, reviews,
 * notifications, banners, the newsletter, the audit log, and the customer's own security page.
 */
export async function run({ stack, browser, t }) {
  const api = (who, method, path, body) => stack.apiAs(who, method, path, body);
  const product = await findStockedProduct(stack, 6);
  await api('alice', 'PATCH', '/users/me', { fullName: 'Alice Rao' });

  const admin = await newPage(browser, stack, { isolated: true });
  const alice = await newPage(browser, stack, { isolated: true });
  const visitor = await newPage(browser, stack, { isolated: true });
  await login(admin, stack, 'admin');
  await login(alice, stack, 'alice');

  // A delivered order gives us revenue to report on and something to review.
  const delivered = await placeOrder(stack, 'alice', product);
  await deliverOrder(stack, delivered.id);
  // One order is paid and refunded, so the refunds figure is real.
  const refunded = await placeOrder(stack, 'bob', product);
  await api('admin', 'POST', `/admin/orders/${refunded.id}/cancel`, { reason: 'Customer changed their mind' });

  t.section('Admin: overview dashboard');
  {
    await goto(admin, stack, '/admin');
    t.check('/admin opens the overview', /Overview/.test(await text(admin, 'h1')));
    const api30 = (await api('admin', 'GET', '/admin/analytics/overview')).body.data;
    t.check('gross sales are computed from real orders (not hard-coded)', toPaise(await text(admin, '[data-testid=kpi-gross]')) === api30.totals.grossSales && api30.totals.grossSales >= delivered.grandTotal + refunded.grandTotal, `${api30.totals.grossSales}`);
    // Other specs in a full run also refund things, so require at least OUR refund, and the exact identity net = gross − refunds.
    t.check('net revenue is gross minus refunds', toPaise(await text(admin, '[data-testid=kpi-net]')) === api30.totals.grossSales - api30.totals.refunds && api30.totals.netRevenue === api30.totals.grossSales - api30.totals.refunds && api30.totals.refunds >= refunded.grandTotal, `gross ${api30.totals.grossSales} refunds ${api30.totals.refunds}`);
    t.check('paid orders are counted', (await text(admin, '[data-testid=kpi-orders]')).trim() === String(api30.totals.paidOrders));
    t.check('the sales chart is drawn, with a data table for screen readers', (await admin.$('figure svg[role=img]')) !== null && (await admin.$$eval('figure table.sr-only tbody tr', (r) => r.length)) === api30.salesByDay.length);
    t.check('orders are broken down by status', /Delivered/.test(await text(admin, '[data-testid=status-breakdown]')));
    t.check('recent transactions show payments and the refund', /Refund/.test(await text(admin, '[data-testid=recent-transactions]')) && /Payment/.test(await text(admin, '[data-testid=recent-transactions]')));
    t.check('the "needs attention" list links to the right places', (await admin.$$eval('a', (a) => a.map((x) => x.getAttribute('href')))).includes('/admin/support'));

    await goto(admin, stack, '/admin?from=2020-01-01&to=2020-01-31');
    t.check('a quiet period reads as zero, not as an error', toPaise(await text(admin, '[data-testid=kpi-gross]')) === 0 && /No orders were placed in this period/.test(await text(admin)));
    await goto(admin, stack, '/admin?from=garbage&to=2026-99-99');
    t.check('nonsense dates fall back to the default range instead of breaking', /Net revenue/.test(await text(admin)));
  }

  t.section('Admin: reports and CSV export');
  {
    await goto(admin, stack, '/admin/analytics?report=sales');
    const salesRows = await admin.$$eval('[data-testid=report-row]', (r) => r.length);
    t.check('the sales report lists days with paid orders', salesRows >= 1 && /Sales by day/.test(await text(admin, '[data-testid=report-title]')));
    const totals = await text(admin, '[data-testid=report-totals]');
    const overviewNow = (await api('admin', 'GET', '/admin/analytics/overview')).body.data.totals;
    t.check('the report’s totals row matches the overview', totals.includes(String(overviewNow.paidOrders)));

    await clickText(admin, /^Monthly$/, { selector: 'a' });
    await admin.waitForFunction(() => /Sales by month/.test(document.body.innerText), { timeout: 15_000 });
    t.check('grouping by month collapses the days', (await admin.$$eval('[data-testid=report-row]', (r) => r.length)) === 1);

    await clickText(admin, /^Products$/, { selector: 'nav[aria-label=\"Reports\"] a' });
    await admin.waitForFunction(() => /Product performance/.test(document.body.innerText), { timeout: 15_000 });
    t.check('the product report ranks what sold', (await text(admin, '[data-testid=report-table]')).includes(product.name));

    await clickText(admin, /^Inventory$/, { selector: 'nav[aria-label=\"Reports\"] a' });
    await admin.waitForFunction(() => /Inventory/.test(document.querySelector('[data-testid=report-title]')?.textContent ?? ''), { timeout: 15_000 });
    t.check('the inventory report shows stock levels', (await admin.$$eval('[data-testid=report-row]', (r) => r.length)) > 5);
    await clickText(admin, /^Low and sold out$/, { selector: 'a' });
    await admin.waitForFunction(() => /Low and out-of-stock/.test(document.body.innerText), { timeout: 15_000 });
    t.check('…which can be narrowed to what needs restocking', (await admin.$$eval('[data-testid=report-row]', (r) => r.every((x) => /Low|Out of stock/.test(x.textContent)))));

    await clickText(admin, /^Payments & refunds$/, { selector: 'nav[aria-label=\"Reports\"] a' });
    await admin.waitForFunction(() => /Payments and refunds/.test(document.body.innerText), { timeout: 15_000 });
    t.check('the payments ledger lists captures and refunds', /Refund/.test(await text(admin, '[data-testid=report-table]')) && /Payment/.test(await text(admin, '[data-testid=report-table]')));
    await clickText(admin, /^Delivery$/, { selector: 'nav[aria-label=\"Reports\"] a' });
    await admin.waitForFunction(() => /Delivery performance/.test(document.body.innerText), { timeout: 15_000 });
    t.check('the delivery report is available', /Delivery performance/.test(await text(admin, '[data-testid=report-title]')));

    // The download button, end to end: browser → API (with the admin's token) → file on disk.
    const dir = join(artifacts, 'downloads');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    await goto(admin, stack, '/admin/analytics?report=sales');
    const cdp = await admin.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, browserContextId: admin.browserContext().id });
    await clickText(admin, /^Download CSV$/);
    const file = await eventually(() => readdirSync(dir).find((f) => f.endsWith('.csv')), { timeout: 15_000 });
    t.check('the CSV downloads with a sensible file name', !!file && /^payantra-sales-\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2}\.csv$/.test(file), String(file));
    if (file) {
      await sleep(300);
      const csv = readFileSync(join(dir, file), 'utf8');
      t.check('it opens as UTF-8 with the headers and a totals row', csv.startsWith('﻿Day,Paid orders,Gross sales (INR)') && /\r\nTotal,/.test(csv), csv.slice(0, 60));
      // The day's row is a SUM of every order paid that day, so compare with the API's own total for the same dates.
      const [from, to] = file.replace(/^payantra-sales-/, '').replace(/\.csv$/, '').split('_to_'); // the dates are in the file's name
      const json = (await api('admin', 'GET', `/admin/reports/sales?from=${from}&to=${to}`)).body?.data;
      const totalLine = csv.split('\r\n').find((l) => l.startsWith('Total,')) ?? '';
      t.check('and its numbers are in rupees, matching the on-screen totals', !!json && totalLine.split(',')[2] === String(json.totals.gross / 100), `${totalLine} vs ${json?.totals?.gross}`);
    }
    t.check('a customer cannot download reports (403)', (await api('alice', 'GET', '/admin/reports/sales?format=csv')).status === 403);
  }

  t.section('Admin: customers');
  {
    await goto(admin, stack, '/admin/customers');
    t.check('customers are listed with their spend', (await admin.$$eval('[data-testid=customer-row]', (r) => r.length)) >= 2);
    t.check('admins and delivery partners are not listed as customers', !/admin@payantra\.test/.test(await text(admin, 'main')));
    await admin.type('input[name=q]', 'alice');
    await Promise.all([admin.waitForNavigation({ waitUntil: 'load' }), clickText(admin, /^Filter$/)]);
    await settle(admin);
    t.check('searching narrows the list', (await admin.$$eval('[data-testid=customer-row]', (r) => r.length)) === 1);
    await clickText(admin, /Alice Rao|alice@payantra\.test/, { selector: 'a' });
    await admin.waitForFunction(() => /^\/admin\/customers\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 15_000 });
    await admin.waitForSelector('[data-testid=customer-name]', { timeout: 15_000 });
    await settle(admin);
    const detail = await text(admin);
    // (innerText applies CSS text-transform, so uppercase labels read as "TOTAL PAID": match case-insensitively.)
    const has = { orders: /Recent orders/i.test(detail), number: detail.includes(delivered.orderNumber), addresses: /Addresses/i.test(detail), total: /Total paid/i.test(detail) };
    t.check('the profile shows orders, totals and addresses', Object.values(has).every(Boolean), JSON.stringify(has));
    t.check('and never any credentials', !/password|secret|token/i.test(detail));
  }

  t.section('Support: customer asks, admin answers');
  {
    await goto(alice, stack, '/account/support');
    await clickText(alice, /^Send message$/);
    await t.attempt('an empty message is rejected inline', async () => {
      await alice.waitForFunction(() => /short subject|a little more/i.test(document.body.innerText), { timeout: 5000 });
    });
    await fill(alice, '#support-subject', 'Question about my saree');
    await alice.select('#support-order', delivered.id);
    await fill(alice, '#support-message', 'Could you tell me how to care for the zari border?');
    await clickText(alice, /^Send message$/);
    await t.attempt('sending confirms receipt', async () => {
      await alice.waitForFunction(() => document.querySelector('[data-testid=support-sent]'), { timeout: 12_000 });
    });
    await alice.waitForSelector('[data-testid=my-request]', { timeout: 15_000 }).catch(() => undefined);
    t.check('the request is listed under "Your conversations"', /Question about my saree/.test(await text(alice, '[data-testid=my-request]')));

    await goto(admin, stack, '/admin/support?status=OPEN');
    t.check('the admin sees it in the inbox, linked to the customer and the order', /Question about my saree/.test(await text(admin, '[data-testid=support-item]')) && (await text(admin, '[data-testid=support-item]')).includes(delivered.orderNumber));
    await admin.type('textarea', 'Dry-clean only, and store it folded in muslin. Thank you for choosing Payantra!');
    await clickText(admin, /^Send reply$/);
    await t.attempt('the admin’s reply is sent', async () => {
      await admin.waitForFunction(() => /Reply sent/.test(document.body.innerText), { timeout: 12_000 });
    });

    await goto(alice, stack, '/account/support');
    t.check('the customer reads the reply on their support page', /Dry-clean only/.test(await text(alice, '[data-testid=support-reply]')));
  }

  t.section('Notifications');
  {
    await goto(alice, stack, '/');
    await alice.waitForSelector('[data-testid=unread-badge]', { timeout: 15_000 }).catch(() => undefined);
    const badge = await alice.$eval('[data-testid=unread-badge]', (e) => e.textContent.trim()).catch(() => null);
    t.check('the header bell shows how many are unread', !!badge && Number(badge) >= 1, String(badge));

    await goto(alice, stack, '/account/notifications');
    const titles = (await alice.$$eval('[data-testid=notification]', (n) => n.map((x) => x.textContent))).join(' | ');
    t.check('order and support updates are listed', /Reply to your request/.test(titles) && /delivered/i.test(titles));
    await clickText(alice, /^Mark all as read$/);
    await t.attempt('"Mark all as read" clears the count', async () => {
      await alice.waitForFunction(() => /all caught up/i.test(document.querySelector('[data-testid=unread-count]')?.textContent ?? ''), { timeout: 12_000 });
    });
    t.check('the server agrees', (await api('alice', 'GET', '/notifications?pageSize=1')).body.meta.unread === 0);
  }

  t.section('Reviews and recently viewed');
  {
    await goto(visitor, stack, `/product/${product.slug}`);
    t.check('a visitor sees the reviews section, with no form', (await visitor.$('[data-testid=reviews-section]')) !== null && (await visitor.$('[data-testid=review-prompt]')) === null);
    t.check('and, before any review, an invitation to be first', (await visitor.$('[data-testid=no-reviews]')) !== null, (await text(visitor, '[data-testid=reviews-section]').catch(() => 'no section')).replace(/\s+/g, ' ').slice(0, 140));

    await goto(alice, stack, `/product/${product.slug}`);
    await alice.waitForSelector('[data-testid=review-prompt]', { timeout: 15_000 });
    t.check('a customer whose order was delivered is offered the review form', /Review your purchase/.test(await text(alice, '[data-testid=review-prompt]')) && (await text(alice, '[data-testid=review-prompt]')).includes(delivered.orderNumber));
    t.check('submitting without stars is blocked (the button stays disabled)', await alice.$eval('form[aria-label="Write a review"] button[type=submit]', (b) => b.disabled).catch(() => false));
    await alice.evaluate(() => document.querySelector('input[aria-label="5 stars"]').click());
    await fill(alice, '#pdp-title', 'Worth every rupee');
    await fill(alice, '#pdp-body', 'The weave is beautiful and it arrived beautifully packed.');
    await clickText(alice, /^Submit review$/);
    await t.attempt('posting a review thanks the customer', async () => {
      await alice.waitForFunction(() => document.querySelector('[data-testid=review-thanks]'), { timeout: 15_000 });
    });
    await alice.waitForFunction(() => document.querySelector('[data-testid=review]'), { timeout: 15_000 }).catch(() => undefined);
    t.check('the review appears at once on the product page, with a masked name and a verified badge', (await alice.$$eval('[data-testid=review]', (r) => r.length)) === 1 && /Alice R\./.test(await text(alice, '[data-testid=review]')) && /Verified purchase/.test(await text(alice, '[data-testid=review]')) && !/Rao/.test(await text(alice, '[data-testid=reviews-section]')));
    t.check('the rating summary updates', (await text(alice, '[data-testid=reviews-average]')).trim() === '5.0' && /1 review/.test(await text(alice, '[data-testid=reviews-count]')));
    await sleep(500);
    t.check('and the form is gone (one review per purchase)', (await alice.$('[data-testid=review-prompt]')) === null);

    await goto(visitor, stack, `/product/${product.slug}`);
    t.check('a visitor now sees it too', (await visitor.$$eval('[data-testid=review]', (r) => r.length)) === 1);

    // Admin moderation: hiding removes it from the page and the rating at once.
    await goto(admin, stack, '/admin/reviews');
    t.check('the admin sees the review to moderate', /Worth every rupee/.test(await text(admin, '[data-testid=moderation-row]')));
    await clickText(admin, /^Hide$/);
    await eventually(async () => (await (await fetch(`${stack.api}/reviews/product/${product.slug}`)).json()).data.items.length === 0);
    await goto(visitor, stack, `/product/${product.slug}`);
    t.check('a hidden review disappears from the product page', (await visitor.$$eval('[data-testid=review]', (r) => r.length)) === 0 && (await visitor.$('[data-testid=no-reviews]')) !== null);
    await goto(alice, stack, '/account/reviews');
    t.check('the author sees it marked as hidden', /Hidden by our team/.test(await text(alice, '[data-testid=my-review]')));
    await api('admin', 'PATCH', `/admin/reviews/${(await api('admin', 'GET', '/admin/reviews')).body.data[0].id}`, { isVisible: true });

    // Recently viewed.
    const other = (await (await fetch(`${stack.api}/products?pageSize=3&sort=newest`)).json()).data.find((p) => p.slug !== product.slug);
    await goto(alice, stack, `/product/${other.slug}`);
    await sleep(800);
    await goto(alice, stack, `/product/${product.slug}`);
    await sleep(800);
    await goto(alice, stack, '/account');
    const names = await alice.$$eval('[data-testid=recently-viewed] article h3, [data-testid=recently-viewed] article a', (n) => n.map((x) => x.getAttribute('aria-label') ?? x.textContent));
    t.check('the account page lists what the shopper looked at, newest first', names.length >= 2 && names[0].startsWith(product.name) && names.some((n) => n.startsWith(other.name)), names.join(' | ').slice(0, 120));
    t.check('guests have no server-side trail (401)', (await fetch(`${stack.api}/recently-viewed`)).status === 401);
  }

  t.section('Marketing: banners and the newsletter');
  {
    await goto(admin, stack, '/admin/banners');
    await fillLabel(admin, /^Title/, 'Diwali Edit', { scope: 'form[aria-label="New banner"]' });
    await fillLabel(admin, /^Image/, '/placeholder/c8a96a?label=Diwali', { scope: 'form[aria-label="New banner"]' });
    await fillLabel(admin, /^Links to/, 'javascript:alert(1)', { scope: 'form[aria-label="New banner"]' });
    await clickText(admin, /^Add banner$/);
    await t.attempt('an unsafe link is refused with an explanation', async () => {
      await admin.waitForFunction(() => /site path like \/shop or an https/i.test(document.body.innerText), { timeout: 10_000 });
    });
    await fillLabel(admin, /^Links to/, '/shop', { scope: 'form[aria-label="New banner"]' });
    await clickText(admin, /^Add banner$/);
    await t.attempt('a valid banner is added and shows as Live', async () => {
      await admin.waitForFunction(() => /Banner added/.test(document.body.innerText) && /Live/.test(document.querySelector('[data-testid=banner-row]')?.textContent ?? ''), { timeout: 12_000 });
    });
    const pub = (await (await fetch(`${stack.api}/banners?placement=HOME_HERO`)).json()).data;
    t.check('shoppers’ API serves it', pub.length === 1 && pub[0].title === 'Diwali Edit' && pub[0].linkUrl === '/shop');
    await clickText(admin, /^Turn off$/);
    await eventually(async () => (await (await fetch(`${stack.api}/banners`)).json()).data.length === 0);
    t.check('switching it off removes it from the public list', (await (await fetch(`${stack.api}/banners`)).json()).data.length === 0);
    admin.once('dialog', () => undefined);
    await admin.click('button[aria-label="Delete Diwali Edit"]');
    await eventually(async () => (await api('admin', 'GET', '/admin/banners')).body.data.length === 0);
    t.check('and deleting removes it for good', (await api('admin', 'GET', '/admin/banners')).body.data.length === 0);

    await goto(visitor, stack, '/');
    await visitor.type('#newsletter-email', 'not-an-email');
    await clickText(visitor, /^Subscribe$/);
    t.check('the footer sign-up rejects an invalid address', /valid email/i.test(await text(visitor, 'footer')));
    await fill(visitor, '#newsletter-email', 'reader@example.test');
    await clickText(visitor, /^Subscribe$/);
    await t.attempt('and welcomes a valid one', async () => {
      await visitor.waitForFunction(() => document.querySelector('[data-testid=newsletter-done]'), { timeout: 12_000 });
    });
    await goto(admin, stack, '/admin/newsletter');
    t.check('the admin sees the new subscriber and the count', /reader@example\.test/.test(await text(admin, 'main')) && /1 active subscriber/.test(await text(admin, '[data-testid=subscriber-count]')));
    await clickText(admin, /^Unsubscribe$/);
    await eventually(async () => (await api('admin', 'GET', '/admin/newsletter')).body.data[0].unsubscribedAt);
    await goto(admin, stack, '/admin/newsletter');
    t.check('unsubscribing updates the list', /0 active subscribers/.test(await text(admin, '[data-testid=subscriber-count]')) && /Unsubscribed/.test(await text(admin, '[data-testid=subscriber-row]')));
  }

  t.section('Admin: audit log');
  {
    await goto(admin, stack, '/admin/audit');
    const rows = await admin.$$eval('[data-testid=audit-row]', (r) => r.map((x) => x.textContent));
    t.check('important actions are recorded with who did them', rows.length > 5 && rows.some((r) => /banner\.create/.test(r)) && rows.some((r) => /admin@payantra\.test|Ananya Admin/.test(r)));
    await admin.select('select[name=entityType]', 'Banner');
    await Promise.all([admin.waitForNavigation({ waitUntil: 'load' }), clickText(admin, /^Filter$/)]);
    await settle(admin);
    t.check('the log can be filtered by what changed', (await admin.$$eval('[data-testid=audit-row]', (r) => r.length)) === 3 && (await admin.$$eval('[data-testid=audit-row]', (r) => r.every((x) => /banner\./.test(x.textContent)))));
  }

  t.section('Customer: account security');
  {
    await goto(alice, stack, '/account/security');
    await fill(alice, '#current-password', 'definitely-wrong');
    await fill(alice, '#new-password', 'Brocade#2026b');
    await fill(alice, '#confirm-new-password', 'Brocade#2026b');
    await clickText(alice, /^Change password$/);
    await t.attempt('a wrong current password is refused', async () => {
      await alice.waitForFunction(() => /isn't your current password/.test(document.body.innerText), { timeout: 12_000 });
    });
    await fill(alice, '#current-password', stack.accounts.alice.password);
    await fill(alice, '#new-password', 'short');
    await fill(alice, '#confirm-new-password', 'different');
    await clickText(alice, /^Change password$/);
    t.check('a weak or mismatched new password is rejected before anything is sent', /at least 8|do not match/.test(await text(alice, 'main')));

    await fill(alice, '#new-password', 'Brocade#2026b');
    await fill(alice, '#confirm-new-password', 'Brocade#2026b');
    await clickText(alice, /^Change password$/);
    await t.attempt('a correct change succeeds', async () => {
      await alice.waitForFunction(() => /Password changed/.test(document.body.innerText), { timeout: 15_000 });
    });
    stack.accounts.alice.password = 'Brocade#2026b';
    const fresh = await newPage(browser, stack, { isolated: true });
    await login(fresh, stack, 'alice');
    t.check('the new password signs in', new URL(fresh.url()).pathname !== '/auth/login');
    await fresh.close();
    await clickText(alice, /^Sign out other devices$/);
    await t.attempt('"sign out other devices" confirms', async () => {
      await alice.waitForFunction(() => /Signed out everywhere else/.test(document.body.innerText), { timeout: 12_000 });
    });
  }

  await visitor.close();
  await alice.close();
  await admin.close();
}
