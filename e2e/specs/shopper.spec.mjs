import { clickText, fill, goto, login, newPage, settle, sleep, text } from '../lib/browser.mjs';

/** "₹12,499" / "−₹1,250.50" → paise. */
const toPaise = (s) => Math.round(parseFloat(String(s).replace(/[^0-9.]/g, '')) * 100);
const orderIdFrom = (url) => new URL(url).pathname.split('/')[3];

export async function run({ stack, browser, t, shared }) {
  const api = (who, method, path, body) => stack.apiAs(who, method, path, body);

  // ── fixtures made through the real admin API (the same calls the admin screens make) ──
  const nextYear = new Date(Date.now() + 365 * 86_400_000).toISOString();
  const coupon = await api('admin', 'POST', '/admin/coupons', {
    code: 'E2E10',
    description: 'E2E ten percent',
    discountType: 'PERCENTAGE',
    discountValue: 10,
    minOrderValue: 0,
    perUserLimit: 5,
    startsAt: new Date(Date.now() - 86_400_000).toISOString(),
    endsAt: nextYear,
    isActive: true,
  });
  t.check('admin can create a coupon through the API', coupon.status === 201, `HTTP ${coupon.status} ${JSON.stringify(coupon.body)?.slice(0, 120)}`);

  // The seed gives each variant random stock, so choose a product we can actually buy 3 of.
  const list = await (await fetch(`${stack.api}/products?pageSize=48`)).json();
  let product;
  for (const item of list.data) {
    const detail = (await (await fetch(`${stack.api}/products/${item.slug}`)).json()).data;
    const first = detail.variants.find((v) => v.stockStatus !== 'OUT_OF_STOCK') ?? detail.variants[0];
    if (first && first.available >= 4) {
      product = { slug: detail.slug, name: detail.name, id: detail.id, variantId: first.id, available: first.available, price: first.price };
      break;
    }
  }
  if (!product) throw new Error('the seeded catalogue has no product with 4+ units of its default variant');
  shared.product = product;

  const alice = await newPage(browser, stack);
  await login(alice, stack, 'alice');

  t.section('Search and product page');
  {
    await goto(alice, stack, '/');
    await alice.type('input[name=q]', 'saree');
    await Promise.all([alice.waitForFunction(() => location.pathname === '/search', { timeout: 15_000 }), alice.keyboard.press('Enter')]);
    await settle(alice);
    const links = await alice.$$eval('a[href^="/product/"]', (as) => as.length);
    t.check('searching for "saree" lists products', links > 0, `${links} product links`);

    await goto(alice, stack, `/product/${product.slug}`);
    t.check('the product page shows the product name', (await text(alice, 'h1')).includes(product.name));
    t.check('…and a price', /₹/.test(await text(alice)));
  }

  t.section('Wishlist');
  {
    const label = `Save ${product.name} to wishlist`;
    await alice.waitForSelector(`button[aria-label="${label}"]`);
    await alice.click(`button[aria-label="${label}"]`);
    await t.attempt('the heart flips to "saved"', async () => {
      await alice.waitForSelector(`button[aria-label="Remove ${product.name} from wishlist"]`, { timeout: 8000 });
    });
    // The heart flips optimistically, before the request lands: give the server a moment.
    let ids = [];
    for (let i = 0; i < 20 && !ids.includes(product.id); i++) {
      ids = (await api('alice', 'GET', '/wishlist/ids')).body.data;
      if (!ids.includes(product.id)) await sleep(250);
    }
    t.check('the server stored it', ids.includes(product.id));

    await goto(alice, stack, '/wishlist');
    t.check('the wishlist page lists the saved product', (await text(alice)).includes(product.name));

    await alice.click(`button[aria-label="Remove ${product.name} from wishlist"]`);
    await sleep(800);
    t.check('removing it empties the server list', !(await api('alice', 'GET', '/wishlist/ids')).body.data.includes(product.id));
  }

  t.section('Bag');
  {
    await goto(alice, stack, `/product/${product.slug}`);
    await alice.click('button[aria-label="Increase quantity"]');
    t.check('the quantity stepper goes to 2', (await alice.$eval('[data-testid=qty]', (e) => e.textContent)) === '2');
    await clickText(alice, /^Add to bag$/);
    await t.attempt('confirms "Added to your bag"', async () => {
      await alice.waitForFunction(() => /Added to your bag/.test(document.body.innerText), { timeout: 10_000 });
    });
    let cart = (await api('alice', 'GET', '/cart')).body.data;
    t.check('the server cart holds 2 of that variant', cart.items.length === 1 && cart.items[0].quantity === 2, JSON.stringify(cart.items.map((i) => i.quantity)));

    await goto(alice, stack, '/cart');
    t.check('the bag page shows one line, quantity 2', (await alice.$$eval('[data-testid=line-qty]', (e) => e.map((x) => x.textContent))).join() === '2');

    await alice.click('button[aria-label="Increase quantity"]');
    await alice.waitForFunction(() => document.querySelector('[data-testid=line-qty]')?.textContent === '3', { timeout: 8000 });
    cart = (await api('alice', 'GET', '/cart')).body.data;
    t.check('increasing the quantity is saved on the server', cart.items[0].quantity === 3);
    t.check('the displayed total is the server’s total', toPaise(await text(alice, '[data-testid=grand-total]')) === cart.pricing.grandTotal, `${cart.pricing.grandTotal}`);

    await alice.type('#coupon', 'nonsense-code');
    await clickText(alice, /^Apply$/);
    await t.attempt('an unknown coupon is refused with a message', async () => {
      await alice.waitForFunction(() => /not valid/i.test(document.body.innerText), { timeout: 8000 });
    });

    await fill(alice, '#coupon', 'e2e10'); // lower case on purpose: codes are case-insensitive
    await clickText(alice, /^Apply$/);
    await t.attempt('a valid coupon (typed in lower case) is applied', async () => {
      await alice.waitForFunction(() => /E2E10 applied/.test(document.body.innerText), { timeout: 8000 });
    });
    cart = (await api('alice', 'GET', '/cart')).body.data;
    t.check('the server computed a 10% discount', cart.pricing.discountTotal > 0 && cart.pricing.grandTotal === cart.pricing.subtotal - cart.pricing.discountTotal + cart.pricing.shippingTotal, JSON.stringify(cart.pricing));
    t.check('the page total matches', toPaise(await text(alice, '[data-testid=grand-total]')) === cart.pricing.grandTotal);
    shared.cartPricing = cart.pricing;
  }

  t.section('Checkout: address, then payment that is dismissed, fails, and finally succeeds');
  {
    await clickText(alice, /^Proceed to checkout$/);
    await alice.waitForFunction(() => location.pathname === '/checkout', { timeout: 15_000 });
    await settle(alice);

    // No saved address yet, so the form is already open.
    await clickText(alice, /^Add address$/);
    await t.attempt('an empty address form is rejected inline', async () => {
      await alice.waitForFunction(() => /valid 10-digit|required|enter/i.test(document.body.innerText), { timeout: 5000 });
    });
    await alice.type('#co-fullName', 'Alice Rao');
    await alice.type('#co-phone', '1234567890'); // invalid: must start 6-9
    await alice.type('#co-line1', '12 Lotus Apartments, MG Road');
    await alice.type('#co-city', 'Pune');
    await alice.select('#co-state', 'Maharashtra');
    await alice.type('#co-postalCode', '411001');
    await clickText(alice, /^Add address$/);
    await t.attempt('an invalid mobile number is rejected', async () => {
      await alice.waitForFunction(() => /valid 10-digit mobile/i.test(document.body.innerText), { timeout: 5000 });
    });
    await fill(alice, '#co-phone', '9876543210');
    await clickText(alice, /^Add address$/);
    await t.attempt('the corrected address is saved and selected', async () => {
      await alice.waitForSelector('input[name=address]:checked', { timeout: 8000 });
    });
    t.check('the server has the address', (await api('alice', 'GET', '/addresses')).body.data.length === 1);

    const payButton = () => alice.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /^Pay /.test(b.textContent.trim()) && !b.disabled), { timeout: 20_000 });
    await payButton();
    const payLabel = await alice.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Pay /.test(b.textContent.trim())).textContent.trim());
    t.check('the Pay button shows the server total', toPaise(payLabel) === shared.cartPricing.grandTotal, payLabel);

    // 1) The shopper closes the Razorpay window.
    await alice.evaluate(() => (window.__rzp.outcome = 'dismiss'));
    await clickText(alice, /^Pay /);
    await t.attempt('closing the payment window explains what happened', async () => {
      await alice.waitForFunction(() => /closed the payment window/i.test(document.body.innerText), { timeout: 10_000 });
    });
    const razorpayCall = await alice.evaluate(() => window.__rzp.lastOptions);
    t.check('Razorpay was opened with the server-computed amount', razorpayCall?.amount === shared.cartPricing.grandTotal, JSON.stringify(razorpayCall));
    t.check('…and the order exists, unpaid', (await api('alice', 'GET', '/orders')).body.data.some((o) => o.paymentStatus !== 'CAPTURED'));

    // 2) The bank declines.
    await alice.evaluate(() => (window.__rzp.outcome = 'failed'));
    await clickText(alice, /^Try payment again$/);
    await t.attempt('a declined payment is reported', async () => {
      await alice.waitForFunction(() => /Payment failed at the bank|did not go through|Payment not completed/i.test(document.body.innerText), { timeout: 10_000 });
    });

    // 3) Third time lucky.
    await alice.evaluate(() => (window.__rzp.outcome = 'captured'));
    await clickText(alice, /^Try payment again$/);
    await alice.waitForFunction(() => /\/account\/orders\/[^/]+$/.test(location.pathname), { timeout: 20_000 });
    await settle(alice);
    shared.orderId = orderIdFrom(alice.url());
    t.check('a successful payment lands on the order page with ?placed=1', alice.url().includes('placed=1'), alice.url());
    t.check('…which celebrates a confirmed order', /your order is confirmed/i.test(await text(alice, '[data-testid=order-placed-banner]')));
    t.check('…and shows it as Paid', /Paid/.test(await text(alice, '[data-testid=payment-status]')));
    const orders = (await api('alice', 'GET', '/orders')).body.data;
    t.check('exactly ONE order exists after three payment attempts', orders.length === 1, `${orders.length}`);
  }

  t.section('Order page');
  {
    const order = (await api('alice', 'GET', `/orders/${shared.orderId}`)).body.data;
    shared.orderNumber = order.orderNumber;
    t.check('payment is CAPTURED and the order is PAYMENT_CONFIRMED', order.paymentStatus === 'CAPTURED' && order.fulfilmentStatus === 'PAYMENT_CONFIRMED', `${order.paymentStatus}/${order.fulfilmentStatus}`);
    t.check('the order total equals what the cart showed', order.grandTotal === shared.cartPricing.grandTotal);
    t.check('the coupon was recorded', order.couponCode === 'E2E10' && order.discountTotal === shared.cartPricing.discountTotal);
    const body = await text(alice);
    t.check('the page shows the order number', body.includes(order.orderNumber));
    const done = await alice.$$eval('[data-testid=order-timeline] li[data-state=done]', (l) => l.length);
    t.check('the timeline marks placed and payment confirmed as done', done === 2, `${done} done`);
    t.check('the page total matches the order', toPaise(await alice.$eval('[data-testid=order-totals] div:last-of-type dd, [data-testid=order-totals] .border-t dd', (e) => e.textContent)) === order.grandTotal);

    // The cart was emptied by checkout.
    t.check('the bag is empty after paying', (await api('alice', 'GET', '/cart')).body.data.items.length === 0);

    await clickText(alice, /Invoice/);
    await alice.waitForFunction(() => location.pathname.endsWith('/invoice'), { timeout: 15_000 });
    await settle(alice);
    const invoice = await text(alice);
    t.check('the invoice shows the order number and GST', invoice.includes(order.orderNumber) && /GST|Tax/i.test(invoice));

    await goto(alice, stack, `/account/orders/${shared.orderId}`);
    await clickText(alice, /Buy again/);
    await alice.waitForFunction(() => location.pathname === '/cart', { timeout: 15_000 });
    await settle(alice);
    t.check('"Buy again" puts the items back in the bag', (await api('alice', 'GET', '/cart')).body.data.items.length === 1);
    await api('alice', 'DELETE', '/cart');

    await goto(alice, stack, '/account/orders');
    t.check('the orders list shows the order', (await text(alice)).includes(order.orderNumber));
  }

  t.section('Cancelling a paid order refunds it');
  {
    // A second paid order, created through the API and paid through the mock bank.
    await api('alice', 'POST', '/cart/items', { variantId: product.variantId, quantity: 1 });
    const addr = (await api('alice', 'GET', '/addresses')).body.data[0];
    const placed = await api('alice', 'POST', '/checkout', { addressId: addr.id, paymentMethod: 'RAZORPAY', idempotencyKey: 'e2e-cancel-order-key-0001' });
    t.check('checkout via API returns a Razorpay order', placed.status === 201 || placed.status === 200, `HTTP ${placed.status}`);
    const orderId = placed.body.data.order.id;
    const paid = await stack.razorpaySim('pay', { order_id: placed.body.data.payment.razorpayOrderId, outcome: 'captured' });
    const verified = await api('alice', 'POST', '/payments/verify', { razorpay_order_id: paid.razorpay_order_id, razorpay_payment_id: paid.razorpay_payment_id, razorpay_signature: paid.razorpay_signature });
    t.check('verification marks it paid', verified.body?.data?.status === 'PAID', JSON.stringify(verified.body)?.slice(0, 120));

    await goto(alice, stack, `/account/orders/${orderId}`);
    await clickText(alice, /^Cancel order$/);
    await alice.waitForSelector('[role=dialog] select');
    await clickText(alice, /^Yes, cancel order$/, { selector: '[role=dialog] button' });
    await t.attempt('cancelling announces that a refund has started', async () => {
      await alice.waitForFunction(() => /refund has been started/i.test(document.body.innerText), { timeout: 15_000 });
    });
    await sleep(500);
    const after = (await api('alice', 'GET', `/orders/${orderId}`)).body.data;
    t.check('the order is CANCELLED', after.fulfilmentStatus === 'CANCELLED');
    t.check('a full refund was created', after.refunds.length === 1 && after.refunds[0].amount === after.grandTotal, JSON.stringify(after.refunds));
    await goto(alice, stack, `/account/orders/${orderId}`);
    t.check('the page shows the cancellation and the refund', /Cancelled/.test(await text(alice)) && /Refund/.test(await text(alice)));
  }

  t.section('Cash on delivery');
  {
    // Off by default.
    await api('alice', 'POST', '/cart/items', { variantId: product.variantId, quantity: 1 });
    await goto(alice, stack, '/checkout');
    t.check('COD is not offered while it is switched off', !/Cash on Delivery/.test(await text(alice)));

    const on = await api('admin', 'PUT', '/admin/settings/payments', { codEnabled: true, codMaxOrder: 5_000_000, reservationMinutes: 15 });
    t.check('an admin switches COD on', on.status === 200, `HTTP ${on.status}`);
    await goto(alice, stack, '/checkout');
    await clickText(alice, /Cash on Delivery/, { selector: 'label' });
    await clickText(alice, /^Place order/);
    await alice.waitForFunction(() => /\/account\/orders\/[^/]+$/.test(location.pathname), { timeout: 20_000 });
    await settle(alice);
    const codId = orderIdFrom(alice.url());
    t.check('a COD order is placed without opening Razorpay', /your order is placed/i.test(await text(alice)));
    const cod = (await api('alice', 'GET', `/orders/${codId}`)).body.data;
    t.check('it waits as PLACED with payment due on delivery (an admin confirms it next)', cod.paymentMethod === 'COD' && cod.fulfilmentStatus === 'PLACED' && cod.paymentStatus === 'PENDING', `${cod.paymentMethod}/${cod.fulfilmentStatus}/${cod.paymentStatus}`);
    t.check('the page says "Cash on delivery", not "Paid"', /Cash on delivery/.test(await text(alice, '[data-testid=payment-status]')));
    t.check('only the first timeline step is done; the COD wording is "Order confirmed" for the next', (await alice.$$eval('[data-testid=order-timeline] li[data-state=done]', (l) => l.length)) === 1 && /Order confirmed/.test(await text(alice, '[data-testid=order-timeline]')));
    shared.codOrderId = codId;
  }

  await alice.close();
}
