import { eventually, findStockedProduct, orderStatus, packOrder, placeOrder } from '../lib/flows.mjs';
import { clickText, fill, goto, login, newPage, settle, sleep, text } from '../lib/browser.mjs';

/**
 * The delivery partner journey, end to end, with three people signed in at once:
 * a rider applies → an admin approves and assigns → the rider delivers with the customer's code.
 */
export async function run({ stack, browser, t }) {
  const api = (who, method, path, body) => stack.apiAs(who, method, path, body);
  const product = await findStockedProduct(stack, 6);
  // The failed-delivery section uses a Cash on Delivery order, which an admin has to switch on.
  await api('admin', 'PUT', '/admin/settings/payments', { codEnabled: true, codMaxOrder: 5_000_000, reservationMinutes: 15 });

  const rider = await newPage(browser, stack, { isolated: true });
  const admin = await newPage(browser, stack, { isolated: true });
  const alice = await newPage(browser, stack, { isolated: true });
  await login(rider, stack, 'rider');
  await login(admin, stack, 'admin');
  await login(alice, stack, 'alice');
  const alertText = (page) => page.$$eval('[role=alert]', (e) => e.map((x) => x.textContent.trim()).join(' | '));

  t.section('Delivery partner: applying');
  {
    await goto(rider, stack, '/delivery');
    t.check('a customer sees the invitation to deliver', /Deliver with Payantra/.test(await text(rider)));
    t.check('…and cannot use the partner API yet (403)', (await api('rider', 'GET', '/delivery/assignments')).status === 403);

    await clickText(rider, /^Apply to deliver$/);
    await rider.waitForFunction(() => location.pathname === '/delivery/apply', { timeout: 15_000 });
    await settle(rider);
    await clickText(rider, /^Send application$/);
    await t.attempt('an empty application is rejected inline', async () => {
      await rider.waitForFunction(() => /valid 10-digit|Which city|Choose|Add the verification|Tell us what you ride/i.test(document.body.innerText), { timeout: 5000 });
    });

    await fill(rider, '#fullName', 'Ravi Kumar');
    await fill(rider, '#phone', '9811122233');
    await fill(rider, '#serviceCity', 'Pune');
    await rider.select('#vehicleType', 'Motorcycle');
    await fill(rider, '#vehicleNumber', 'MH12AB1234');
    await rider.select('#idDocumentType', 'Driving licence');
    await fill(rider, '#idDocumentRef', 'DL ending 4321');
    await clickText(rider, /^Send application$/);
    await rider.waitForFunction(() => location.pathname === '/delivery' && /Application received/.test(document.body.innerText), { timeout: 20_000 }).catch(() => undefined);
    t.check('after applying, the dashboard says the application is being reviewed', /Application received/.test(await text(rider)), (await alertText(rider)) || '');
    t.check('applying did not grant any access', (await api('rider', 'GET', '/delivery/stats')).status === 403);
    const me = (await api('rider', 'GET', '/users/me')).body.data;
    t.check('the applicant is still a CUSTOMER', me.role === 'CUSTOMER', me.role);
  }

  t.section('Admin: approving the application');
  {
    await goto(admin, stack, '/admin/delivery-partners?status=PENDING');
    t.check('the application is waiting in the admin list', /Ravi Kumar/.test(await text(admin)) && (await admin.$$eval('[data-testid=partner-row]', (r) => r.length)) === 1);
    await clickText(admin, /^Ravi Kumar$/, { selector: 'a' });
    await admin.waitForFunction(() => /^\/admin\/delivery-partners\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 15_000 });
    await settle(admin);
    const detail = await text(admin);
    t.check('the admin sees the vehicle and verification reference', /Motorcycle/.test(detail) && /DL ending 4321/.test(detail) && /Pune/.test(detail));

    await clickText(admin, /^Approve$/);
    await t.attempt('approving confirms and the status becomes Approved', async () => {
      await admin.waitForFunction(() => /Approved\. They can now go online/.test(document.body.innerText), { timeout: 12_000 });
    });
    const roleNow = (await api('rider', 'GET', '/users/me')).body.data.role;
    t.check('approval (and nothing else) granted the delivery role', roleNow === 'DELIVERY_PARTNER', roleNow);
  }

  let partnerId;
  t.section('Delivery partner: going online');
  {
    await goto(rider, stack, '/delivery');
    t.check('the approved partner now sees their dashboard', /Today/.test(await text(rider, 'h1')) && /Your deliveries/.test(await text(rider)));
    t.check('with the numbers for today', (await rider.$$eval('dl[aria-label="Today\'s numbers"] dt', (e) => e.map((x) => x.textContent))).join() === 'Assigned today,Completed,Pending,Failed');
    t.check('the switch starts offline', (await rider.$eval('[role=switch]', (e) => e.getAttribute('aria-checked'))) === 'false');
    await rider.click('[role=switch]');
    await t.attempt('turning it on makes the partner Online', async () => {
      await rider.waitForFunction(() => document.querySelector('[role=switch]')?.getAttribute('aria-checked') === 'true', { timeout: 8000 });
    });
    partnerId = (await api('admin', 'GET', '/admin/delivery-partners/assignable')).body.data[0]?.id;
    t.check('and the admin can now assign deliveries to them', !!partnerId);
  }

  const order = await placeOrder(stack, 'alice', product);
  await packOrder(stack, order.id);

  t.section('Admin: assigning the delivery');
  {
    await goto(admin, stack, `/admin/orders/${order.id}`);
    t.check('a packed order shows the Delivery panel with an assign control', (await admin.$('[data-testid=delivery-panel] #partner-select')) !== null);
    const optionValue = await admin.evaluate(() => [...document.querySelectorAll('#partner-select option')].find((o) => /Ravi Kumar/.test(o.textContent))?.value);
    await admin.select('#partner-select', optionValue);
    await clickText(admin, /^Assign$/);
    await t.attempt('assigning shows the partner on the order', async () => {
      await admin.waitForFunction(() => /Delivery assigned/.test(document.body.innerText) && document.querySelector('[data-testid=assignment-partner]')?.textContent === 'Ravi Kumar', { timeout: 12_000 });
    });
    const buttons = await admin.$$eval('button', (b) => b.map((x) => x.textContent.trim()));
    t.check('hand-shipping is no longer offered (the partner owns the hand-over)', !buttons.some((b) => /^Mark as (shipped|out for delivery|delivered)$/i.test(b)));
    const refused = await api('admin', 'PATCH', `/admin/orders/${order.id}/status`, { status: 'SHIPPED' });
    t.check('…and the API refuses it too (409)', refused.status === 409, `HTTP ${refused.status}`);
  }

  let jobUrl;
  t.section('Delivery partner: working the job');
  {
    await goto(rider, stack, '/delivery');
    await rider.waitForSelector('[data-testid=delivery-job]');
    const card = await text(rider, '[data-testid=delivery-job]');
    t.check('the job card shows the order number and area', card.includes(order.orderNumber) && /Pune/.test(card));
    t.check('…but not the customer’s name or phone', !/Asha|9876543210/.test(card));

    await rider.click('[data-testid=delivery-job]');
    await rider.waitForFunction(() => /^\/delivery\/orders\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 15_000 });
    await settle(rider);
    jobUrl = rider.url();
    t.check('before accepting, only the area is shown', (await rider.$('[data-testid=delivery-area]')) !== null && !/12 Lotus|Asha Rao|9876543210/.test(await text(rider)));
    t.check('…and there is no call or map button yet', !(await rider.$$eval('a', (a) => a.some((x) => /^tel:|google\.com\/maps/.test(x.getAttribute('href') ?? '')))));

    await clickText(rider, /^Accept delivery$/);
    await t.attempt('accepting reveals the full address', async () => {
      await rider.waitForFunction(() => document.querySelector('[data-testid=delivery-address]')?.textContent.includes('12 Lotus Apartments'), { timeout: 12_000 });
    });
    const links = await rider.$$eval('a', (a) => a.map((x) => x.getAttribute('href') ?? ''));
    t.check('with a call link and a maps link', links.includes('tel:+919876543210') && links.some((h) => h.startsWith('https://www.google.com/maps/search/?api=1&query=') && h.includes('Lotus')));
    t.check('the API now shows the customer’s phone to this partner only', (await api('rider', 'GET', '/delivery/assignments')).body.data[0].customerPhone === '9876543210');

    await clickText(rider, /^I have picked up the parcel$/);
    await eventually(async () => (await orderStatus(stack, order.id)).fulfilmentStatus === 'SHIPPED');
    t.check('picking up moves the order to Shipped', (await orderStatus(stack, order.id)).fulfilmentStatus === 'SHIPPED');
    await rider.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /^Start delivery$/.test(b.textContent.trim())), { timeout: 12_000 });
    await clickText(rider, /^Start delivery$/);
    await eventually(async () => (await orderStatus(stack, order.id)).fulfilmentStatus === 'OUT_FOR_DELIVERY');
    t.check('starting delivery moves the order to Out for delivery', (await orderStatus(stack, order.id)).fulfilmentStatus === 'OUT_FOR_DELIVERY');
    await rider.waitForSelector('#delivery-code');
    t.check('the Confirm button stays disabled until a full 6-digit code is typed', await rider.$eval('form[aria-label="Confirm delivery"] button[type=submit]', (b) => b.disabled));
  }

  let code;
  t.section('Customer: reading out the delivery code');
  {
    await goto(alice, stack, `/account/orders/${order.id}`);
    t.check('the customer sees the delivery card with the partner’s first name', /with Ravi/.test(await text(alice, '[data-testid=delivery-card]')) && !/Kumar/.test(await text(alice, '[data-testid=delivery-card]')));
    code = await alice.$eval('[data-testid=delivery-code]', (e) => e.textContent.trim()).catch(() => '');
    t.check('and a 6-digit code to read out at the door', /^\d{6}$/.test(code), code);
    t.check('with a link to call the partner', (await alice.$$eval('a', (a) => a.some((x) => x.getAttribute('href') === 'tel:+919811122233'))));

    const adminSees = JSON.stringify((await api('admin', 'GET', `/admin/orders/${order.id}`)).body.data);
    t.check('the admin API never reveals the code', !adminSees.includes(code));
    const bobSees = await api('bob', 'GET', `/orders/${order.id}`);
    t.check('another customer cannot open the order (404)', bobSees.status === 404);
  }

  t.section('Delivery partner: delivering with the code');
  {
    const wrong = code === '000000' ? '111111' : '000000';
    await fill(rider, '#delivery-code', wrong);
    await clickText(rider, /^Confirm delivery$/);
    await t.attempt('a wrong code is refused and the attempts left are shown', async () => {
      await rider.waitForFunction(() => /not right\. 4 attempts left/.test(document.body.innerText), { timeout: 10_000 });
    });
    t.check('the order is still out for delivery', (await orderStatus(stack, order.id)).fulfilmentStatus === 'OUT_FOR_DELIVERY');

    await fill(rider, '#delivery-code', code);
    await clickText(rider, /^Confirm delivery$/);
    await t.attempt('the right code completes the delivery', async () => {
      await rider.waitForFunction(() => /Nothing more to do on this delivery/.test(document.body.innerText), { timeout: 15_000 });
    });
    const done = await orderStatus(stack, order.id);
    t.check('the order is Delivered', done.fulfilmentStatus === 'DELIVERED');
    t.check('the delivery is recorded against the partner, with the time', done.assignment.status === 'DELIVERED' && !!done.assignment.deliveredAt);
    t.check('the shopper’s page now shows Delivered', (await goto(alice, stack, `/account/orders/${order.id}`), /Delivered/.test(await text(alice, '[data-testid=delivery-status]'))));
    t.check('and the code is gone', (await alice.$('[data-testid=delivery-code]')) === null);

    await goto(rider, stack, '/delivery');
    const tiles = await rider.$$eval('dl[aria-label="Today\'s numbers"] > div', (d) => Object.fromEntries(d.map((x) => [x.querySelector('dt').textContent, x.querySelector('dd').textContent])));
    t.check('the dashboard counts it as completed today', tiles.Completed === '1' && tiles.Pending === '0', JSON.stringify(tiles));
    t.check('and shows what was earned', /₹40/.test(await text(rider, '[aria-labelledby=earn-h]')));
    await goto(rider, stack, '/delivery/history');
    t.check('the history lists the delivery with its earnings', /Earned ₹40/.test(await text(rider)));
  }

  t.section('Delivery partner: a failed attempt, a retry, and a return to origin');
  {
    const second = await placeOrder(stack, 'alice', product, { cod: true });
    await packOrder(stack, second.id, { cod: true });
    await api('admin', 'POST', `/admin/orders/${second.id}/assignment`, { partnerId });
    const jobs = (await api('rider', 'GET', '/delivery/assignments')).body.data;
    const job = jobs.find((j) => j.order.orderNumber === second.orderNumber);
    await goto(rider, stack, `/delivery/orders/${job.id}`);
    t.check('a Cash on Delivery job tells the rider how much to collect', /Collect ₹[\d,]+ in cash/.test(await text(rider, '[data-testid=collect-cash]')));

    await clickText(rider, /^Accept delivery$/);
    await rider.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /picked up/.test(b.textContent)), { timeout: 12_000 });
    await clickText(rider, /^I have picked up the parcel$/);
    await rider.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /^Start delivery$/.test(b.textContent.trim())), { timeout: 12_000 });
    await clickText(rider, /^Start delivery$/);
    await rider.waitForSelector('#delivery-code');

    await clickText(rider, /^I couldn't deliver$/);
    await rider.waitForSelector('[role=dialog] select');
    await rider.select('[role=dialog] select', 'Customer not available');
    await clickText(rider, /^Report failed delivery$/, { selector: '[role=dialog] button' });
    await t.attempt('reporting a failed attempt shows it on the job', async () => {
      await rider.waitForFunction(() => /Delivery failed/.test(document.body.innerText) && /Try delivering again/.test(document.body.innerText), { timeout: 15_000 });
    });
    const failed = await orderStatus(stack, second.id);
    t.check('the order goes back to Shipped, with the reason on record', failed.fulfilmentStatus === 'SHIPPED' && failed.assignment.failureReason === 'Customer not available');
    const alerts = (await api('admin', 'GET', '/notifications?pageSize=20')).body.data.map((n) => n.title);
    t.check('and the admins were notified', alerts.includes('Failed delivery'));

    await clickText(rider, /^Return to the shop$/);
    await rider.waitForSelector('[role=dialog] input');
    await rider.type('[role=dialog] input', 'Customer refused twice');
    await clickText(rider, /^Return to origin$/, { selector: '[role=dialog] button' });
    await t.attempt('returning to origin closes the delivery', async () => {
      await rider.waitForFunction(() => /Nothing more to do on this delivery/.test(document.body.innerText), { timeout: 15_000 });
    });
    const rto = await orderStatus(stack, second.id);
    t.check('the order is Cancelled with the reason', rto.fulfilmentStatus === 'CANCELLED' && /Returned to origin: Customer refused twice/.test(rto.cancelReason ?? ''), `${rto.fulfilmentStatus} ${rto.cancelReason}`);
    t.check('a COD order has nothing to refund', rto.paymentStatus === 'FAILED' && rto.refunds.length === 0);
    await sleep(200);
  }

  t.section('Privacy between partners');
  {
    const j = (await api('rider', 'GET', '/delivery/assignments?view=history')).body.data[0];
    const other = await newPage(browser, stack, { isolated: true });
    await login(other, stack, 'alice'); // a plain customer opens a partner's job link
    await goto(other, stack, new URL(jobUrl).pathname);
    t.check('a customer opening a partner’s job link gets a not-found page, not the job', !/Deliver to|Next step/.test(await text(other)) && /404|not found|could not be found/i.test(await text(other)), (await text(other)).slice(0, 80));
    t.check('another account cannot read the job through the API', (await api('bob', 'GET', `/delivery/assignments/${j.id}`)).status === 403);
    await other.close();
  }

  await rider.close();
  await admin.close();
  await alice.close();
}
