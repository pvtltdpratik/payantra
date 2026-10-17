import { Prisma } from '../../config/prisma.js';
import { AppError } from '../../lib/errors.js';
import { notify } from '../../lib/notify.js';
import { canTransition, FULFILMENT_TRANSITIONS, type FulfilmentStatus } from '../../lib/stateMachines.js';
import { releaseCouponUse } from '../coupons/coupons.service.js';
import { releaseReservation, restock, type StockLine } from './stock.js';

type Tx = Prisma.TransactionClient;

export const orderInclude = { items: true, payments: true } satisfies Prisma.OrderInclude;
export type LockedOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

/**
 * Locks the order row for the rest of the transaction, then loads it.
 * Every function that changes an order's money or stock state goes through this, so a customer's
 * "verify", a Razorpay webhook and the expiry sweeper can never act on the same order at once.
 */
export async function lockOrder(tx: Tx, orderId: string): Promise<LockedOrder> {
  await tx.$queryRaw`SELECT 1 FROM "Order" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
  const order = await tx.order.findUnique({ where: { id: orderId }, include: orderInclude });
  if (!order) throw AppError.notFound('Order not found');
  return order;
}

export const stockLinesOf = (order: LockedOrder): StockLine[] =>
  order.items.filter((i) => i.variantId !== null).map((i) => ({ variantId: i.variantId as string, quantity: i.quantity }));

export async function recordStatus(tx: Tx, orderId: string, status: FulfilmentStatus, note?: string, actorId?: string | null) {
  await tx.orderStatusHistory.create({ data: { orderId, status, note, actorId: actorId ?? null } });
}

interface CancelOpts {
  reason: string;
  actorId?: string | null;
  /** Free the idempotency key so the client can safely retry the same checkout request. */
  releaseIdempotencyKey?: boolean;
}

/**
 * Cancels an order that was never paid. Its stock is only RESERVED (not sold), so the reservation
 * is released; a redeemed coupon use is handed back.
 */
export async function cancelUnpaidOrder(tx: Tx, order: LockedOrder, { reason, actorId, releaseIdempotencyKey }: CancelOpts): Promise<void> {
  if (order.paymentStatus !== 'PENDING' || order.fulfilmentStatus !== 'PLACED') {
    throw AppError.conflict('This order can no longer be cancelled as unpaid');
  }
  await releaseReservation(tx, order.id, stockLinesOf(order), reason);
  if (order.couponId) await releaseCouponUse(tx, order.couponId);

  await tx.payment.updateMany({ where: { orderId: order.id, status: 'PENDING' }, data: { status: 'FAILED', failureReason: reason } });
  await tx.order.update({
    where: { id: order.id },
    data: {
      fulfilmentStatus: 'CANCELLED',
      paymentStatus: 'FAILED',
      cancelledAt: new Date(),
      cancelReason: reason,
      stockExpiresAt: null,
      ...(releaseIdempotencyKey ? { idempotencyKey: null } : {}),
    },
  });
  await recordStatus(tx, order.id, 'CANCELLED', reason, actorId);
  await notify(tx, order.userId, `Order ${order.orderNumber} cancelled`, reason, `/account/orders/${order.id}`);
}

/**
 * Cancels an order whose stock was already SOLD (online payment captured, or Cash on Delivery).
 * The units go back on the shelf. Any refund is a separate step, because it needs the payment
 * provider and must not sit inside this database transaction.
 */
export async function cancelCommittedOrder(tx: Tx, order: LockedOrder, { reason, actorId }: CancelOpts): Promise<void> {
  await restock(tx, order.id, stockLinesOf(order), `Order cancelled: ${reason}`);
  if (order.couponId) await releaseCouponUse(tx, order.couponId);

  await tx.order.update({
    where: { id: order.id },
    data: {
      fulfilmentStatus: 'CANCELLED',
      // An unpaid COD order is simply void; a captured payment stays CAPTURED until its refund lands.
      ...(order.paymentStatus === 'PENDING' ? { paymentStatus: 'FAILED' as const } : {}),
      cancelledAt: new Date(),
      cancelReason: reason,
      stockExpiresAt: null,
    },
  });
  await recordStatus(tx, order.id, 'CANCELLED', reason, actorId);
  await notify(tx, order.userId, `Order ${order.orderNumber} cancelled`, reason, `/account/orders/${order.id}`);

  // A delivery partner who was assigned but has not collected the parcel is released from the job.
  const job = await tx.deliveryAssignment.findUnique({ where: { orderId: order.id }, include: { partner: { select: { userId: true } } } });
  if (job && (job.status === 'ASSIGNED' || job.status === 'ACCEPTED')) {
    await tx.deliveryAssignment.update({ where: { id: job.id }, data: { status: 'REJECTED', failureReason: 'Order cancelled' } });
    await tx.deliveryStatusHistory.create({ data: { assignmentId: job.id, status: 'REJECTED', reason: 'Order cancelled', actorId: actorId ?? null } });
    await notify(tx, job.partner.userId, `Delivery cancelled: ${order.orderNumber}`, 'The order was cancelled before pickup.', '/delivery');
  }
}

const STATUS_PHRASE: Partial<Record<FulfilmentStatus, string>> = {
  PAYMENT_CONFIRMED: 'confirmed',
  PROCESSING: 'being prepared',
  PACKED: 'packed',
  SHIPPED: 'shipped',
  OUT_FOR_DELIVERY: 'out for delivery',
  DELIVERED: 'delivered',
};

/**
 * The ONE place a forward fulfilment move is applied, whoever asks for it (an admin's button or a
 * delivery partner's action), so every dashboard follows the same rules:
 *  - the move must be in the state machine;
 *  - delivering a Cash-on-Delivery order is the moment the cash is collected, so it becomes paid;
 *  - the customer is told, and the move is recorded in the order's history.
 * The caller holds the order lock and decides WHO may ask; this decides WHAT may happen.
 */
export async function moveOrder(
  tx: Tx,
  order: LockedOrder,
  to: FulfilmentStatus,
  { note, actorId, notifyBody }: { note?: string | null; actorId?: string | null; notifyBody?: string } = {},
): Promise<void> {
  if (!canTransition(FULFILMENT_TRANSITIONS, order.fulfilmentStatus, to)) {
    throw AppError.conflict(`An order that is ${order.fulfilmentStatus.toLowerCase().replace(/_/g, ' ')} cannot move to ${to.toLowerCase().replace(/_/g, ' ')}`, {
      from: order.fulfilmentStatus,
      to,
    });
  }
  await tx.order.update({
    where: { id: order.id },
    data: {
      fulfilmentStatus: to,
      ...(to === 'DELIVERED' && order.paymentMethod === 'COD' && order.paymentStatus === 'PENDING'
        ? { paymentStatus: 'CAPTURED' as const, paidAt: new Date() }
        : {}),
    },
  });
  await recordStatus(tx, order.id, to, note ?? undefined, actorId);
  await notify(tx, order.userId, `Order ${order.orderNumber} is ${STATUS_PHRASE[to] ?? to.toLowerCase().replace(/_/g, ' ')}`, notifyBody ?? note ?? '', `/account/orders/${order.id}`);
}
