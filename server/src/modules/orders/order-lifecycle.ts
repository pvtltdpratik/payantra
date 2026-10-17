import { Prisma } from '../../config/prisma.js';
import { AppError } from '../../lib/errors.js';
import { notify } from '../../lib/notify.js';
import type { FulfilmentStatus } from '../../lib/stateMachines.js';
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
}
