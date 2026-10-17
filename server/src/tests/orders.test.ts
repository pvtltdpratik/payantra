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
const { sim, simState } = await import('./commerce-helpers.js');
const { makeWorld, IDS } = await import('./commerce-world.js');
const { randomUUID } = await import('node:crypto');

const app = createApp();
const w = makeWorld(app, prisma, { makeCategory, makeProduct });
const { admin } = w;
const alice = w.as('alice');
const bob = w.as('bob');
const carol = w.as('carol');

beforeEach(async () => {
  await resetDb();
  await sim('reset');
  await w.reset();
});

/** A paid online order for alice. */
async function paidOrder(opts: { price?: number; qty?: number; onHand?: number; name?: string } = {}) {
  const a = await w.sellable({ price: opts.price ?? 100_000, onHand: opts.onHand ?? 10, name: opts.name });
  const placed = await w.placeOnline(alice, [{ variantId: a.variantId, quantity: opts.qty ?? 1 }]);
  const { paid } = await w.payAndVerify(alice, placed);
  return { a, placed, paid };
}

async function codOrder(c = alice, opts: { price?: number; qty?: number; onHand?: number } = {}) {
  await admin.put('/admin/settings/payments', { codEnabled: true, codMaxOrder: 5_000_000, reservationMinutes: 15 });
  const a = await w.sellable({ price: opts.price ?? 100_000, onHand: opts.onHand ?? 10 });
  const res = await w.checkout(c, [{ variantId: a.variantId, quantity: opts.qty ?? 1 }], { method: 'COD' });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return { a, order: res.body.data.order as { id: string } };
}

describe('customer order views', () => {
  it('lists only the shopper’s own orders, newest first, with pagination', async () => {
    const a = await w.sellable({ onHand: 20 });
    const o1 = await w.placeOnline(alice, [{ variantId: a.variantId }]);
    const o2 = await w.placeOnline(alice, [{ variantId: a.variantId }]);
    await w.placeOnline(bob, [{ variantId: a.variantId }]);

    const list = await alice.get('/orders');
    expect(list.body.data.map((o: { id: string }) => o.id)).toEqual([o2.order.id, o1.order.id]);
    expect(list.body.meta).toMatchObject({ total: 2 });
    expect((await alice.get('/orders?pageSize=1&page=2')).body.data.map((o: { id: string }) => o.id)).toEqual([o1.order.id]);
    expect((await bob.get('/orders')).body.data).toHaveLength(1);
  });

  it('shows a detailed view with timeline, snapshots and what the shopper may do next', async () => {
    const { placed } = await paidOrder({ qty: 2, name: 'Banarasi' });
    const view = (await alice.get(`/orders/${placed.order.id}`)).body.data;

    expect(view).toMatchObject({ orderNumber: placed.order.orderNumber, paymentStatus: 'CAPTURED', fulfilmentStatus: 'PAYMENT_CONFIRMED' });
    expect(view.items[0]).toMatchObject({ name: 'Banarasi', quantity: 2, unitPrice: 100_000, lineTotal: 200_000 });
    expect(view.address).toMatchObject({ fullName: 'Asha Rao', postalCode: '411001' });
    expect(view.timeline.map((t: { status: string }) => t.status)).toEqual(['PLACED', 'PAYMENT_CONFIRMED']);
    expect(view.actions).toMatchObject({ canCancel: true, canRetryPayment: false, canReturn: false, canViewInvoice: true });
    expect(JSON.stringify(view)).not.toContain('idempotencyKey');
    expect(JSON.stringify(view)).not.toContain('providerPaymentId');
  });

  it('treats another shopper’s order exactly like one that does not exist', async () => {
    const { placed } = await paidOrder();
    for (const r of [
      await bob.get(`/orders/${placed.order.id}`),
      await bob.post(`/orders/${placed.order.id}/cancel`, { reason: 'mine now' }),
      await bob.get(`/orders/${placed.order.id}/invoice`),
      await bob.post(`/orders/${placed.order.id}/reorder`),
      await bob.post(`/orders/${placed.order.id}/returns`, { type: 'RETURN', reason: 'not mine' }),
    ]) {
      expect(r.status).toBe(404);
    }
    expect((await w.orderOf(placed.order.id)).fulfilmentStatus).toBe('PAYMENT_CONFIRMED');
  });

  it('shows the pay-again action only while the reservation is alive', async () => {
    const a = await w.sellable();
    const placed = await w.placeOnline(alice, [{ variantId: a.variantId }]);
    expect((await alice.get(`/orders/${placed.order.id}`)).body.data.actions.canRetryPayment).toBe(true);
    await prisma.order.update({ where: { id: placed.order.id }, data: { stockExpiresAt: new Date(Date.now() - 1000) } });
    expect((await alice.get(`/orders/${placed.order.id}`)).body.data.actions.canRetryPayment).toBe(false);
  });
});

describe('cancelling an order', () => {
  it('cancels an unpaid online order and releases everything it held', async () => {
    const a = await w.sellable({ onHand: 5 });
    const placed = await w.placeOnline(alice, [{ variantId: a.variantId, quantity: 2 }]);
    const res = await alice.post(`/orders/${placed.order.id}/cancel`, { reason: 'Changed my mind' });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ fulfilmentStatus: 'CANCELLED', paymentStatus: 'FAILED', cancelReason: 'Changed my mind' });
    expect(await w.inventoryOf(a.variantId)).toMatchObject({ onHand: 5, reserved: 0 });
    expect((await simState()).refunds).toHaveLength(0); // nothing was paid, nothing to refund
  });

  it('cancels a paid order: stock goes back on the shelf and the full amount is refunded', async () => {
    const { a, placed } = await paidOrder({ qty: 2, price: 150_000, onHand: 10 });
    expect(await w.inventoryOf(a.variantId)).toMatchObject({ onHand: 8 });

    const res = await alice.post(`/orders/${placed.order.id}/cancel`, { reason: 'Ordered by mistake' });
    expect(res.status).toBe(200);

    const o = await w.orderOf(placed.order.id);
    expect(o).toMatchObject({ fulfilmentStatus: 'CANCELLED', paymentStatus: 'REFUNDED' });
    expect(o.payments[0]).toMatchObject({ status: 'REFUNDED', refundedAmount: o.payments[0].amount });
    expect(o.payments[0].refunds[0]).toMatchObject({ source: 'CANCELLATION', status: 'PROCESSED', amount: o.grandTotal });
    expect(await w.inventoryOf(a.variantId)).toMatchObject({ onHand: 10, reserved: 0 }); // restocked
    expect((await simState()).refunds).toHaveLength(1);
    expect((await prisma.notification.findMany({ where: { userId: IDS.alice }, select: { title: true } })).map((n) => n.title)).toEqual(
      expect.arrayContaining([expect.stringContaining('cancelled'), expect.stringContaining('Refund processed')]),
    );
  });

  it('keeps the order cancelled even when the refund could not be confirmed, and lets an admin finish it', async () => {
    const { placed } = await paidOrder();
    await sim('fault', { match: '/refund', method: 'POST', status: 503, count: 1 });
    const res = await alice.post(`/orders/${placed.order.id}/cancel`, { reason: 'Changed my mind' });
    expect(res.status).toBe(200); // the cancellation itself succeeded

    let o = await w.orderOf(placed.order.id);
    expect(o.fulfilmentStatus).toBe('CANCELLED');
    expect(o.payments[0].refunds[0]).toMatchObject({ status: 'PENDING', providerRefundId: null });

    const retried = await admin.post(`/admin/refunds/${o.payments[0].refunds[0].id}/retry`);
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    o = await w.orderOf(placed.order.id);
    expect(o.payments[0].refunds[0].status).toBe('PROCESSED');
    expect(o.paymentStatus).toBe('REFUNDED');
    expect((await simState()).refunds).toHaveLength(1);
  });

  it('cannot cancel once the parcel has shipped, but can until it is packed', async () => {
    const { placed } = await paidOrder();
    for (const status of ['PROCESSING', 'PACKED']) await admin.patch(`/admin/orders/${placed.order.id}/status`, { status });
    expect((await alice.get(`/orders/${placed.order.id}`)).body.data.actions.canCancel).toBe(true);

    await admin.patch(`/admin/orders/${placed.order.id}/status`, { status: 'SHIPPED' });
    const res = await alice.post(`/orders/${placed.order.id}/cancel`, { reason: 'Too late?' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/shipped/i);
    expect((await w.orderOf(placed.order.id)).fulfilmentStatus).toBe('SHIPPED');
  });

  it('cannot cancel twice, and a double-click refunds only once', async () => {
    const { placed } = await paidOrder();
    const results = await Promise.all([1, 2, 3].map(() => alice.post(`/orders/${placed.order.id}/cancel`, { reason: 'Double click' })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    expect((await simState()).refunds).toHaveLength(1);
  });

  it('settles a payment that already went through before cancelling, so no money is lost', async () => {
    const a = await w.sellable({ onHand: 5 });
    const placed = await w.placeOnline(alice, [{ variantId: a.variantId }]);
    const { customerPays } = await import('./commerce-helpers.js');
    await customerPays(placed.payment.razorpayOrderId); // paid in Razorpay; we have not been told

    const res = await alice.post(`/orders/${placed.order.id}/cancel`, { reason: 'Cancel please' });
    expect(res.status).toBe(200);
    const o = await w.orderOf(placed.order.id);
    expect(o).toMatchObject({ fulfilmentStatus: 'CANCELLED', paymentStatus: 'REFUNDED' }); // paid, then refunded — not silently kept
    expect((await simState()).refunds).toHaveLength(1);
    expect(await w.inventoryOf(a.variantId)).toMatchObject({ onHand: 5, reserved: 0 });
  });

  it('refuses to cancel when it cannot tell whether an online payment was made', async () => {
    const a = await w.sellable();
    const placed = await w.placeOnline(alice, [{ variantId: a.variantId }]);
    await sim('fault', { match: '/orders/', status: 503, count: 2 });
    const res = await alice.post(`/orders/${placed.order.id}/cancel`, { reason: 'Cancel' });
    expect(res.status).toBe(503);
    expect((await w.orderOf(placed.order.id)).fulfilmentStatus).toBe('PLACED');
  });

  it('cancels a Cash on Delivery order and restocks it, with no refund involved', async () => {
    const { a, order } = await codOrder(alice, { qty: 2, onHand: 10 });
    expect(await w.inventoryOf(a.variantId)).toMatchObject({ onHand: 8 });
    const res = await alice.post(`/orders/${order.id}/cancel`, { reason: 'No longer needed' });
    expect(res.status).toBe(200);
    expect(await w.orderOf(order.id)).toMatchObject({ fulfilmentStatus: 'CANCELLED', paymentStatus: 'FAILED' });
    expect(await w.inventoryOf(a.variantId)).toMatchObject({ onHand: 10 });
    expect((await simState()).refunds).toHaveLength(0);
  });

  it('lets an admin cancel on behalf of a customer, with an audit entry', async () => {
    const { placed } = await paidOrder();
    expect((await alice.post(`/admin/orders/${placed.order.id}/cancel`, { reason: 'x' })).status).toBe(403);
    const res = await admin.post(`/admin/orders/${placed.order.id}/cancel`, { reason: 'Out of stock at warehouse' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fulfilmentStatus: 'CANCELLED', paymentStatus: 'REFUNDED' });
    expect(await prisma.auditLog.count({ where: { action: 'order.cancel', entityId: placed.order.id } })).toBe(1);
  });
});

describe('admin refunds', () => {
  it('refunds in parts, tracks the balance and refuses to refund more than was paid', async () => {
    const { placed } = await paidOrder({ price: 300_000, onHand: 5 }); // ₹3,000, free shipping → 300_000
    const refund = (amount: number, extra: object = {}) => admin.post(`/admin/orders/${placed.order.id}/refund`, { amount, reason: 'Goodwill', ...extra });

    const first = await refund(100_000);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.data.order).toMatchObject({ paymentStatus: 'PARTIALLY_REFUNDED' });
    expect(first.body.data.order.payment).toMatchObject({ refundedAmount: 100_000 });

    const tooMuch = await refund(250_000);
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.error.details).toEqual({ remaining: 200_000 });

    const rest = await admin.post(`/admin/orders/${placed.order.id}/refund`, { reason: 'Remainder' }); // no amount = everything left
    expect(rest.status).toBe(201);
    expect(rest.body.data.order).toMatchObject({ paymentStatus: 'REFUNDED' });
    expect(rest.body.data.order.payment).toMatchObject({ refundedAmount: 300_000 });
    expect((await refund(1)).status).toBe(422); // nothing left to refund
    expect((await simState()).refunds.map((r) => r.amount)).toEqual([100_000, 200_000]);
  });

  it('never refunds more than was paid, even when two refund requests race', async () => {
    const { placed } = await paidOrder({ price: 300_000 });
    const results = await Promise.all(
      [1, 2, 3, 4].map(() => admin.post(`/admin/orders/${placed.order.id}/refund`, { amount: 300_000, reason: 'Full refund', idempotencyKey: randomUUID() })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 422)).toHaveLength(3);
    expect((await simState()).refunds).toHaveLength(1);
    expect((await w.orderOf(placed.order.id)).payments[0].refundedAmount).toBe(300_000);
  });

  it('treats the same idempotency key as the same refund', async () => {
    const { placed } = await paidOrder({ price: 300_000 });
    const key = randomUUID();
    const a = await admin.post(`/admin/orders/${placed.order.id}/refund`, { amount: 50_000, reason: 'Late delivery', idempotencyKey: key });
    const b = await admin.post(`/admin/orders/${placed.order.id}/refund`, { amount: 50_000, reason: 'Late delivery', idempotencyKey: key });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.body.data.refund.id).toBe(a.body.data.refund.id);
    expect((await simState()).refunds).toHaveLength(1);
    expect((await w.orderOf(placed.order.id)).payments[0].refundedAmount).toBe(50_000);
  });

  it('does not refund twice when Razorpay processed it but the reply timed out', async () => {
    const { placed } = await paidOrder({ price: 300_000 });
    await sim('fault-after', { match: '/refund', method: 'POST', status: 504, count: 1 }); // refund happens, reply is lost

    const first = await admin.post(`/admin/orders/${placed.order.id}/refund`, { amount: 120_000, reason: 'Damaged item' });
    expect(first.status).toBe(502);
    expect(first.body.error.code).toBe('REFUND_PENDING');
    expect((await simState()).refunds).toHaveLength(1); // Razorpay DID refund it

    let o = await w.orderOf(placed.order.id);
    expect(o.payments[0].refunds[0]).toMatchObject({ status: 'PENDING', providerRefundId: null });
    expect(o.payments[0].refundedAmount).toBe(0); // we have not confirmed it yet, so the books say 0…

    // …but the pending refund already counts against what can still be refunded:
    expect((await admin.post(`/admin/orders/${placed.order.id}/refund`, { amount: 200_000, reason: 'Again' })).status).toBe(422);

    // The admin retries: we find Razorpay's refund by our tag and adopt it instead of sending another.
    const retried = await admin.post(`/admin/refunds/${o.payments[0].refunds[0].id}/retry`);
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    expect(retried.body.data.status).toBe('PROCESSED');
    expect((await simState()).refunds).toHaveLength(1); // still exactly one
    o = await w.orderOf(placed.order.id);
    expect(o.payments[0]).toMatchObject({ refundedAmount: 120_000, status: 'PARTIALLY_REFUNDED' });
  });

  it('records a refund that Razorpay rejects as FAILED so the balance is not locked up', async () => {
    const { placed, paid } = await paidOrder({ price: 300_000 });
    // Razorpay thinks it was already refunded outside this system.
    await sim('set-payment', { payment_id: paid.razorpay_payment_id, patch: { amount_refunded: 300_000 } });
    const res = await admin.post(`/admin/orders/${placed.order.id}/refund`, { amount: 100_000, reason: 'Try' });
    expect(res.status).toBe(422);
    const o = await w.orderOf(placed.order.id);
    expect(o.payments[0].refunds[0].status).toBe('FAILED');
    expect(o.payments[0].refundedAmount).toBe(0);
  });

  it('is restricted to admins, and only for captured online payments', async () => {
    const { placed } = await paidOrder();
    expect((await alice.post(`/admin/orders/${placed.order.id}/refund`, { reason: 'please' })).status).toBe(403);
    expect((await admin.post(`/admin/orders/${placed.order.id}/refund`, { amount: 0, reason: 'zero' })).status).toBe(400);
    expect((await admin.post(`/admin/orders/${placed.order.id}/refund`, { reason: 'x' })).status).toBe(400); // reason too short

    const a = await w.sellable();
    const unpaid = await w.placeOnline(bob, [{ variantId: a.variantId }]);
    expect((await admin.post(`/admin/orders/${unpaid.order.id}/refund`, { reason: 'Nothing was paid' })).status).toBe(422);

    const cod = await codOrder(carol);
    const r = await admin.post(`/admin/orders/${cod.order.id}/refund`, { reason: 'Cash order' });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/cash on delivery/i);
  });
});

describe('admin order management', () => {
  it('lists and filters orders across customers', async () => {
    const a = await w.sellable({ onHand: 30 });
    const o1 = await w.placeOnline(alice, [{ variantId: a.variantId }]);
    await w.payAndVerify(alice, o1);
    await w.placeOnline(bob, [{ variantId: a.variantId }]); // unpaid
    await codOrder(carol);

    const all = await admin.get('/admin/orders');
    expect(all.body.meta.total).toBe(3);
    expect((await admin.get('/admin/orders?paymentStatus=CAPTURED')).body.data.map((o: { id: string }) => o.id)).toEqual([o1.order.id]);
    expect((await admin.get('/admin/orders?paymentMethod=COD')).body.meta.total).toBe(1);
    expect((await admin.get('/admin/orders?status=PLACED')).body.meta.total).toBe(2);
    expect((await admin.get('/admin/orders?q=bob@example')).body.data[0].customerEmail).toBe('bob@example.test');
    expect((await admin.get(`/admin/orders?q=${o1.order.orderNumber}`)).body.meta.total).toBe(1);
    expect((await admin.get(`/admin/orders?from=${new Date(Date.now() + 86_400_000).toISOString()}`)).body.meta.total).toBe(0);
    expect((await alice.get('/admin/orders')).status).toBe(403);
  });

  it('shows full detail including the customer and the legal next statuses', async () => {
    const { placed } = await paidOrder();
    const d = (await admin.get(`/admin/orders/${placed.order.id}`)).body.data;
    expect(d.customer).toMatchObject({ email: 'alice@example.test' });
    expect(d.nextStatuses).toEqual(['PROCESSING']);
    expect(d.payment).toMatchObject({ status: 'CAPTURED' });
  });

  it('enforces the fulfilment pipeline: no skipping, no going back', async () => {
    const { placed } = await paidOrder();
    const set = (status: string) => admin.patch(`/admin/orders/${placed.order.id}/status`, { status });

    const skip = await set('SHIPPED');
    expect(skip.status).toBe(409);
    expect(skip.body.error.details.allowed).toEqual(['PROCESSING']);
    expect((await set('PROCESSING')).status).toBe(200);
    expect((await set('PAYMENT_CONFIRMED')).status).toBe(422); // online orders confirm themselves
    expect((await set('PACKED')).status).toBe(200);
    expect((await set('PROCESSING')).status).toBe(409); // cannot go backwards
    expect((await set('CANCELLED')).status).toBe(422); // cancellation has its own action (stock, refund)
    expect((await set('RETURNED')).status).toBe(422);
    expect((await set('BOGUS')).status).toBe(400);
    expect((await alice.patch(`/admin/orders/${placed.order.id}/status`, { status: 'SHIPPED' })).status).toBe(403);
  });

  it('notifies the customer at each step and keeps an audit trail', async () => {
    const { placed } = await paidOrder();
    await admin.patch(`/admin/orders/${placed.order.id}/status`, { status: 'PROCESSING', note: 'Packing today' });
    const titles = (await prisma.notification.findMany({ where: { userId: IDS.alice }, orderBy: { createdAt: 'asc' } })).map((n) => n.title);
    expect(titles.at(-1)).toMatch(/being prepared/);
    expect(await prisma.auditLog.count({ where: { action: 'order.status', entityId: placed.order.id } })).toBe(1);
    const view = (await alice.get(`/orders/${placed.order.id}`)).body.data;
    expect(view.timeline.at(-1)).toMatchObject({ status: 'PROCESSING', note: 'Packing today' });
  });

  it('runs a Cash on Delivery order: confirm manually, and delivery is when the cash is collected', async () => {
    const { order } = await codOrder(alice);
    expect((await w.orderOf(order.id)).paymentStatus).toBe('PENDING');
    await w.deliver(order.id, 'PLACED');
    const o = await w.orderOf(order.id);
    expect(o).toMatchObject({ fulfilmentStatus: 'DELIVERED', paymentStatus: 'CAPTURED' });
    expect(o.paidAt).not.toBeNull();
  });
});

describe('returns', () => {
  async function deliveredOrder(qty = 2) {
    const o = await paidOrder({ price: 100_000, qty, onHand: 10 });
    await w.deliver(o.placed.order.id);
    return o;
  }

  it('takes a return from request through approval to a refund and restock', async () => {
    const { a, placed } = await deliveredOrder(2);
    expect(await w.inventoryOf(a.variantId)).toMatchObject({ onHand: 8 });
    expect((await alice.get(`/orders/${placed.order.id}`)).body.data.actions.canReturn).toBe(true);

    const req = await alice.post(`/orders/${placed.order.id}/returns`, { type: 'RETURN', reason: 'Colour not as shown', details: 'Looks darker' });
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    expect((await w.orderOf(placed.order.id)).fulfilmentStatus).toBe('RETURN_REQUESTED');
    expect((await alice.post(`/orders/${placed.order.id}/returns`, { type: 'RETURN', reason: 'again' })).status).toBe(409); // one open request at a time

    const returnId = req.body.data.id;
    expect((await alice.patch(`/admin/returns/${returnId}`, { action: 'approve' })).status).toBe(403);
    expect((await admin.patch(`/admin/returns/${returnId}`, { action: 'complete' })).status).toBe(409); // must approve first
    expect((await admin.patch(`/admin/returns/${returnId}`, { action: 'approve', adminNote: 'Pickup booked' })).status).toBe(200);

    const done = await admin.patch(`/admin/returns/${returnId}`, { action: 'complete', refundAmount: 100_000, restock: true });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.data).toMatchObject({ status: 'COMPLETED', refundAmount: 100_000 });

    const o = await w.orderOf(placed.order.id);
    expect(o.fulfilmentStatus).toBe('RETURNED');
    expect(o.payments[0]).toMatchObject({ refundedAmount: 100_000, status: 'PARTIALLY_REFUNDED' });
    expect(o.payments[0].refunds[0]).toMatchObject({ source: 'RETURN', status: 'PROCESSED' });
    expect(await w.inventoryOf(a.variantId)).toMatchObject({ onHand: 10 }); // both units back on the shelf
  });

  it('cannot refund more than was paid when completing a return', async () => {
    const { placed } = await deliveredOrder(1);
    const req = await alice.post(`/orders/${placed.order.id}/returns`, { type: 'RETURN', reason: 'Wrong size' });
    await admin.patch(`/admin/returns/${req.body.data.id}`, { action: 'approve' });
    const res = await admin.patch(`/admin/returns/${req.body.data.id}`, { action: 'complete', refundAmount: 99_999_999 });
    expect(res.status).toBe(422);
    expect((await w.orderOf(placed.order.id)).fulfilmentStatus).toBe('RETURN_REQUESTED');
  });

  it('puts the order back to delivered when a return is declined', async () => {
    const { placed } = await deliveredOrder(1);
    const req = await alice.post(`/orders/${placed.order.id}/returns`, { type: 'RETURN', reason: 'Changed mind' });
    expect((await admin.patch(`/admin/returns/${req.body.data.id}`, { action: 'reject' })).status).toBe(400); // a reason is required
    const res = await admin.patch(`/admin/returns/${req.body.data.id}`, { action: 'reject', adminNote: 'Worn item' });
    expect(res.body.data.status).toBe('REJECTED');
    expect((await w.orderOf(placed.order.id)).fulfilmentStatus).toBe('DELIVERED');
    expect((await simState()).refunds).toHaveLength(0);
  });

  it('only accepts returns for delivered orders, inside the return window', async () => {
    const { placed } = await paidOrder();
    expect((await alice.post(`/orders/${placed.order.id}/returns`, { type: 'RETURN', reason: 'Not delivered yet' })).status).toBe(409);

    await w.deliver(placed.order.id);
    await prisma.orderStatusHistory.updateMany({ where: { orderId: placed.order.id, status: 'DELIVERED' }, data: { createdAt: new Date(Date.now() - 8 * 86_400_000) } });
    const late = await alice.post(`/orders/${placed.order.id}/returns`, { type: 'RETURN', reason: 'Too late' });
    expect(late.status).toBe(422);
    expect(late.body.error.message).toMatch(/7-day return window/);
    expect((await alice.get(`/orders/${placed.order.id}`)).body.data.actions.canReturn).toBe(false);
  });

  it('follows the admin-configured window and replacement policy', async () => {
    const { placed } = await deliveredOrder(1);
    await admin.put('/admin/settings/returns', { returnWindowDays: 30, replacementEnabled: false });
    await prisma.orderStatusHistory.updateMany({ where: { orderId: placed.order.id, status: 'DELIVERED' }, data: { createdAt: new Date(Date.now() - 20 * 86_400_000) } });

    expect((await alice.post(`/orders/${placed.order.id}/returns`, { type: 'REPLACEMENT', reason: 'Wrong size' })).status).toBe(422);
    expect((await alice.post(`/orders/${placed.order.id}/returns`, { type: 'RETURN', reason: 'Wrong size' })).status).toBe(201); // 20 days is inside 30
  });

  it('lists requests for admins to work through', async () => {
    const { placed } = await deliveredOrder(1);
    await alice.post(`/orders/${placed.order.id}/returns`, { type: 'RETURN', reason: 'Wrong size' });
    const list = await admin.get('/admin/returns?status=REQUESTED');
    expect(list.body.meta.total).toBe(1);
    expect(list.body.data[0].order).toMatchObject({ orderNumber: placed.order.orderNumber, user: { email: 'alice@example.test' } });
    expect((await alice.get('/admin/returns')).status).toBe(403);
  });
});

describe('invoice and reorder', () => {
  it('builds an invoice whose lines add up exactly to what was paid', async () => {
    await admin.post('/admin/coupons', {
      code: 'SAVE15',
      discountType: 'PERCENTAGE',
      discountValue: 15,
      startsAt: new Date(Date.now() - 1e6).toISOString(),
      endsAt: new Date(Date.now() + 1e9).toISOString(),
    });
    const a = await w.sellable({ price: 249_900, name: 'Saree', taxRate: 5 });
    const b = await w.sellable({ price: 119_900, name: 'Kurta', taxRate: 12 });
    await alice.post('/cart/items', { variantId: a.variantId, quantity: 1 });
    await alice.post('/cart/items', { variantId: b.variantId, quantity: 2 });
    await alice.put('/cart/coupon', { code: 'SAVE15' });
    const placed = await w.placeOnline(alice, []);
    await w.payAndVerify(alice, placed);

    const inv = (await alice.get(`/orders/${placed.order.id}/invoice`)).body.data;
    expect(inv.invoiceNumber).toMatch(/^INV-\d{6}-[A-Z2-9]{6}$/);
    expect(inv.lines).toHaveLength(2);

    const sum = (k: string) => inv.lines.reduce((s: number, l: Record<string, number>) => s + l[k], 0);
    expect(sum('total')).toBe(inv.totals.subtotal - inv.totals.discount);
    expect(sum('taxableValue') + sum('gst')).toBe(sum('total')); // taxable value + GST = amount paid, to the paisa
    expect(inv.totals.grandTotal).toBe(inv.totals.subtotal - inv.totals.discount + inv.totals.shipping);
    expect(inv.totals).toMatchObject({ couponCode: 'SAVE15', discount: Math.round((249_900 + 2 * 119_900) * 0.15) });
    expect(inv.lines.map((l: { gstRate: number }) => l.gstRate).sort((x: number, y: number) => x - y)).toEqual([5, 12]);
  });

  it('is only available once the order is confirmed', async () => {
    const a = await w.sellable();
    const placed = await w.placeOnline(alice, [{ variantId: a.variantId }]);
    expect((await alice.get(`/orders/${placed.order.id}/invoice`)).status).toBe(409);
    await w.payAndVerify(alice, placed);
    expect((await alice.get(`/orders/${placed.order.id}/invoice`)).status).toBe(200);
    await alice.post(`/orders/${placed.order.id}/cancel`, { reason: 'Cancelled' });
    expect((await alice.get(`/orders/${placed.order.id}/invoice`)).status).toBe(409);
  });

  it('puts what is still available back in the cart, and reports what is not', async () => {
    const { a, placed } = await paidOrder({ qty: 2, onHand: 10, name: 'Old favourite' });
    const gone = await w.sellable({ name: 'Discontinued', onHand: 5 });
    const second = await w.placeOnline(alice, [{ variantId: gone.variantId }]);
    await w.payAndVerify(alice, second);
    await prisma.product.update({ where: { id: gone.productId }, data: { status: 'ARCHIVED' } });

    const r1 = await alice.post(`/orders/${placed.order.id}/reorder`);
    expect(r1.body.data).toEqual({ added: ['Old favourite'], skipped: [] });
    expect((await alice.get('/cart')).body.data.items[0]).toMatchObject({ variantId: a.variantId, quantity: 2 });

    const r2 = await alice.post(`/orders/${second.order.id}/reorder`);
    expect(r2.body.data.added).toEqual([]);
    expect(r2.body.data.skipped[0]).toMatchObject({ name: 'Discontinued', reason: expect.stringMatching(/no longer available/i) });
  });
});

describe('notifications', () => {
  it('lists, counts unread, and marks read — for the owner only', async () => {
    await paidOrder();
    const list = await alice.get('/notifications');
    expect(list.body.data.length).toBeGreaterThan(0);
    expect(list.body.meta.unread).toBe(list.body.data.length);
    expect((await bob.get('/notifications')).body.data).toEqual([]);

    const first = list.body.data[0].id;
    expect((await bob.patch(`/notifications/${first}/read`)).body.data.updated).toBe(0); // not bob's to mark
    expect((await alice.patch(`/notifications/${first}/read`)).body.data.updated).toBe(1);
    expect((await alice.get('/notifications')).body.meta.unread).toBe(list.body.data.length - 1);
    expect((await alice.post('/notifications/read-all')).status).toBe(200);
    expect((await alice.get('/notifications')).body.meta.unread).toBe(0);
  });
});
