import { logger } from '../../config/logger.js';
import { prisma, Prisma } from '../../config/prisma.js';
import { AppError } from '../../lib/errors.js';
import { pageMeta, toSkipTake } from '../../lib/pagination.js';
import { allocateProportionally } from '../../lib/pricing.js';
import { isCancellable } from '../../lib/stateMachines.js';
import { inclusiveTax } from '../../lib/money.js';
import { addItem } from '../cart/cart.service.js';
import { reconcileOrder, requestRefund } from '../payments/payments.service.js';
import { getSettings } from '../settings/settings.service.js';
import { cancelCommittedOrder, cancelUnpaidOrder, lockOrder, recordStatus } from './order-lifecycle.js';

export const orderViewInclude = {
  items: { orderBy: { productName: 'asc' } },
  payments: { include: { refunds: { orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'desc' } },
  history: { orderBy: { createdAt: 'asc' } },
  returns: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.OrderInclude;

type OrderWithView = Prisma.OrderGetPayload<{ include: typeof orderViewInclude }>;

/** When the order was marked delivered; the return window is counted from here. */
function deliveredAt(o: OrderWithView): Date | null {
  const entry = [...o.history].reverse().find((h) => h.status === 'DELIVERED');
  return entry?.createdAt ?? null;
}

export async function toOrderView(o: OrderWithView) {
  const settings = await getSettings();
  const now = new Date();
  const delivered = deliveredAt(o);
  const windowEnds = delivered ? new Date(delivered.getTime() + settings.returns.returnWindowDays * 86_400_000) : null;
  const openReturn = o.returns.some((r) => r.status === 'REQUESTED' || r.status === 'APPROVED');
  const payment = o.payments[0] ?? null;

  return {
    id: o.id,
    orderNumber: o.orderNumber,
    createdAt: o.createdAt,
    paidAt: o.paidAt,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    fulfilmentStatus: o.fulfilmentStatus,
    cancelReason: o.cancelReason,
    stockExpiresAt: o.stockExpiresAt,
    couponCode: o.couponCode,
    subtotal: o.subtotal,
    discountTotal: o.discountTotal,
    shippingTotal: o.shippingTotal,
    taxTotal: o.taxTotal,
    grandTotal: o.grandTotal,
    address: {
      fullName: o.shipFullName,
      phone: o.shipPhone,
      line1: o.shipLine1,
      line2: o.shipLine2,
      landmark: o.shipLandmark,
      city: o.shipCity,
      state: o.shipState,
      postalCode: o.shipPostalCode,
    },
    items: o.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      name: i.productName,
      sku: i.sku,
      image: i.imageUrl,
      size: i.size,
      colour: i.colour,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      lineTotal: i.lineTotal,
    })),
    payment: payment && {
      status: payment.status,
      method: payment.method,
      amount: payment.amount,
      refundedAmount: payment.refundedAmount,
      failureReason: payment.failureReason,
    },
    refunds: o.payments.flatMap((p) => p.refunds).map((r) => ({ id: r.id, amount: r.amount, status: r.status, reason: r.reason, createdAt: r.createdAt, processedAt: r.processedAt })),
    timeline: o.history.map((h) => ({ status: h.status, note: h.note, at: h.createdAt })),
    returns: o.returns.map((r) => ({ id: r.id, type: r.type, status: r.status, reason: r.reason, adminNote: r.adminNote, refundAmount: r.refundAmount, createdAt: r.createdAt })),
    // What the UI may offer — advisory only; each action is re-checked by its own endpoint.
    actions: {
      canCancel: isCancellable(o.fulfilmentStatus) && o.fulfilmentStatus !== 'CANCELLED',
      canRetryPayment:
        o.paymentMethod === 'RAZORPAY' && o.paymentStatus === 'PENDING' && o.fulfilmentStatus === 'PLACED' && !!o.stockExpiresAt && o.stockExpiresAt > now,
      canReturn: o.fulfilmentStatus === 'DELIVERED' && !!windowEnds && windowEnds > now && !openReturn,
      returnWindowEndsAt: windowEnds,
      canViewInvoice: o.fulfilmentStatus !== 'CANCELLED' && (o.paymentStatus !== 'PENDING' || o.paymentMethod === 'COD'),
    },
  };
}

/** Every customer query is scoped by userId: another shopper's order id behaves exactly like a missing one. */
async function ownOrder(userId: string, id: string) {
  const order = await prisma.order.findFirst({ where: { id, userId }, include: orderViewInclude });
  if (!order) throw AppError.notFound('Order not found');
  return order;
}

export async function listOrders(userId: string, page: { page: number; pageSize: number }) {
  const where = { userId };
  const [total, rows] = await prisma.$transaction([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...toSkipTake(page),
      select: {
        id: true,
        orderNumber: true,
        createdAt: true,
        grandTotal: true,
        paymentMethod: true,
        paymentStatus: true,
        fulfilmentStatus: true,
        stockExpiresAt: true,
        items: { select: { quantity: true, imageUrl: true, productName: true }, take: 4 },
        _count: { select: { items: true } },
      },
    }),
  ]);
  const items = rows.map(({ items, _count, ...o }) => ({
    ...o,
    itemCount: _count.items,
    preview: items.map((i) => ({ name: i.productName, image: i.imageUrl })),
  }));
  return { items, meta: pageMeta(page, total) };
}

export async function getOrder(userId: string, id: string) {
  return toOrderView(await ownOrder(userId, id));
}

// ───────────────────────── Cancellation ─────────────────────────

/**
 * Cancels an order on behalf of its owner or an admin. The cancel itself is one transaction
 * (status, stock, coupon); the refund is a separate provider call afterwards, so a payment-provider
 * outage can delay a refund but never leave an order half-cancelled.
 */
export async function cancelOrder(orderId: string, opts: { userId?: string; actorId: string; reason: string }) {
  const found = await prisma.order.findFirst({ where: { id: orderId, ...(opts.userId ? { userId: opts.userId } : {}) } });
  if (!found) throw AppError.notFound('Order not found');

  // An online order that looks unpaid may have been paid a moment ago. Find out BEFORE cancelling.
  if (found.paymentMethod === 'RAZORPAY' && found.paymentStatus === 'PENDING' && found.fulfilmentStatus === 'PLACED') {
    if ((await reconcileOrder(orderId)) === 'UNKNOWN') {
      throw new AppError(503, 'PAYMENT_STATUS_UNKNOWN', 'We are confirming your payment status. Please try cancelling again in a minute.');
    }
  }

  const toRefund = await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.fulfilmentStatus === 'CANCELLED') throw AppError.conflict('This order is already cancelled');
    if (!isCancellable(order.fulfilmentStatus)) {
      throw AppError.conflict('This order has already been shipped and can no longer be cancelled. Once delivered you can request a return.');
    }

    if (order.paymentMethod === 'RAZORPAY' && order.paymentStatus === 'PENDING') {
      await cancelUnpaidOrder(tx, order, { reason: opts.reason, actorId: opts.actorId });
      return null;
    }
    await cancelCommittedOrder(tx, order, { reason: opts.reason, actorId: opts.actorId });

    const captured = order.payments.find((p) => p.status === 'CAPTURED' || p.status === 'PARTIALLY_REFUNDED');
    return captured ? { paymentId: captured.id, amount: captured.amount - captured.refundedAmount } : null;
  });

  if (toRefund && toRefund.amount > 0) {
    try {
      await requestRefund({
        paymentId: toRefund.paymentId,
        amount: toRefund.amount,
        reason: `Order cancelled: ${opts.reason}`,
        source: 'CANCELLATION',
        actorId: opts.actorId,
        idempotencyKey: `cancel:${orderId}`,
      });
    } catch (err) {
      // The order IS cancelled. A refund that could not be confirmed stays PENDING and can be retried.
      logger.error({ err, orderId }, 'Cancellation refund needs attention');
    }
  }
  return toOrderView(await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: orderViewInclude }));
}

// ───────────────────────── Returns ─────────────────────────

export async function requestReturn(userId: string, orderId: string, input: { type: 'RETURN' | 'REPLACEMENT'; reason: string; details?: string | null }) {
  const settings = await getSettings();
  if (input.type === 'REPLACEMENT' && !settings.returns.replacementEnabled) {
    throw AppError.unprocessable('Replacements are not available right now');
  }

  const created = await prisma.$transaction(async (tx) => {
    const own = await tx.order.findFirst({ where: { id: orderId, userId }, select: { id: true } });
    if (!own) throw AppError.notFound('Order not found');
    const order = await lockOrder(tx, orderId);

    if (order.fulfilmentStatus !== 'DELIVERED') throw AppError.conflict('Returns can only be requested for delivered orders');
    const delivered = [...(await tx.orderStatusHistory.findMany({ where: { orderId, status: 'DELIVERED' }, orderBy: { createdAt: 'desc' }, take: 1 }))][0];
    const windowEnds = delivered ? delivered.createdAt.getTime() + settings.returns.returnWindowDays * 86_400_000 : 0;
    if (Date.now() > windowEnds) {
      throw AppError.unprocessable(`The ${settings.returns.returnWindowDays}-day return window for this order has closed`);
    }
    const open = await tx.returnRequest.count({ where: { orderId, status: { in: ['REQUESTED', 'APPROVED'] } } });
    if (open > 0) throw AppError.conflict('You already have an open return request for this order');

    const request = await tx.returnRequest.create({ data: { orderId, userId, type: input.type, reason: input.reason, details: input.details ?? null } });
    await tx.order.update({ where: { id: orderId }, data: { fulfilmentStatus: 'RETURN_REQUESTED' } });
    await recordStatus(tx, orderId, 'RETURN_REQUESTED', `${input.type === 'RETURN' ? 'Return' : 'Replacement'} requested: ${input.reason}`, userId);
    return request;
  });
  return created;
}

// ───────────────────────── Reorder ─────────────────────────

/** Puts whatever is still buyable from a past order back into the cart; reports what could not be. */
export async function reorder(userId: string, orderId: string) {
  const order = await ownOrder(userId, orderId);
  const added: string[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const item of order.items) {
    if (!item.variantId) {
      skipped.push({ name: item.productName, reason: 'No longer sold' });
      continue;
    }
    try {
      await addItem(userId, item.variantId, Math.min(item.quantity, 10));
      added.push(item.productName);
    } catch (err) {
      skipped.push({ name: item.productName, reason: err instanceof AppError ? err.message : 'Unavailable' });
    }
  }
  return { added, skipped };
}

// ───────────────────────── Invoice ─────────────────────────

/**
 * Tax invoice data. Prices are GST-inclusive, so each line shows the taxable value and the GST
 * contained in what was paid after its share of any discount — the same allocation used at checkout.
 */
export async function getInvoice(userId: string, orderId: string) {
  const o = await ownOrder(userId, orderId);
  const view = await toOrderView(o);
  if (!view.actions.canViewInvoice) throw AppError.conflict('An invoice is available once the order is confirmed');

  const shares = allocateProportionally(o.discountTotal, o.items.map((i) => i.lineTotal));
  const lines = o.items.map((i, idx) => {
    const paid = i.lineTotal - shares[idx];
    const rate = Number(i.taxRatePercent);
    const gst = inclusiveTax(paid, rate);
    return {
      description: i.productName,
      sku: i.sku,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      discount: shares[idx],
      taxableValue: paid - gst,
      gstRate: rate,
      gst,
      total: paid,
    };
  });

  return {
    invoiceNumber: `INV-${o.orderNumber.replace(/^PYN-/, '')}`,
    orderNumber: o.orderNumber,
    issuedAt: o.paidAt ?? o.createdAt,
    seller: { legalName: 'Payantra', note: 'Seller GSTIN and registered address are configured by the store admin before go-live.' },
    billTo: view.address,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    lines,
    totals: {
      subtotal: o.subtotal,
      discount: o.discountTotal,
      shipping: o.shippingTotal,
      taxableValue: lines.reduce((a, l) => a + l.taxableValue, 0),
      gst: lines.reduce((a, l) => a + l.gst, 0),
      grandTotal: o.grandTotal,
      couponCode: o.couponCode,
    },
  };
}
