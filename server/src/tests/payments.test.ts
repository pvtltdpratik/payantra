import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('jose', () => ({
  createRemoteJWKSet: () => ({}),
  jwtVerify: async (token: string) => {
    const ids: Record<string, string> = {
      admin: '00000000-0000-4000-8000-0000000000a1',
      alice: '00000000-0000-4000-8000-0000000000c1',
      bob: '00000000-0000-4000-8000-0000000000c2',
      carol: '00000000-0000-4000-8000-0000000000c3',
    };
    if (!ids[token]) throw new Error('invalid token');
    return { payload: { sub: ids[token], email: `${token}@example.test` } };
  },
}));

const { createApp } = await import('../app.js');
const { prisma } = await import('../config/prisma.js');
const { makeCategory, makeProduct, resetDb } = await import('./helpers.js');
const { sim, simState, customerPays, signedWebhook, paymentEvent, refundEvent } = await import('./commerce-helpers.js');
const { makeWorld, IDS } = await import('./commerce-world.js');
const { expireUnpaidOrders } = await import('../modules/orders/expiry.js');

const app = createApp();
const w = makeWorld(app, prisma, { makeCategory, makeProduct });
const alice = w.as('alice');
const bob = w.as('bob');

beforeEach(async () => {
  await resetDb();
  await sim('reset');
  await w.reset();
});

/** POSTs a webhook the way Razorpay does: raw JSON text, signature header, event-id header. */
const postWebhook = (w: { raw: string; signature: string; eventId: string }, over: { signature?: string | null; eventId?: string | null } = {}) => {
  let r = request(app).post('/api/v1/webhooks/razorpay').set('content-type', 'application/json');
  const sig = over.signature === undefined ? w.signature : over.signature;
  const id = over.eventId === undefined ? w.eventId : over.eventId;
  if (sig !== null) r = r.set('x-razorpay-signature', sig);
  if (id !== null) r = r.set('x-razorpay-event-id', id);
  return r.send(w.raw);
};

const expireNow = (orderId: string) => prisma.order.update({ where: { id: orderId }, data: { stockExpiresAt: new Date(Date.now() - 60_000) } });

describe('verify — the browser reports a payment', () => {
  it('confirms the order, sells the stock, empties the cart and notifies the shopper', async () => {
    const a = await w.sellable({ price: 150_000, onHand: 10 });
    const placed = await w.placeOnline(alice, [{ variantId: a.variantId, quantity: 2 }]);
    const { paid, res } = await w.payAndVerify(alice, placed);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual({ status: 'PAID', orderId: placed.order.id });

    const o = await w.orderOf(placed.order.id);
    expect(o).toMatchObject({ paymentStatus: 'CAPTURED', fulfilmentStatus: 'PAYMENT_CONFIRMED', stockExpiresAt: null });
    expect(o.paidAt).not.toBeNull();
    expect(o.payments[0]).toMatchObject({ status: 'CAPTURED', providerPaymentId: paid.razorpay_payment_id, method: 'upi', amount: placed.order.grandTotal });

    // Reserved units became sold units.
    expect(await w.inventoryOf(a.variantId)).toMatchObject({ onHand: 8, reserved: 0 });
    expect(await prisma.stockMovement.count({ where: { orderId: o.id, type: 'SOLD' } })).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: a.productId } })).soldCount).toBe(2);
    expect((await alice.get('/cart')).body.data.items).toEqual([]);
    expect(await prisma.notification.count({ where: { userId: IDS.alice, title: { contains: 'Payment received' } } })).toBe(1);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: o.id, status: 'PAYMENT_CONFIRMED' } })).toBe(1);
  });

  it('is idempotent: verifying twice sells the stock once', async () => {
    const a = await w.sellable({ onHand: 10 });
    const placed = await w.placeOnline(alice, [{ variantId: a.variantId, quantity: 3 }]);
    const { paid } = await w.payAndVerify(alice, placed);
    const again = await alice.post('/payments/verify', {
      razorpay_order_id: paid.razorpay_order_id,
      razorpay_payment_id: paid.razorpay_payment_id,
      razorpay_signature: paid.razorpay_signature,
    });
    expect(again.status).toBe(200);
    expect(again.body.data.status).toBe('PAID');
    expect(await w.inventoryOf(a.variantId)).toMatchObject({ onHand: 7, reserved: 0 });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: a.productId } })).soldCount).toBe(3);
    expect(await prisma.orderStatusHistory.count({ where: { status: 'PAYMENT_CONFIRMED' } })).toBe(1);
  });

  it('survives simultaneous verifies (the browser and a retry racing)', async () => {
    const a = await w.sellable({ onHand: 10 });
    const placed = await w.placeOnline(alice, [{ variantId: a.variantId, quantity: 2 }]);
    const paid = await customerPays(placed.payment.razorpayOrderId);
    const body = { razorpay_order_id: paid.razorpay_order_id, razorpay_payment_id: paid.razorpay_payment_id, razorpay_signature: paid.razorpay_signature };

    const results = await Promise.all(Array.from({ length: 5 }, () => alice.post('/payments/verify', body)));
    expect(results.every((r) => r.status === 200 && r.body.data.status === 'PAID')).toBe(true);
    expect(await w.inventoryOf(a.variantId)).toMatchObject({ onHand: 8, reserved: 0 });
  });

  it('rejects a forged or mismatched signature and leaves the order unpaid', async () => {
    const a = await w.sellable({ onHand: 10 });
    const placed = await w.placeOnline(alice, [{ variantId: a.variantId }]);
    const paid = await customerPays(placed.payment.razorpayOrderId);
    const good = { razorpay_order_id: paid.razorpay_order_id, razorpay_payment_id: paid.razorpay_payment_id, razorpay_signature: paid.razorpay_signature };

    for (const [label, body] of [
      ['wrong signature', { ...good, razorpay_signature: 'f'.repeat(64) }],
      ['signature of a different payment id', { ...good, razorpay_payment_id: 'pay_someoneelse1234' }],
      ['signature for a different order id', { ...good, razorpay_order_id: 'order_otherorder1234' }],
      ['empty signature', { ...good, razorpay_signature: '' }],
    ] as const) {
      const res = await alice.post('/payments/verify', body);
      expect([400, 404], label).toContain(res.status);
    }
    expect(await w.orderOf(placed.order.id)).toMatchObject({ paymentStatus: 'PENDING', fulfilmentStatus: 'PLACED' });
    expect(await w.inventoryOf(a.variantId)).toMatchObject({ onHand: 10, reserved: 1 });
  });

  it('will not confirm someone else’s payment, even with a perfectly valid signature', async () => {
    const a = await w.sellable({ onHand: 10 });
    const placed = await w.placeOnline(alice, [{ variantId: a.variantId }]);
    const paid = await customerPays(placed.payment.razorpayOrderId);

    const res = await bob.post('/payments/verify', {
      razorpay_order_id: paid.razorpay_order_id,
      razorpay_payment_id: paid.razorpay_payment_id,
      razorpay_signature: paid.razorpay_signature,
    });
    expect(res.status).toBe(404);
    expect(await w.orderOf(placed.order.id)).toMatchObject({ paymentStatus: 'PENDING' });
  });

  it('refuses to settle when the amount paid differs from the amount of the order', async () => {
    const a = await w.sellable({ price: 100_000 });
    const placed = await w.placeOnline(alice, [{ variantId: a.variantId }]);
    const paid = await customerPays(placed.payment.razorpayOrderId);
    await sim('set-payment', { payment_id: paid.razorpay_payment_id, patch: { amount: 100 } }); // ₹1 "payment"

    const res = await alice.post('/payments/verify', {
      razorpay_order_id: paid.razorpay_order_id,
      razorpay_payment_id: paid.razorpay_payment_id,
      razorpay_signature: paid.razorpay_signature,
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PAYMENT_MISMATCH');
    expect(await w.orderOf(placed.order.id)).toMatchObject({ paymentStatus: 'PENDING', fulfilmentStatus: 'PLACED' });
    expect(await w.inventoryOf(a.variantId)).toMatchObject({ onHand: 10, reserved: 1 }); // nothing was sold
  });

  it('still settles on a valid signature when Razorpay itself cannot be reached', async () => {
    const a = await w.sellable({ onHand: 10 });
    const placed = await w.placeOnline(alice, [{ variantId: a.variantId }]);
    const paid = await customerPays(placed.payment.razorpayOrderId);
    await sim('fault', { match: '/payments/', status: 503, count: 3 });

    const res = await alice.post('/payments/verify', {
      razorpay_order_id: paid.razorpay_order_id,
      razorpay_payment_id: paid.razorpay_payment_id,
      razorpay_signature: paid.razorpay_signature,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('PAID');
  });

  it('reports a bank-declined payment as FAILED without cancelling the order', async () => {
    const a = await w.sellable({ onHand: 10 });
    const placed = await w.placeOnline(alice, [{ variantId: a.variantId }]);
    const declined = await customerPays(placed.payment.razorpayOrderId, 'failed', { error: 'Insufficient funds' });

    const res = await alice.post('/payments/verify', {
      razorpay_order_id: declined.razorpay_order_id,
      razorpay_payment_id: declined.razorpay_payment_id,
      razorpay_signature: declined.razorpay_signature,
    });
    expect(res.body.data.status).toBe('FAILED');
    const o = await w.orderOf(placed.order.id);
    expect(o).toMatchObject({ paymentStatus: 'PENDING', fulfilmentStatus: 'PLACED' }); // still retryable
    expect(o.payments[0]).toMatchObject({ status: 'FAILED', failureReason: 'Insufficient funds' });
    expect(await w.inventoryOf(a.variantId)).toMatchObject({ reserved: 1 }); // still held for the retry
  });

  it('captures an authorized-only payment before confirming', async () => {
    const a = await w.sellable({ onHand: 10 });
    const placed = await w.placeOnline(alice, [{ variantId: a.variantId }]);
    const authorized = await customerPays(placed.payment.razorpayOrderId, 'authorized');
    const res = await alice.post('/payments/verify', {
      razorpay_order_id: authorized.razorpay_order_id,
      razorpay_payment_id: authorized.razorpay_payment_id,
      razorpay_signature: authorized.razorpay_signature,
    });
    expect(res.body.data.status).toBe('PAID');
    expect((await simState()).payments[0].status).toBe('captured');
  });
});

describe('webhooks — Razorpay tells us independently', () => {
  async function paidInRazorpay(price = 100_000, qty = 1, onHand = 10) {
    const a = await w.sellable({ price, onHand });
    const placed = await w.placeOnline(alice, [{ variantId: a.variantId, quantity: qty }]);
    const paid = await customerPays(placed.payment.razorpayOrderId);
    return { a, placed, paid };
  }

  it('settles an order from payment.captured even if the browser never came back', async () => {
    const { a, placed, paid } = await paidInRazorpay(100_000, 2);
    const hook = signedWebhook(paymentEvent('payment.captured', paid.payment));

    const res = await postWebhook(hook);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual({ received: true, duplicate: false });
    expect(await w.orderOf(placed.order.id)).toMatchObject({ paymentStatus: 'CAPTURED', fulfilmentStatus: 'PAYMENT_CONFIRMED' });
    expect(await w.inventoryOf(a.variantId)).toMatchObject({ onHand: 8, reserved: 0 });
  });

  it('ignores a redelivered event id and an already-applied payment under a new id', async () => {
    const { a, placed, paid } = await paidInRazorpay(100_000, 3);
    const event = paymentEvent('payment.captured', paid.payment);
    const first = signedWebhook(event);

    expect((await postWebhook(first)).body.data.duplicate).toBe(false);
    const redelivered = await postWebhook(first);
    expect(redelivered.status).toBe(200);
    expect(redelivered.body.data.duplicate).toBe(true);

    // Razorpay may also send order.paid for the same payment under a different event id.
    const second = await postWebhook(signedWebhook({ ...event, event: 'order.paid' }));
    expect(second.status).toBe(200);

    expect(await w.inventoryOf(a.variantId)).toMatchObject({ onHand: 7, reserved: 0 }); // sold exactly once
    expect(await prisma.stockMovement.count({ where: { orderId: placed.order.id, type: 'SOLD' } })).toBe(1);
    expect(await prisma.webhookEvent.count()).toBe(2);
  });

  it('does not double-count when the browser verify and the webhook both arrive, in either order', async () => {
    for (const order of ['verify-first', 'webhook-first'] as const) {
      await resetDb();
      await sim('reset');
      await w.reset();
      const { a, placed, paid } = await paidInRazorpay(100_000, 2);
      const verify = () =>
        alice.post('/payments/verify', { razorpay_order_id: paid.razorpay_order_id, razorpay_payment_id: paid.razorpay_payment_id, razorpay_signature: paid.razorpay_signature });
      const hook = () => postWebhook(signedWebhook(paymentEvent('payment.captured', paid.payment)));

      if (order === 'verify-first') {
        await verify();
        await hook();
      } else {
        await hook();
        await verify();
      }
      expect(await w.inventoryOf(a.variantId), order).toMatchObject({ onHand: 8, reserved: 0 });
      expect((await prisma.product.findUniqueOrThrow({ where: { id: a.productId } })).soldCount, order).toBe(2);
      expect(await prisma.orderStatusHistory.count({ where: { orderId: placed.order.id, status: 'PAYMENT_CONFIRMED' } }), order).toBe(1);
    }
  });

  it('survives the browser verify and the webhook arriving at the same instant', async () => {
    const { a, paid } = await paidInRazorpay(100_000, 2);
    const hook = signedWebhook(paymentEvent('payment.captured', paid.payment));
    const results = await Promise.all([
      alice.post('/payments/verify', { razorpay_order_id: paid.razorpay_order_id, razorpay_payment_id: paid.razorpay_payment_id, razorpay_signature: paid.razorpay_signature }),
      postWebhook(hook),
      postWebhook(signedWebhook(paymentEvent('order.paid', paid.payment))),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await w.inventoryOf(a.variantId)).toMatchObject({ onHand: 8, reserved: 0 });
  });

  it('rejects requests whose signature is missing, wrong, or made with the wrong secret', async () => {
    const { placed, paid } = await paidInRazorpay();
    const event = paymentEvent('payment.captured', paid.payment);
    const good = signedWebhook(event);

    expect((await postWebhook(good, { signature: null })).status).toBe(400);
    expect((await postWebhook(good, { signature: 'a'.repeat(64) })).status).toBe(400);
    expect((await postWebhook(signedWebhook(event, { secret: 'not-the-webhook-secret' }))).status).toBe(400);
    expect((await postWebhook(good, { eventId: null })).status).toBe(400);
    expect(await w.orderOf(placed.order.id)).toMatchObject({ paymentStatus: 'PENDING' });
    expect(await prisma.webhookEvent.count()).toBe(0);
  });

  it('detects a tampered body: the signature covers the exact bytes that were sent', async () => {
    const { placed, paid } = await paidInRazorpay(100_000);
    const hook = signedWebhook(paymentEvent('payment.captured', paid.payment));
    // An attacker changes the amount after the event was signed.
    const tampered = { ...hook, raw: hook.raw.replace(`"amount":${paid.payment.amount}`, '"amount":100') };
    expect(tampered.raw).not.toBe(hook.raw);
    expect((await postWebhook(tampered)).status).toBe(400);
    expect(await w.orderOf(placed.order.id)).toMatchObject({ paymentStatus: 'PENDING' });
  });

  it('verifies the RAW bytes, not a re-serialisation of the parsed JSON', async () => {
    const { placed, paid } = await paidInRazorpay();
    // Pretty-printed JSON: parsing then JSON.stringify() would produce different bytes (and a different HMAC).
    const raw = JSON.stringify(paymentEvent('payment.captured', paid.payment), null, 4);
    const hook = { ...signedWebhook({}), raw };
    const { createHmac } = await import('node:crypto');
    hook.signature = createHmac('sha256', 'dummy_webhook_secret').update(raw).digest('hex');

    expect((await postWebhook(hook)).status).toBe(200);
    expect(await w.orderOf(placed.order.id)).toMatchObject({ paymentStatus: 'CAPTURED' });
  });

  it('acknowledges events about orders it has never heard of, so Razorpay stops retrying', async () => {
    const hook = signedWebhook(paymentEvent('payment.captured', { id: 'pay_x1', order_id: 'order_unknown1', amount: 5000, currency: 'INR', status: 'captured' }));
    expect((await postWebhook(hook)).status).toBe(200);
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { eventId: hook.eventId } })).processedAt).not.toBeNull();
  });

  it('asks Razorpay to retry (5xx) when processing fails transiently, then succeeds on redelivery', async () => {
    const { placed } = await paidInRazorpay();
    const authorized = await customerPays(placed.payment.razorpayOrderId, 'authorized');
    const hook = signedWebhook(paymentEvent('payment.authorized', authorized.payment));

    await sim('fault', { match: '/capture', status: 503, count: 1 }); // capturing fails once
    const first = await postWebhook(hook);
    expect(first.status).toBe(500);
    const row = await prisma.webhookEvent.findUniqueOrThrow({ where: { eventId: hook.eventId } });
    expect(row.processedAt).toBeNull();
    expect(row.error).toBeTruthy();
    expect(await w.orderOf(placed.order.id)).toMatchObject({ paymentStatus: 'PENDING' });

    const retry = await postWebhook(hook); // Razorpay redelivers the same event
    expect(retry.status).toBe(200);
    expect(retry.body.data.duplicate).toBe(false);
    expect(await w.orderOf(placed.order.id)).toMatchObject({ paymentStatus: 'CAPTURED' });
  });

  it('records payment.failed without cancelling, and ignores a stale failure after the order was paid', async () => {
    const a = await w.sellable();
    const placed = await w.placeOnline(alice, [{ variantId: a.variantId }]);
    const failed = await customerPays(placed.payment.razorpayOrderId, 'failed', { error: 'Card declined' });
    expect((await postWebhook(signedWebhook(paymentEvent('payment.failed', failed.payment)))).status).toBe(200);

    let o = await w.orderOf(placed.order.id);
    expect(o).toMatchObject({ paymentStatus: 'PENDING', fulfilmentStatus: 'PLACED' });
    expect(o.payments[0]).toMatchObject({ status: 'FAILED', failureReason: 'Card declined' });
    expect(await prisma.notification.count({ where: { userId: IDS.alice, title: { contains: 'Payment failed' } } })).toBe(1);

    // The shopper retries and succeeds…
    const ok = await customerPays(placed.payment.razorpayOrderId);
    await postWebhook(signedWebhook(paymentEvent('payment.captured', ok.payment)));
    // …and an old, delayed "failed" event for the earlier attempt arrives afterwards.
    await postWebhook(signedWebhook(paymentEvent('payment.failed', failed.payment)));
    o = await w.orderOf(placed.order.id);
    expect(o.payments[0].status).toBe('CAPTURED');
    expect(o.paymentStatus).toBe('CAPTURED');
  });
});

describe('retry — paying again after a failed attempt', () => {
  it('re-opens the same Razorpay order and extends the reservation', async () => {
    const a = await w.sellable({ onHand: 10 });
    const placed = await w.placeOnline(alice, [{ variantId: a.variantId }]);
    const declined = await customerPays(placed.payment.razorpayOrderId, 'failed');
    await alice.post('/payments/verify', { razorpay_order_id: declined.razorpay_order_id, razorpay_payment_id: declined.razorpay_payment_id, razorpay_signature: declined.razorpay_signature });

    await prisma.order.update({ where: { id: placed.order.id }, data: { stockExpiresAt: new Date(Date.now() + 60_000) } }); // 1 minute left
    const retry = await alice.post(`/payments/${placed.order.id}/retry`);
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    expect(retry.body.data.status).toBe('PENDING');
    expect(retry.body.data.payment.razorpayOrderId).toBe(placed.payment.razorpayOrderId); // no second Razorpay order
    expect((await simState()).orders).toHaveLength(1);

    const o = await w.orderOf(placed.order.id);
    expect(o.payments[0].status).toBe('PENDING');
    expect((o.stockExpiresAt!.getTime() - Date.now()) / 60_000).toBeGreaterThan(14);

    const { res } = await w.payAndVerify(alice, placed);
    expect(res.body.data.status).toBe('PAID');
  });

  it('discovers an earlier attempt that actually succeeded, instead of inviting a second payment', async () => {
    const a = await w.sellable({ onHand: 10 });
    const placed = await w.placeOnline(alice, [{ variantId: a.variantId }]);
    await customerPays(placed.payment.razorpayOrderId); // money taken, but the browser/webhook never told us

    const retry = await alice.post(`/payments/${placed.order.id}/retry`);
    expect(retry.body.data).toEqual({ status: 'PAID', payment: null });
    expect(await w.orderOf(placed.order.id)).toMatchObject({ paymentStatus: 'CAPTURED', fulfilmentStatus: 'PAYMENT_CONFIRMED' });
    expect(await w.inventoryOf(a.variantId)).toMatchObject({ onHand: 9, reserved: 0 });
  });

  it('does not offer another payment while it cannot tell whether the last one went through', async () => {
    const a = await w.sellable();
    const placed = await w.placeOnline(alice, [{ variantId: a.variantId }]);
    await sim('fault', { match: '/payments', status: 503, count: 2 });
    const res = await alice.post(`/payments/${placed.order.id}/retry`);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('PAYMENT_STATUS_UNKNOWN');
  });

  it('refuses once the reservation has expired, and for orders that are not yours', async () => {
    const a = await w.sellable();
    const placed = await w.placeOnline(alice, [{ variantId: a.variantId }]);
    expect((await bob.post(`/payments/${placed.order.id}/retry`)).status).toBe(404);
    await expireNow(placed.order.id);
    const res = await alice.post(`/payments/${placed.order.id}/retry`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/expired/i);
  });
});

describe('expiry — abandoned checkouts free their stock', () => {
  it('cancels an unpaid order, releases its reservation and its coupon redemption', async () => {
    await w.admin.post('/admin/coupons', {
      code: 'HOLD',
      discountType: 'FLAT',
      discountValue: 10_000,
      usageLimit: 1,
      startsAt: new Date(Date.now() - 1e6).toISOString(),
      endsAt: new Date(Date.now() + 1e9).toISOString(),
    });
    const a = await w.sellable({ price: 400_000, onHand: 5 });
    await alice.post('/cart/items', { variantId: a.variantId, quantity: 2 });
    await alice.put('/cart/coupon', { code: 'HOLD' });
    const placed = await w.placeOnline(alice, []);
    expect(await w.inventoryOf(a.variantId)).toMatchObject({ reserved: 2 });

    await expireNow(placed.order.id);
    const r = await expireUnpaidOrders();
    expect(r).toEqual({ expired: 1, paid: 0, skipped: 0 });

    const o = await w.orderOf(placed.order.id);
    expect(o).toMatchObject({ fulfilmentStatus: 'CANCELLED', paymentStatus: 'FAILED', stockExpiresAt: null, cancelReason: 'Payment window expired' });
    expect(o.payments[0].status).toBe('FAILED');
    expect(await w.inventoryOf(a.variantId)).toMatchObject({ onHand: 5, reserved: 0 });
    expect((await prisma.coupon.findUniqueOrThrow({ where: { code: 'HOLD' } })).usedCount).toBe(0);
    expect(await prisma.stockMovement.count({ where: { orderId: o.id, type: 'RELEASED' } })).toBe(1);
  });

  it('leaves orders inside their window alone, and does nothing the second time', async () => {
    const a = await w.sellable();
    const fresh = await w.placeOnline(alice, [{ variantId: a.variantId }]);
    const old = await w.placeOnline(bob, [{ variantId: a.variantId }]);
    await expireNow(old.order.id);

    expect(await expireUnpaidOrders()).toEqual({ expired: 1, paid: 0, skipped: 0 });
    expect(await expireUnpaidOrders()).toEqual({ expired: 0, paid: 0, skipped: 0 });
    expect(await w.orderOf(fresh.order.id)).toMatchObject({ fulfilmentStatus: 'PLACED' });
    expect(await w.inventoryOf(a.variantId)).toMatchObject({ reserved: 1 });
  });

  it('settles — instead of cancelling — an order that was paid but never reported', async () => {
    const a = await w.sellable({ onHand: 10 });
    const placed = await w.placeOnline(alice, [{ variantId: a.variantId }]);
    await customerPays(placed.payment.razorpayOrderId); // webhook lost, browser closed
    await expireNow(placed.order.id);

    expect(await expireUnpaidOrders()).toEqual({ expired: 0, paid: 1, skipped: 0 });
    expect(await w.orderOf(placed.order.id)).toMatchObject({ paymentStatus: 'CAPTURED', fulfilmentStatus: 'PAYMENT_CONFIRMED' });
    expect(await w.inventoryOf(a.variantId)).toMatchObject({ onHand: 9, reserved: 0 });
  });

  it('never cancels when it cannot reach Razorpay to check — the customer may have paid', async () => {
    const a = await w.sellable();
    const placed = await w.placeOnline(alice, [{ variantId: a.variantId }]);
    await expireNow(placed.order.id);
    await sim('fault', { match: '/orders/', status: 503, count: 5 });

    expect(await expireUnpaidOrders()).toEqual({ expired: 0, paid: 0, skipped: 1 });
    expect(await w.orderOf(placed.order.id)).toMatchObject({ fulfilmentStatus: 'PLACED', paymentStatus: 'PENDING' });
    expect(await w.inventoryOf(a.variantId)).toMatchObject({ reserved: 1 });

    await sim('reset'); // faults cleared… (also clears mock orders, so re-create state realistically)
  });

  it('does not cancel an order the shopper just retried (re-checks under the lock)', async () => {
    const a = await w.sellable();
    const placed = await w.placeOnline(alice, [{ variantId: a.variantId }]);
    await expireNow(placed.order.id);
    // The shopper extended the window between the sweeper's query and its transaction.
    await prisma.order.update({ where: { id: placed.order.id }, data: { stockExpiresAt: new Date(Date.now() + 600_000) } });
    expect(await expireUnpaidOrders()).toEqual({ expired: 0, paid: 0, skipped: 0 });
    expect(await w.orderOf(placed.order.id)).toMatchObject({ fulfilmentStatus: 'PLACED' });
  });
});

describe('late payments — money arrives after the order expired', () => {
  it('restores the order when the stock is still free', async () => {
    const a = await w.sellable({ onHand: 5 });
    const placed = await w.placeOnline(alice, [{ variantId: a.variantId, quantity: 2 }]);
    const late = await customerPays(placed.payment.razorpayOrderId);
    await expireNow(placed.order.id);
    // Make the sweeper believe the provider has no payment (the money lands just after it ran).
    await sim('set-payment', { payment_id: late.razorpay_payment_id, patch: { status: 'created', captured: false } });
    expect((await expireUnpaidOrders()).expired).toBe(1);
    expect(await w.inventoryOf(a.variantId)).toMatchObject({ onHand: 5, reserved: 0 });

    // …and then the capture is confirmed.
    await sim('set-payment', { payment_id: late.razorpay_payment_id, patch: { status: 'captured', captured: true } });
    const hook = signedWebhook(paymentEvent('payment.captured', { ...late.payment, status: 'captured', captured: true }));
    expect((await postWebhook(hook)).status).toBe(200);

    const o = await w.orderOf(placed.order.id);
    expect(o).toMatchObject({ fulfilmentStatus: 'PAYMENT_CONFIRMED', paymentStatus: 'CAPTURED', cancelledAt: null, cancelReason: null });
    expect(await w.inventoryOf(a.variantId)).toMatchObject({ onHand: 3, reserved: 0 });
    expect((await prisma.stockMovement.findMany({ where: { orderId: o.id, type: 'SOLD' } }))[0].note).toMatch(/late payment/i);
  });

  it('refunds automatically when the stock has meanwhile been sold to someone else', async () => {
    const a = await w.sellable({ onHand: 1, price: 100_000 });
    const placed = await w.placeOnline(alice, [{ variantId: a.variantId }]);
    const late = await customerPays(placed.payment.razorpayOrderId);
    await sim('set-payment', { payment_id: late.razorpay_payment_id, patch: { status: 'created', captured: false } });
    await expireNow(placed.order.id);
    await expireUnpaidOrders();

    // Bob buys the last unit while Alice's money is in flight.
    const bobOrder = await w.placeOnline(bob, [{ variantId: a.variantId }]);
    await w.payAndVerify(bob, bobOrder);
    expect(await w.inventoryOf(a.variantId)).toMatchObject({ onHand: 0, reserved: 0 });

    await sim('set-payment', { payment_id: late.razorpay_payment_id, patch: { status: 'captured', captured: true } });
    const hook = signedWebhook(paymentEvent('payment.captured', { ...late.payment, status: 'captured', captured: true }));
    expect((await postWebhook(hook)).status).toBe(200);

    const o = await w.orderOf(placed.order.id);
    expect(o.fulfilmentStatus).toBe('CANCELLED'); // the order is NOT revived — there is nothing to ship
    expect(o.paymentStatus).toBe('REFUNDED'); // …and the money went straight back
    expect(o.payments[0]).toMatchObject({ status: 'REFUNDED', refundedAmount: o.payments[0].amount });
    expect(o.payments[0].refunds).toHaveLength(1);
    expect(o.payments[0].refunds[0]).toMatchObject({ source: 'LATE_CAPTURE', status: 'PROCESSED' });
    expect((await simState()).refunds).toHaveLength(1);
    expect(await w.inventoryOf(a.variantId)).toMatchObject({ onHand: 0, reserved: 0 }); // Bob's unit is untouched
  });
});

describe('webhook refund events', () => {
  async function paidOrder(qty = 1) {
    const a = await w.sellable({ price: 100_000, onHand: 10 });
    const placed = await w.placeOnline(alice, [{ variantId: a.variantId, quantity: qty }]);
    const { paid } = await w.payAndVerify(alice, placed);
    return { a, placed, paid };
  }

  it('applies refund.processed once, however many times it is delivered', async () => {
    const { placed, paid } = await paidOrder();
    const refund = (await w.admin.post(`/admin/orders/${placed.order.id}/refund`, { amount: 30_000, reason: 'Goodwill credit' })).body.data.refund;
    const state = await simState();
    const providerRefund = state.refunds[0];
    expect(refund.status).toBe('PROCESSED');

    const evt = refundEvent('refund.processed', { id: providerRefund.id, payment_id: paid.razorpay_payment_id, amount: 30_000, status: 'processed' });
    for (let i = 0; i < 3; i++) expect((await postWebhook(signedWebhook(evt))).status).toBe(200);

    const o = await w.orderOf(placed.order.id);
    expect(o.payments[0].refundedAmount).toBe(30_000); // not 120_000
    expect(o.payments[0].refunds).toHaveLength(1);
    expect(o.paymentStatus).toBe('PARTIALLY_REFUNDED');
  });

  it('records a refund issued from the Razorpay dashboard so the ledger matches reality', async () => {
    const { placed, paid } = await paidOrder();
    const evt = refundEvent('refund.processed', { id: 'rfnd_dashboard1', payment_id: paid.razorpay_payment_id, amount: 20_000, status: 'processed' });
    expect((await postWebhook(signedWebhook(evt))).status).toBe(200);

    const o = await w.orderOf(placed.order.id);
    expect(o.payments[0]).toMatchObject({ refundedAmount: 20_000, status: 'PARTIALLY_REFUNDED' });
    expect(o.payments[0].refunds[0]).toMatchObject({ source: 'DASHBOARD', status: 'PROCESSED', providerRefundId: 'rfnd_dashboard1' });
  });

  it('marks a refund FAILED when Razorpay says so, without touching the money totals', async () => {
    const { placed, paid } = await paidOrder();
    await prisma.refund.create({ data: { paymentId: (await w.orderOf(placed.order.id)).payments[0].id, amount: 10_000, providerRefundId: 'rfnd_willfail1', source: 'ADMIN' } });
    const evt = refundEvent('refund.failed', { id: 'rfnd_willfail1', payment_id: paid.razorpay_payment_id, amount: 10_000, status: 'failed' });
    expect((await postWebhook(signedWebhook(evt))).status).toBe(200);
    const o = await w.orderOf(placed.order.id);
    expect(o.payments[0].refunds[0].status).toBe('FAILED');
    expect(o.payments[0].refundedAmount).toBe(0);
  });
});
