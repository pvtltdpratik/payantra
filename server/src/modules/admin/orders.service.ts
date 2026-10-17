import type { Request } from 'express';
import { prisma, Prisma } from '../../config/prisma.js';
import { audit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { notify } from '../../lib/notify.js';
import { pageMeta, toSkipTake } from '../../lib/pagination.js';
import { canTransition, FULFILMENT_TRANSITIONS, type FulfilmentStatus } from '../../lib/stateMachines.js';
import { lockOrder, recordStatus, stockLinesOf } from '../orders/order-lifecycle.js';
import { cancelOrder, orderViewInclude, toOrderView } from '../orders/orders.service.js';
import { restock } from '../orders/stock.js';
import { executeRefund, requestRefund } from '../payments/payments.service.js';

const STATUS_LABEL: Record<string, string> = {
  PAYMENT_CONFIRMED: 'confirmed',
  PROCESSING: 'being prepared',
  PACKED: 'packed',
  SHIPPED: 'shipped',
  OUT_FOR_DELIVERY: 'out for delivery',
  DELIVERED: 'delivered',
};

/** Statuses an admin may set directly. Cancellation, returns and payment are handled by dedicated actions. */
const ADMIN_SETTABLE: FulfilmentStatus[] = ['PAYMENT_CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'];

export interface AdminOrderQuery {
  page: number;
  pageSize: number;
  q?: string;
  status?: FulfilmentStatus;
  paymentStatus?: 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
  paymentMethod?: 'RAZORPAY' | 'COD';
  from?: Date;
  to?: Date;
}

export async function listOrders(q: AdminOrderQuery) {
  const where: Prisma.OrderWhereInput = {
    ...(q.status ? { fulfilmentStatus: q.status } : {}),
    ...(q.paymentStatus ? { paymentStatus: q.paymentStatus } : {}),
    ...(q.paymentMethod ? { paymentMethod: q.paymentMethod } : {}),
    ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    ...(q.q
      ? {
          OR: [
            { orderNumber: { contains: q.q, mode: 'insensitive' } },
            { user: { email: { contains: q.q, mode: 'insensitive' } } },
            { shipFullName: { contains: q.q, mode: 'insensitive' } },
            { shipPhone: { contains: q.q } },
          ],
        }
      : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...toSkipTake(q),
      select: {
        id: true,
        orderNumber: true,
        createdAt: true,
        grandTotal: true,
        paymentMethod: true,
        paymentStatus: true,
        fulfilmentStatus: true,
        shipFullName: true,
        shipCity: true,
        user: { select: { email: true } },
        _count: { select: { items: true } },
      },
    }),
  ]);
  const items = rows.map(({ user, _count, ...o }) => ({ ...o, customerEmail: user.email, itemCount: _count.items }));
  return { items, meta: pageMeta(q, total) };
}

export async function getOrder(id: string) {
  const order = await prisma.order.findUnique({
    where: { id },
    include: { ...orderViewInclude, user: { select: { id: true, email: true, fullName: true, phone: true } } },
  });
  if (!order) throw AppError.notFound('Order not found');
  const { user, ...rest } = order;
  return { ...(await toOrderView(rest)), customer: user, nextStatuses: adminNextStatuses(order) };
}

/** The next statuses an admin can actually choose from here (not cancellation/returns, not manual payment confirmation online). */
function adminNextStatuses(order: { fulfilmentStatus: FulfilmentStatus; paymentMethod: 'RAZORPAY' | 'COD' }): FulfilmentStatus[] {
  return FULFILMENT_TRANSITIONS[order.fulfilmentStatus].filter(
    (s) => ADMIN_SETTABLE.includes(s) && !(s === 'PAYMENT_CONFIRMED' && order.paymentMethod === 'RAZORPAY'),
  );
}

export async function updateStatus(req: Request, orderId: string, status: FulfilmentStatus, note?: string) {
  if (!ADMIN_SETTABLE.includes(status)) {
    throw AppError.unprocessable('Use the Cancel or Returns actions for that change');
  }
  await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);

    if (status === 'PAYMENT_CONFIRMED' && order.paymentMethod === 'RAZORPAY') {
      throw AppError.unprocessable('Online orders are confirmed automatically when the payment is received');
    }
    if (!canTransition(FULFILMENT_TRANSITIONS, order.fulfilmentStatus, status)) {
      throw AppError.conflict(`An order that is ${order.fulfilmentStatus.toLowerCase().replace(/_/g, ' ')} cannot move to ${status.toLowerCase().replace(/_/g, ' ')}`, {
        allowed: adminNextStatuses(order),
      });
    }

    await tx.order.update({
      where: { id: orderId },
      data: {
        fulfilmentStatus: status,
        // Cash is collected at the door: delivery is the moment a COD order becomes paid.
        ...(status === 'DELIVERED' && order.paymentMethod === 'COD' && order.paymentStatus === 'PENDING'
          ? { paymentStatus: 'CAPTURED' as const, paidAt: new Date() }
          : {}),
      },
    });
    await recordStatus(tx, orderId, status, note, req.user!.id);
    await audit(tx, req, { action: 'order.status', entityType: 'Order', entityId: orderId, metadata: { from: order.fulfilmentStatus, to: status, note: note ?? null } });
    await notify(tx, order.userId, `Order ${order.orderNumber} is ${STATUS_LABEL[status] ?? status.toLowerCase()}`, note ?? '', `/account/orders/${orderId}`);
  });
  return getOrder(orderId);
}

export async function adminCancel(req: Request, orderId: string, reason: string) {
  await cancelOrder(orderId, { actorId: req.user!.id, reason });
  await prisma.$transaction((tx) => audit(tx, req, { action: 'order.cancel', entityType: 'Order', entityId: orderId, metadata: { reason } }));
  return getOrder(orderId);
}

export async function adminRefund(req: Request, orderId: string, input: { amount?: number; reason: string; idempotencyKey?: string }) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { payments: { include: { refunds: true } } } });
  if (!order) throw AppError.notFound('Order not found');

  const payment = order.payments.find((p) => p.status === 'CAPTURED' || p.status === 'PARTIALLY_REFUNDED');
  if (!payment) {
    throw AppError.unprocessable(
      order.paymentMethod === 'COD' ? 'Cash on Delivery payments are refunded outside the system' : 'This order has no captured payment to refund',
    );
  }
  const pending = payment.refunds.filter((r) => r.status === 'PENDING').reduce((a, r) => a + r.amount, 0);
  const amount = input.amount ?? payment.amount - payment.refundedAmount - pending;

  const refund = await requestRefund({
    paymentId: payment.id,
    amount,
    reason: input.reason,
    source: 'ADMIN',
    actorId: req.user!.id,
    idempotencyKey: input.idempotencyKey,
  });
  await prisma.$transaction((tx) =>
    audit(tx, req, { action: 'order.refund', entityType: 'Order', entityId: orderId, metadata: { amount, reason: input.reason, refundId: refund.id } }),
  );
  return { refund, order: await getOrder(orderId) };
}

/** Re-sends a refund that Razorpay could not be reached for. Safe: it first looks for an existing provider refund. */
export async function retryRefund(req: Request, refundId: string) {
  const refund = await executeRefund(refundId);
  await prisma.$transaction((tx) => audit(tx, req, { action: 'refund.retry', entityType: 'Refund', entityId: refundId }));
  return refund;
}

// ───────────────────────── Returns ─────────────────────────

export async function listReturns(q: { page: number; pageSize: number; status?: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'COMPLETED' }) {
  const where: Prisma.ReturnRequestWhereInput = q.status ? { status: q.status } : {};
  const [total, items] = await prisma.$transaction([
    prisma.returnRequest.count({ where }),
    prisma.returnRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...toSkipTake(q),
      include: { order: { select: { id: true, orderNumber: true, grandTotal: true, paymentMethod: true, user: { select: { email: true } } } } },
    }),
  ]);
  return { items, meta: pageMeta(q, total) };
}

export type ReturnAction =
  | { action: 'approve'; adminNote?: string }
  | { action: 'reject'; adminNote: string }
  | { action: 'complete'; adminNote?: string; refundAmount?: number; restock: boolean };

/** Moves a return request through REQUESTED → APPROVED → COMPLETED (or REJECTED), with its stock and money effects. */
export async function resolveReturn(req: Request, returnId: string, input: ReturnAction) {
  const outcome = await prisma.$transaction(async (tx) => {
    const request = await tx.returnRequest.findUnique({ where: { id: returnId } });
    if (!request) throw AppError.notFound('Return request not found');
    const order = await lockOrder(tx, request.orderId);
    const actorId = req.user!.id;

    if (input.action === 'approve') {
      if (request.status !== 'REQUESTED') throw AppError.conflict('Only a new request can be approved');
      await tx.returnRequest.update({ where: { id: returnId }, data: { status: 'APPROVED', adminNote: input.adminNote ?? null, resolvedById: actorId } });
      await notify(tx, order.userId, `Return approved for ${order.orderNumber}`, input.adminNote ?? 'Please hand the items to our delivery partner when they arrive.', `/account/orders/${order.id}`);
      return { refund: null };
    }

    if (input.action === 'reject') {
      if (request.status !== 'REQUESTED' && request.status !== 'APPROVED') throw AppError.conflict('This request is already closed');
      await tx.returnRequest.update({ where: { id: returnId }, data: { status: 'REJECTED', adminNote: input.adminNote, resolvedById: actorId, resolvedAt: new Date() } });
      // The order goes back to "delivered": nothing is being returned.
      if (order.fulfilmentStatus === 'RETURN_REQUESTED') {
        await tx.order.update({ where: { id: order.id }, data: { fulfilmentStatus: 'DELIVERED' } });
        await recordStatus(tx, order.id, 'DELIVERED', `Return request declined: ${input.adminNote}`, actorId);
      }
      await notify(tx, order.userId, `Return declined for ${order.orderNumber}`, input.adminNote, `/account/orders/${order.id}`);
      return { refund: null };
    }

    // complete
    if (request.status !== 'APPROVED') throw AppError.conflict('Approve the request before completing it');
    const captured = order.payments.find((p) => p.status === 'CAPTURED' || p.status === 'PARTIALLY_REFUNDED');
    const refundable = captured ? captured.amount - captured.refundedAmount : 0;
    const amount = request.type === 'RETURN' ? (input.refundAmount ?? refundable) : 0;
    if (amount > refundable) throw AppError.unprocessable(`Only ₹${(refundable / 100).toFixed(2)} is refundable for this order`, { field: 'refundAmount' });

    if (input.restock) await restock(tx, order.id, stockLinesOf(order), 'Returned by customer');
    await tx.returnRequest.update({
      where: { id: returnId },
      data: { status: 'COMPLETED', adminNote: input.adminNote ?? null, refundAmount: amount || null, resolvedById: actorId, resolvedAt: new Date() },
    });
    await tx.order.update({ where: { id: order.id }, data: { fulfilmentStatus: 'RETURNED' } });
    await recordStatus(tx, order.id, 'RETURNED', input.adminNote ?? 'Return completed', actorId);
    await notify(tx, order.userId, `Return completed for ${order.orderNumber}`, amount ? 'Your refund has been started.' : 'Thanks for letting us know.', `/account/orders/${order.id}`);
    return { refund: captured && amount > 0 ? { paymentId: captured.id, amount } : null };
  });

  if (outcome.refund) {
    await requestRefund({
      paymentId: outcome.refund.paymentId,
      amount: outcome.refund.amount,
      reason: 'Return completed',
      source: 'RETURN',
      actorId: req.user!.id,
      idempotencyKey: `return:${returnId}`,
    });
  }
  await prisma.$transaction((tx) => audit(tx, req, { action: `return.${input.action}`, entityType: 'ReturnRequest', entityId: returnId }));
  return prisma.returnRequest.findUniqueOrThrow({ where: { id: returnId } });
}
