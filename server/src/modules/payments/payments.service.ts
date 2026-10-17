import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { prisma, Prisma } from '../../config/prisma.js';
import { AppError } from '../../lib/errors.js';
import { notify } from '../../lib/notify.js';
import { claimCouponUse } from '../coupons/coupons.service.js';
import { checkoutParams } from '../checkout/checkout.service.js';
import { lockOrder, recordStatus, stockLinesOf, type LockedOrder } from '../orders/order-lifecycle.js';
import { commitReservation, sellFreeStock } from '../orders/stock.js';
import { getSettings } from '../settings/settings.service.js';
import { getGateway, GatewayError, type GatewayPayment } from './gateway.js';

// ───────────────────────── Signatures ─────────────────────────

function safeEqual(a: string, b: string): boolean {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  // timingSafeEqual throws on unequal lengths, and the comparison must not leak how many bytes matched.
  return A.length === B.length && timingSafeEqual(A, B);
}

const hmac = (secret: string, data: string | Buffer) => createHmac('sha256', secret).update(data).digest('hex');

/** The signature Razorpay Checkout returns to the browser: HMAC-SHA256(order_id|payment_id, key secret). */
export function checkoutSignature(razorpayOrderId: string, razorpayPaymentId: string): string {
  return hmac(env.RAZORPAY_KEY_SECRET, `${razorpayOrderId}|${razorpayPaymentId}`);
}

export function verifyCheckoutSignature(razorpayOrderId: string, razorpayPaymentId: string, signature: string): boolean {
  return safeEqual(checkoutSignature(razorpayOrderId, razorpayPaymentId), signature);
}

/** Webhook signature: HMAC-SHA256 of the RAW request bytes with the webhook secret. */
export function verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
  return safeEqual(hmac(env.RAZORPAY_WEBHOOK_SECRET, rawBody), signature);
}

/** A condition that will never fix itself on retry (e.g. the amount paid differs from the order). */
export class PermanentPaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentPaymentError';
  }
}

// ───────────────────────── Settling a captured payment ─────────────────────────

export interface CapturedPayment {
  providerOrderId: string;
  providerPaymentId: string;
  amount: number;
  currency: string;
  method?: string | null;
}

export type SettleOutcome =
  | 'PAID' // normal: payment confirmed, stock sold
  | 'ALREADY_PAID' // a repeat of something already applied (webhook after verify, duplicate delivery)
  | 'REVIVED' // paid after the reservation expired; stock was still free so the order was restored
  | 'REFUND_QUEUED' // paid after expiry and the stock is gone; the money is being returned
  | 'DUPLICATE_REFUNDED'; // a second successful payment against the same order

/**
 * The ONE place an online payment becomes "paid". Called by the browser's verify step, by Razorpay
 * webhooks and by the reconciliation sweeper, in any order and any number of times: it locks the
 * order row, checks the amount, and is a no-op if the payment was already applied.
 */
export async function settleCapturedPayment(p: CapturedPayment): Promise<SettleOutcome | null> {
  const payment = await prisma.payment.findUnique({ where: { providerOrderId: p.providerOrderId } });
  if (!payment) return null;

  const result = await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, payment.orderId);
    const pay = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });

    // Never trust an amount we did not compute: it must equal what we asked Razorpay to collect.
    if (p.amount !== pay.amount || p.currency !== pay.currency || pay.amount !== order.grandTotal) {
      logger.error({ orderId: order.id, expected: order.grandTotal, got: p.amount, currency: p.currency }, 'Payment amount mismatch — not settling');
      throw new PermanentPaymentError(`Amount mismatch for order ${order.orderNumber}`);
    }

    if (['CAPTURED', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(pay.status)) {
      return pay.providerPaymentId === p.providerPaymentId
        ? ({ outcome: 'ALREADY_PAID' } as const)
        : ({ outcome: 'DUPLICATE_REFUNDED', duplicatePaymentId: p.providerPaymentId } as const);
    }

    const lines = stockLinesOf(order);
    const expired = order.fulfilmentStatus === 'CANCELLED';

    if (expired) {
      // The reservation was released, so the stock may have been sold to someone else meanwhile.
      const available = await allFree(tx, lines);
      if (!available) {
        await tx.payment.update({
          where: { id: pay.id },
          data: { status: 'CAPTURED', providerPaymentId: p.providerPaymentId, method: p.method ?? null, capturedAt: new Date(), failureReason: null },
        });
        const refund = await tx.refund.create({
          data: {
            paymentId: pay.id,
            amount: pay.amount,
            reason: 'Payment received after the order expired and the items were no longer available',
            source: 'LATE_CAPTURE',
            idempotencyKey: `late:${pay.id}`,
          },
        });
        await notify(tx, order.userId, `Order ${order.orderNumber} could not be completed`, 'Your payment arrived after the items sold out. A full refund is on its way.', `/account/orders/${order.id}`);
        return { outcome: 'REFUND_QUEUED', refundId: refund.id } as const;
      }
      await sellFreeStock(tx, order.id, lines);
      if (order.couponId) await claimCouponUse(tx, order.couponId).catch(() => undefined); // best effort: the code may be exhausted now
    } else {
      await commitReservation(tx, order.id, lines);
    }

    await tx.payment.update({
      where: { id: pay.id },
      data: { status: 'CAPTURED', providerPaymentId: p.providerPaymentId, method: p.method ?? null, capturedAt: new Date(), failureReason: null },
    });
    await tx.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: 'CAPTURED',
        fulfilmentStatus: 'PAYMENT_CONFIRMED',
        paidAt: new Date(),
        stockExpiresAt: null,
        cancelledAt: null,
        cancelReason: null,
      },
    });
    await recordStatus(tx, order.id, 'PAYMENT_CONFIRMED', expired ? 'Payment received after the reservation expired; order restored' : 'Payment confirmed');

    // Popularity counters and the shopper's cart.
    const perProduct = new Map<string, number>();
    for (const i of order.items) perProduct.set(i.productId, (perProduct.get(i.productId) ?? 0) + i.quantity);
    for (const [productId, qty] of perProduct) {
      await tx.product.updateMany({ where: { id: productId }, data: { soldCount: { increment: qty } } });
    }
    await clearPurchasedFromCart(tx, order);

    await notify(tx, order.userId, `Payment received for ${order.orderNumber}`, 'Thank you! We are getting your order ready.', `/account/orders/${order.id}`);
    return { outcome: expired ? ('REVIVED' as const) : ('PAID' as const) };
  });

  if (result.outcome === 'REFUND_QUEUED') {
    await executeRefund(result.refundId).catch((err) => logger.error({ err, refundId: result.refundId }, 'Automatic refund will be retried'));
  }
  if (result.outcome === 'DUPLICATE_REFUNDED') {
    // A second charge for an order that is already paid: send it straight back.
    await getGateway()
      .refundPayment(result.duplicatePaymentId, { amount: p.amount, notes: { reason: 'duplicate payment', orderId: payment.orderId } })
      .catch((err) => logger.error({ err, paymentId: result.duplicatePaymentId }, 'DUPLICATE CHARGE needs a manual refund'));
  }
  return result.outcome;
}

/** True when every line has enough FREE stock; locks those inventory rows until the transaction ends. */
async function allFree(tx: Prisma.TransactionClient, lines: { variantId: string; quantity: number }[]): Promise<boolean> {
  if (lines.length === 0) return true;
  const ids = lines.map((l) => Prisma.sql`${l.variantId}::uuid`);
  const rows = await tx.$queryRaw<{ variantId: string; onHand: number; reserved: number }[]>`
    SELECT "variantId", "onHand", "reserved" FROM "Inventory"
    WHERE "variantId" IN (${Prisma.join(ids)}) ORDER BY "variantId" FOR UPDATE`;
  const byId = new Map(rows.map((r) => [r.variantId, r]));
  return lines.every((l) => {
    const r = byId.get(l.variantId);
    return !!r && r.onHand - r.reserved >= l.quantity;
  });
}

async function clearPurchasedFromCart(tx: Prisma.TransactionClient, order: LockedOrder) {
  const variantIds = order.items.map((i) => i.variantId).filter((v): v is string => !!v);
  await tx.cartItem.deleteMany({ where: { variantId: { in: variantIds }, cart: { userId: order.userId } } });
  const left = await tx.cartItem.count({ where: { cart: { userId: order.userId } } });
  if (left === 0) await tx.cart.updateMany({ where: { userId: order.userId }, data: { couponCode: null } });
}

// ───────────────────────── Failures ─────────────────────────

/** A failed attempt does not cancel the order: the shopper may retry until the reservation expires. */
export async function recordPaymentFailure(providerOrderId: string, reason: string): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { providerOrderId }, include: { order: true } });
  if (!payment) return;
  await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, payment.orderId);
    const pay = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    if (pay.status !== 'PENDING' && pay.status !== 'FAILED') return; // already captured/refunded — a late failure event is stale
    if (order.fulfilmentStatus !== 'PLACED') return;
    await tx.payment.update({ where: { id: pay.id }, data: { status: 'FAILED', failureReason: reason.slice(0, 300) } });
    await notify(tx, order.userId, `Payment failed for ${order.orderNumber}`, 'Your payment did not go through. You can try again from your order page.', `/account/orders/${order.id}`);
  });
}

// ───────────────────────── Reconciliation ─────────────────────────

export type ReconcileResult = 'PAID' | 'NOT_PAID' | 'UNKNOWN';

/**
 * Asks Razorpay what actually happened to an order's payment attempts, and settles if money was taken.
 * UNKNOWN means we could not find out — callers must then NOT cancel or charge again.
 */
export async function reconcileOrder(orderId: string): Promise<ReconcileResult> {
  const payment = await prisma.payment.findFirst({ where: { orderId }, orderBy: { createdAt: 'desc' } });
  if (!payment) return 'NOT_PAID';

  let attempts: GatewayPayment[];
  try {
    attempts = await getGateway().fetchOrderPayments(payment.providerOrderId);
  } catch (err) {
    logger.warn({ err, orderId }, 'Could not reconcile with the payment provider');
    return 'UNKNOWN';
  }

  let paid = attempts.find((a) => a.status === 'captured' || a.status === 'refunded');
  if (!paid) {
    const authorized = attempts.find((a) => a.status === 'authorized');
    if (authorized) {
      try {
        paid = await getGateway().capturePayment(authorized.id, authorized.amount);
      } catch (err) {
        logger.warn({ err, orderId }, 'Could not capture an authorized payment');
        return 'UNKNOWN';
      }
    }
  }
  if (!paid) return 'NOT_PAID';

  await settleCapturedPayment({
    providerOrderId: payment.providerOrderId,
    providerPaymentId: paid.id,
    amount: paid.amount,
    currency: paid.currency,
    method: paid.method,
  });
  return 'PAID';
}

// ───────────────────────── Customer: verify and retry ─────────────────────────

export interface VerifyInput {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export async function verifyPayment(userId: string, input: VerifyInput) {
  const payment = await prisma.payment.findUnique({ where: { providerOrderId: input.razorpay_order_id }, include: { order: true } });
  // Someone else's payment looks exactly like a payment that doesn't exist.
  if (!payment || payment.order.userId !== userId) throw AppError.notFound('Payment not found');

  if (!verifyCheckoutSignature(input.razorpay_order_id, input.razorpay_payment_id, input.razorpay_signature)) {
    logger.warn({ orderId: payment.orderId, userId }, 'Payment signature verification failed');
    throw AppError.badRequest('Payment verification failed');
  }

  // The signature proves Razorpay issued this payment id for this order. Ask Razorpay for its
  // current state too (amount, authorized-vs-captured); if it is unreachable the signature suffices
  // and the webhook / sweeper will confirm.
  let remote: GatewayPayment | null = null;
  try {
    remote = await getGateway().fetchPayment(input.razorpay_payment_id);
  } catch (err) {
    if (!(err instanceof GatewayError) || !err.transient) throw AppError.badRequest('Payment verification failed');
    logger.warn({ err }, 'Provider unreachable during verify; relying on the signature');
  }

  if (remote) {
    if (remote.order_id !== input.razorpay_order_id) {
      logger.warn({ orderId: payment.orderId, userId }, 'Payment belongs to a different Razorpay order');
      throw AppError.badRequest('Payment verification failed');
    }
    if (remote.status === 'authorized') remote = await getGateway().capturePayment(remote.id, payment.amount);
    if (remote.status === 'failed') {
      await recordPaymentFailure(input.razorpay_order_id, remote.error_description ?? 'Payment failed');
      return { status: 'FAILED' as const, orderId: payment.orderId };
    }
    if (remote.status !== 'captured' && remote.status !== 'refunded') return { status: 'PENDING' as const, orderId: payment.orderId };
  }

  try {
    await settleCapturedPayment({
      providerOrderId: input.razorpay_order_id,
      providerPaymentId: input.razorpay_payment_id,
      amount: remote?.amount ?? payment.amount,
      currency: remote?.currency ?? payment.currency,
      method: remote?.method,
    });
  } catch (err) {
    if (err instanceof PermanentPaymentError) {
      throw new AppError(422, 'PAYMENT_MISMATCH', 'We could not match this payment to your order. Please contact support — your order has not been confirmed.');
    }
    throw err;
  }
  return { status: 'PAID' as const, orderId: payment.orderId };
}

/**
 * Lets a shopper try again after a failed or abandoned payment, reusing the same Razorpay order.
 * First asks Razorpay whether an earlier attempt actually succeeded, so nobody is charged twice.
 */
export async function retryPayment(userId: string, email: string, orderId: string) {
  const order = await prisma.order.findFirst({ where: { id: orderId, userId } });
  if (!order) throw AppError.notFound('Order not found');
  if (order.paymentMethod !== 'RAZORPAY') throw AppError.unprocessable('This order is not paid online');
  if (order.paymentStatus === 'CAPTURED') return { status: 'PAID' as const, payment: null };
  if (order.fulfilmentStatus !== 'PLACED') throw AppError.conflict('This order can no longer be paid');
  if (order.stockExpiresAt && order.stockExpiresAt <= new Date()) {
    throw AppError.conflict('Your reservation expired. Please review your cart and check out again.');
  }

  const recon = await reconcileOrder(orderId);
  if (recon === 'PAID') return { status: 'PAID' as const, payment: null };
  if (recon === 'UNKNOWN') {
    // We cannot rule out that money was already taken, so do not invite a second payment.
    throw new AppError(503, 'PAYMENT_STATUS_UNKNOWN', 'We are confirming your earlier payment attempt. Please check again in a minute.');
  }

  const { payments } = await getSettings();
  const payment = await prisma.$transaction(async (tx) => {
    const locked = await lockOrder(tx, orderId);
    if (locked.paymentStatus !== 'PENDING' || locked.fulfilmentStatus !== 'PLACED') throw AppError.conflict('This order can no longer be paid');
    const latest = locked.payments.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (!latest) throw AppError.conflict('This order has no payment to retry');
    await tx.payment.update({ where: { id: latest.id }, data: { status: 'PENDING', failureReason: null } });
    // Give the shopper a fresh window to complete this attempt.
    await tx.order.update({ where: { id: orderId }, data: { stockExpiresAt: new Date(Date.now() + payments.reservationMinutes * 60_000) } });
    return latest;
  });
  return { status: 'PENDING' as const, payment: checkoutParams(order, payment, email) };
}

// ───────────────────────── Refunds ─────────────────────────

export interface RefundRequest {
  paymentId: string;
  /** Paise. */
  amount: number;
  reason: string;
  source: 'ADMIN' | 'CANCELLATION' | 'RETURN' | 'LATE_CAPTURE';
  actorId?: string | null;
  /** Same key → same refund. Prevents a double-click or retry from refunding twice. */
  idempotencyKey?: string;
}

/**
 * Records a refund as PENDING (after checking the amount is actually refundable), then sends it to
 * Razorpay. The check and the insert happen under a row lock on the payment, so two simultaneous
 * requests cannot together refund more than was paid.
 */
export async function requestRefund(r: RefundRequest) {
  const refund = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Payment" WHERE "id" = ${r.paymentId}::uuid FOR UPDATE`;
    const pay = await tx.payment.findUnique({ where: { id: r.paymentId }, include: { refunds: true } });
    if (!pay) throw AppError.notFound('Payment not found');

    if (r.idempotencyKey) {
      const dup = pay.refunds.find((x) => x.idempotencyKey === r.idempotencyKey);
      if (dup) return dup;
    }
    if (!['CAPTURED', 'PARTIALLY_REFUNDED'].includes(pay.status)) {
      throw AppError.unprocessable('Only a captured payment can be refunded');
    }
    // Pending refunds count against the remaining balance, or two clicks could both pass the check.
    const committed = pay.refunds.filter((x) => x.status !== 'FAILED').reduce((sum, x) => sum + x.amount, 0);
    const remaining = pay.amount - committed;
    if (r.amount < 1) throw AppError.unprocessable('Refund amount must be at least ₹0.01');
    if (r.amount > remaining) {
      throw AppError.unprocessable(`Only ₹${(remaining / 100).toFixed(2)} of this payment is still refundable`, { remaining });
    }
    return tx.refund.create({
      data: {
        paymentId: pay.id,
        amount: r.amount,
        reason: r.reason,
        source: r.source,
        createdById: r.actorId ?? null,
        idempotencyKey: r.idempotencyKey ?? null,
      },
    });
  });

  return refund.status === 'PENDING' && !refund.providerRefundId ? executeRefund(refund.id) : refund;
}

/**
 * Sends a PENDING refund to Razorpay. Safe to call repeatedly: before (re)sending it asks Razorpay
 * whether a refund tagged with our id already exists, so an earlier timeout whose request actually
 * succeeded is adopted rather than repeated.
 */
export async function executeRefund(refundId: string) {
  const refund = await prisma.refund.findUniqueOrThrow({ where: { id: refundId }, include: { payment: true } });
  if (refund.status !== 'PENDING' || refund.providerRefundId) return refund;
  if (!refund.payment.providerPaymentId) throw AppError.unprocessable('The payment has no provider id to refund');

  const gw = getGateway();
  try {
    const existing = (await gw.listPaymentRefunds(refund.payment.providerPaymentId)).find(
      (x) => !Array.isArray(x.notes) && (x.notes as Record<string, string> | null | undefined)?.refundId === refund.id,
    );
    const sent =
      existing ??
      (await gw.refundPayment(refund.payment.providerPaymentId, {
        amount: refund.amount,
        notes: { refundId: refund.id, ...(refund.reason ? { reason: refund.reason.slice(0, 200) } : {}) },
      }));

    await prisma.refund.update({ where: { id: refund.id }, data: { providerRefundId: sent.id } });
    if (sent.status === 'processed') {
      await applyRefundResult({ providerRefundId: sent.id, providerPaymentId: refund.payment.providerPaymentId, amount: sent.amount, status: 'PROCESSED' });
    }
  } catch (err) {
    if (err instanceof GatewayError && !err.transient) {
      // Razorpay rejected it outright (e.g. "amount greater than captured"): it will never succeed.
      await prisma.refund.update({ where: { id: refund.id }, data: { status: 'FAILED', reason: `${refund.reason ?? ''} [provider: ${err.message}]`.trim().slice(0, 300) } });
      throw AppError.unprocessable(`The payment provider rejected the refund: ${err.message}`);
    }
    // Transient: leave it PENDING (and counted against the balance) so a retry can pick it up.
    logger.error({ err, refundId }, 'Refund could not be confirmed with the provider yet');
    throw new AppError(502, 'REFUND_PENDING', 'The refund is recorded and will complete shortly. If it does not, retry it from the order page.');
  }
  return prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
}

export interface RefundResult {
  providerRefundId: string;
  providerPaymentId: string;
  amount: number;
  status: 'PROCESSED' | 'FAILED';
}

/**
 * Applies a refund outcome from Razorpay (immediate response or webhook). Idempotent: the money
 * totals only move on the first transition into PROCESSED.
 */
export async function applyRefundResult(r: RefundResult): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { providerPaymentId: r.providerPaymentId } });
    if (!payment) return; // a refund for a payment this system never recorded
    await tx.$queryRaw`SELECT 1 FROM "Payment" WHERE "id" = ${payment.id}::uuid FOR UPDATE`;

    // Match by provider id; else adopt our PENDING refund that this webhook beat the HTTP reply to.
    let refund = await tx.refund.findUnique({ where: { providerRefundId: r.providerRefundId } });
    refund ??= await tx.refund.findFirst({
      where: { paymentId: payment.id, status: 'PENDING', providerRefundId: null, amount: r.amount },
      orderBy: { createdAt: 'asc' },
    });
    // A refund issued from the Razorpay dashboard: record it so our ledger matches reality.
    refund ??= await tx.refund.create({
      data: { paymentId: payment.id, amount: r.amount, status: 'PENDING', source: 'DASHBOARD', reason: 'Issued from the payment provider dashboard', providerRefundId: r.providerRefundId },
    });

    if (refund.status === 'PROCESSED') return; // duplicate delivery
    if (r.status === 'FAILED') {
      await tx.refund.update({ where: { id: refund.id }, data: { status: 'FAILED', providerRefundId: r.providerRefundId } });
      return;
    }

    await tx.refund.update({ where: { id: refund.id }, data: { status: 'PROCESSED', providerRefundId: r.providerRefundId, processedAt: new Date() } });

    const refunded = payment.refundedAmount + r.amount;
    if (refunded > payment.amount) {
      logger.error({ paymentId: payment.id, refunded, amount: payment.amount }, 'Refunds exceed the payment — clamping');
    }
    const refundedAmount = Math.min(refunded, payment.amount);
    const status = refundedAmount === payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    await tx.payment.update({ where: { id: payment.id }, data: { refundedAmount, status } });
    const order = await tx.order.update({ where: { id: payment.orderId }, data: { paymentStatus: status } });
    await notify(tx, order.userId, `Refund processed for ${order.orderNumber}`, `₹${(r.amount / 100).toFixed(2)} will reach your original payment method in 5–7 working days.`, `/account/orders/${order.id}`);
  });
}

// ───────────────────────── Webhooks ─────────────────────────

interface WebhookEvent {
  event: string;
  payload?: {
    payment?: { entity: GatewayPayment };
    order?: { entity: { id: string } };
    refund?: { entity: { id: string; payment_id: string; amount: number; status: string } };
  };
}

async function processWebhookEvent(e: WebhookEvent): Promise<string> {
  const pay = e.payload?.payment?.entity;
  switch (e.event) {
    case 'payment.captured':
    case 'order.paid':
    case 'payment.authorized': {
      if (!pay?.order_id) return 'ignored: no payment entity';
      let entity = pay;
      if (entity.status === 'authorized') entity = await getGateway().capturePayment(entity.id, entity.amount);
      const outcome = await settleCapturedPayment({
        providerOrderId: entity.order_id as string,
        providerPaymentId: entity.id,
        amount: entity.amount,
        currency: entity.currency,
        method: entity.method,
      });
      return outcome ? `settled: ${outcome}` : 'ignored: unknown order';
    }
    case 'payment.failed':
      if (pay?.order_id) await recordPaymentFailure(pay.order_id, pay.error_description ?? 'Payment failed');
      return 'recorded failure';
    case 'refund.processed':
    case 'refund.failed': {
      const refund = e.payload?.refund?.entity;
      if (!refund) return 'ignored: no refund entity';
      await applyRefundResult({
        providerRefundId: refund.id,
        providerPaymentId: refund.payment_id,
        amount: refund.amount,
        status: e.event === 'refund.processed' ? 'PROCESSED' : 'FAILED',
      });
      return `refund ${refund.status}`;
    }
    default:
      return `ignored: ${e.event}`;
  }
}

/**
 * Receives a Razorpay webhook. The route hands over the RAW body bytes, because the signature is
 * computed over exactly what was sent — re-serialising parsed JSON would change it.
 *
 * Returns normally (→ 200) for new events, duplicates and permanently-unprocessable events, and
 * throws (→ 5xx, so Razorpay retries) only for transient failures.
 */
export async function handleWebhook(rawBody: Buffer, signature: string | undefined, eventId: string | undefined) {
  if (!signature || !verifyWebhookSignature(rawBody, signature)) throw AppError.badRequest('Invalid webhook signature');
  if (!eventId) throw AppError.badRequest('Missing event id');

  let event: WebhookEvent;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw AppError.badRequest('Malformed webhook body');
  }

  // The unique eventId is the idempotency gate: Razorpay delivers at-least-once.
  try {
    await prisma.webhookEvent.create({ data: { eventId, eventType: String(event.event), payload: event as unknown as Prisma.InputJsonValue } });
  } catch (err) {
    if ((err as { code?: string }).code !== 'P2002') throw err;
    const prior = await prisma.webhookEvent.findUniqueOrThrow({ where: { eventId } });
    if (prior.processedAt) return { duplicate: true as const };
    // A previous delivery failed part-way (we returned 5xx): fall through and process it again.
  }

  try {
    const note = await processWebhookEvent(event);
    await prisma.webhookEvent.update({ where: { eventId }, data: { processedAt: new Date(), error: null } });
    return { duplicate: false as const, note };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof PermanentPaymentError) {
      // Retrying cannot help; keep the evidence and acknowledge so Razorpay stops resending.
      await prisma.webhookEvent.update({ where: { eventId }, data: { processedAt: new Date(), error: message.slice(0, 500) } });
      return { duplicate: false as const, note: `permanent failure: ${message}` };
    }
    await prisma.webhookEvent.update({ where: { eventId }, data: { error: message.slice(0, 500) } });
    throw err;
  }
}
