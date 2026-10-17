import { clickText, fill, fillLabel, goto, login, newPage, settle, sleep, text } from '../lib/browser.mjs';

export async function run({ stack, browser, t, shared }) {
  if (!shared.orderId || !shared.codOrderId) throw new Error('the admin spec continues from the shopper spec: run "shopper admin" together');
  const api = (who, method, path, body) => stack.apiAs(who, method, path, body);
  const statusOf = async (id) => (await api('admin', 'GET', `/admin/orders/${id}`)).body.data;

  const admin = await newPage(browser, stack, { isolated: true });
  await login(admin, stack, 'admin');

  t.section('Admin: order list');
  {
    await goto(admin, stack, '/admin');
    t.check('/admin opens the overview dashboard', new URL(admin.url()).pathname === '/admin' && /Overview/.test(await text(admin, 'h1')), admin.url());
    await goto(admin, stack, '/admin/orders');
    const rows = await admin.$$eval('[data-testid=admin-order-row]', (r) => r.length);
    t.check('the shoppers’ orders are listed', rows >= 3, `${rows} rows`);

    await admin.type('input[name=q]', shared.orderNumber);
    await Promise.all([admin.waitForNavigation({ waitUntil: 'load' }), clickText(admin, /^Filter$/)]);
    await settle(admin);
    t.check('searching by order number finds exactly that order', (await admin.$$eval('[data-testid=admin-order-row]', (r) => r.length)) === 1);

    await goto(admin, stack, '/admin/orders?paymentMethod=COD');
    const codRows = await admin.$$eval('[data-testid=admin-order-row]', (r) => r.map((x) => x.textContent));
    t.check('filtering to Cash on delivery shows only COD orders', codRows.length >= 1 && codRows.every((r) => /Cash on delivery/.test(r)), `${codRows.length} rows`);
  }

  t.section('Admin: moving a paid order to delivered');
  {
    const open = async (id) => {
      await goto(admin, stack, `/admin/orders/${id}`);
    };
    const advance = async (id, expected) => {
      const before = (await statusOf(id)).fulfilmentStatus;
      await clickText(admin, new RegExp(`^Mark as ${expected}$`, 'i'));
      for (let i = 0; i < 30 && (await statusOf(id)).fulfilmentStatus === before; i++) await sleep(250);
      return (await statusOf(id)).fulfilmentStatus;
    };

    await open(shared.orderId);
    t.check('the detail page names the customer and the order', /Alice Rao/.test(await text(admin)) && (await text(admin)).includes(shared.orderNumber));

    let got = await advance(shared.orderId, 'processing');
    t.check('Mark as processing', got === 'PROCESSING', got);
    await settle(admin);
    got = await advance(shared.orderId, 'packed');
    t.check('Mark as packed', got === 'PACKED', got);
    await settle(admin);

    // A tracking note travels to the customer’s timeline.
    await admin.type('#status-note', 'Courier: BlueDart AWB 123456');
    got = await advance(shared.orderId, 'shipped');
    t.check('Mark as shipped (with a courier note)', got === 'SHIPPED', got);
    await settle(admin);
    got = await advance(shared.orderId, 'out for delivery');
    t.check('Mark as out for delivery', got === 'OUT_FOR_DELIVERY', got);
    await settle(admin);

    // The customer sees the live status.
    const alice = await newPage(browser, stack, { isolated: true });
    await login(alice, stack, 'alice');
    await goto(alice, stack, `/account/orders/${shared.orderId}`);
    t.check('the customer sees "Out for delivery"', /Out for delivery/.test(await text(alice)));
    const inbox = (await api('alice', 'GET', '/notifications')).body;
    t.check('and was notified about the shipment', JSON.stringify(inbox).includes('BlueDart') || JSON.stringify(inbox).toLowerCase().includes('ship'), JSON.stringify(inbox).slice(0, 100));

    await settle(admin);
    got = await advance(shared.orderId, 'delivered');
    t.check('Mark as delivered', got === 'DELIVERED', got + ' ' + (await admin.$$eval('[role=alert],[role=status]', (e) => e.map((x) => x.textContent).join('|'))));

    // ── the customer asks for a return ──
    await goto(alice, stack, `/account/orders/${shared.orderId}`);
    await clickText(alice, /^Return or replace$/);
    await alice.waitForSelector('[role=dialog] input[placeholder^="e.g. Wrong size"]');
    await alice.type('[role=dialog] input[placeholder^="e.g. Wrong size"]', 'Colour differs from the photos');
    await clickText(alice, /^Submit request$/);
    await t.attempt('the customer’s return request is acknowledged', async () => {
      await alice.waitForFunction(() => /Request received/.test(document.body.innerText), { timeout: 12_000 });
    });
    await alice.close();

    // ── the admin works the returns queue ──
    await goto(admin, stack, '/admin/returns');
    const row = async () => (await admin.$$eval('[data-testid=return-row]', (r) => r.map((x) => x.textContent))).find((x) => x.includes(shared.orderNumber));
    t.check('the request appears in the returns queue', !!(await row()) && /Colour differs/.test(await row()));
    await clickText(admin, /^Approve$/);
    await t.attempt('approving moves it to "Approved"', async () => {
      await admin.waitForFunction((n) => [...document.querySelectorAll('[data-testid=return-row]')].some((r) => r.textContent.includes(n) && /Approved/.test(r.textContent)), { timeout: 12_000 }, shared.orderNumber);
    });
    await clickText(admin, /^Complete$/);
    await admin.waitForSelector('[role=dialog]');
    await clickText(admin, /^Complete return$/, { selector: '[role=dialog] button' });
    await t.attempt('completing it marks the request "Completed"', async () => {
      await admin.waitForFunction((n) => [...document.querySelectorAll('[data-testid=return-row]')].some((r) => r.textContent.includes(n) && /Completed/.test(r.textContent)), { timeout: 15_000 }, shared.orderNumber);
    });
    const done = await statusOf(shared.orderId);
    t.check('the order is RETURNED and fully refunded', done.fulfilmentStatus === 'RETURNED' && done.paymentStatus === 'REFUNDED', `${done.fulfilmentStatus}/${done.paymentStatus}`);
    t.check('the refund equals what the customer paid', done.refunds.reduce((s, r) => s + r.amount, 0) === done.grandTotal, JSON.stringify(done.refunds.map((r) => [r.amount, r.status])));

    const alice2 = await newPage(browser, stack, { isolated: true });
    await login(alice2, stack, 'alice');
    await goto(alice2, stack, `/account/orders/${shared.orderId}`);
    const page = await text(alice2);
    t.check('the customer sees the return, the refund and the final status', /Return/.test(page) && /Refunded/.test(page) && /Returned/.test(page));
    await alice2.close();
  }

  t.section('Admin: a Cash on Delivery order becomes paid on delivery');
  {
    const id = shared.codOrderId;
    const step = async (label, expectStatus) => {
      await goto(admin, stack, `/admin/orders/${id}`);
      await clickText(admin, new RegExp(`^Mark as ${label}$`, 'i'));
      for (let i = 0; i < 30 && (await statusOf(id)).fulfilmentStatus !== expectStatus; i++) await sleep(250);
      return (await statusOf(id)).fulfilmentStatus;
    };
    t.check('confirm', (await step('payment confirmed', 'PAYMENT_CONFIRMED')) === 'PAYMENT_CONFIRMED');
    for (const [label, status] of [['processing', 'PROCESSING'], ['packed', 'PACKED'], ['shipped', 'SHIPPED'], ['out for delivery', 'OUT_FOR_DELIVERY']]) {
      await step(label, status);
    }
    t.check('delivery', (await step('delivered', 'DELIVERED')) === 'DELIVERED');
    const o = await statusOf(id);
    t.check('delivery is the moment cash is collected: payment becomes CAPTURED', o.paymentStatus === 'CAPTURED', o.paymentStatus);
    await goto(admin, stack, `/admin/orders/${id}`);
    t.check('a COD order offers no online refund button', !(await admin.$$eval('button', (b) => b.some((x) => /^Refund…/.test(x.textContent.trim())))));
  }

  t.section('Admin: coupons');
  {
    await goto(admin, stack, '/admin/coupons');
    t.check('the coupon made earlier is listed', /E2E10/.test(await text(admin)));

    await fillLabel(admin, /^Code/, 'UI5OFF', { scope: 'form[aria-label="New coupon"]' });
    await fillLabel(admin, /^Type/, 'FLAT', { scope: 'form[aria-label="New coupon"]' });
    await fillLabel(admin, /^Amount off/, '500', { scope: 'form[aria-label="New coupon"]' });
    await clickText(admin, /Create coupon|Add coupon|^Create$/);
    await t.attempt('a coupon created in the UI appears in the list', async () => {
      await admin.waitForFunction(() => /UI5OFF/.test(document.body.innerText), { timeout: 12_000 });
    });
    const made = (await api('admin', 'GET', '/admin/coupons?q=UI5OFF')).body.data.find((c) => c.code === 'UI5OFF');
    t.check('the server stored it as ₹500 flat (50 000 paise)', made?.discountType === 'FLAT' && made?.discountValue === 50_000, JSON.stringify(made)?.slice(0, 120));

    // The new code works in a real cart.
    await api('alice', 'POST', '/cart/items', { variantId: shared.product.variantId, quantity: 1 });
    const applied = await api('alice', 'PUT', '/cart/coupon', { code: 'ui5off' });
    t.check('a shopper can use it (case-insensitively)', applied.body?.data?.pricing?.discountTotal === 50_000, JSON.stringify(applied.body?.data?.pricing));
    await api('alice', 'DELETE', '/cart');

    // Switch it off from the UI, and the shopper is refused.
    await admin.evaluate(() => {
      const row = [...document.querySelectorAll('tr')].find((r) => /UI5OFF/.test(r.textContent));
      [...row.querySelectorAll('button')].find((b) => /^Turn off$/.test(b.textContent.trim())).click();
    });
    await sleep(1000);
    const off = (await api('admin', 'GET', '/admin/coupons?q=UI5OFF')).body.data.find((c) => c.code === 'UI5OFF');
    t.check('the on/off switch deactivates the coupon', off?.isActive === false, `isActive=${off?.isActive}`);
  }

  t.section('Admin: settings');
  {
    await goto(admin, stack, '/admin/settings');
    await admin.evaluate(() => {
      const box = [...document.querySelectorAll('label')].find((l) => /Offer Cash on Delivery/.test(l.textContent)).querySelector('input');
      if (box.checked) box.click();
    });
    await clickText(admin, /^Save payment settings$/);
    await t.attempt('saving shows "Saved."', async () => {
      await admin.waitForFunction(() => document.querySelector('form[aria-label="Payments"] [role=status]')?.textContent === 'Saved.', { timeout: 10_000 });
    });
    t.check('the server now has COD off', (await api('admin', 'GET', '/admin/settings')).body.data.payments.codEnabled === false);

    await fillLabel(admin, /^Delivery charge/, '149', { scope: 'form[aria-label="Delivery charges"]' });
    await fillLabel(admin, /^Free delivery above/, '1500', { scope: 'form[aria-label="Delivery charges"]' });
    await clickText(admin, /^Save delivery charges$/);
    await admin.waitForFunction(() => document.querySelector('form[aria-label="Delivery charges"] [role=status]')?.textContent === 'Saved.', { timeout: 10_000 }).catch(() => undefined);
    const ship = (await api('admin', 'GET', '/admin/settings')).body.data.shipping;
    t.check('delivery charges are saved in paise', ship.flatRate === 14_900 && ship.freeThreshold === 150_000, JSON.stringify(ship));

    // The new rule reaches real carts immediately.
    const cheap = (await (await fetch(`${stack.api}/products?pageSize=48&sort=price_asc`)).json()).data[0];
    const detail = (await (await fetch(`${stack.api}/products/${cheap.slug}`)).json()).data;
    const v = detail.variants.find((x) => x.available >= 1);
    await api('alice', 'POST', '/cart/items', { variantId: v.id, quantity: 1 });
    const cart = (await api('alice', 'GET', '/cart')).body.data;
    const expectedShipping = cart.pricing.subtotal >= 150_000 ? 0 : 14_900;
    t.check('a cart is priced with the new delivery rule', cart.pricing.shippingTotal === expectedShipping, `${cart.pricing.subtotal} → ${cart.pricing.shippingTotal}`);
    await api('alice', 'DELETE', '/cart');
  }

  await admin.close();
}
