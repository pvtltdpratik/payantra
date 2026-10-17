import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../lib/errors.js';
import { advisoryLock } from '../../lib/locks.js';
import { notify } from '../../lib/notify.js';
import { computePricing } from '../../lib/pricing.js';
import { loadBasket } from '../cart/basket.js';
import { claimCouponUse, resolveCoupon } from '../coupons/coupons.service.js';
import { getGateway, GatewayError } from '../payments/gateway.js';
import { getSettings } from '../settings/settings.service.js';
import { generateOrderNumber } from '../orders/order-number.js';
import { cancelUnpaidOrder, lockOrder, recordStatus, stockLinesOf } from '../orders/order-lifecycle.js';
import { commitReservation, reserveStock } from '../orders/stock.js';

export interface CheckoutInput {
  addressId: string;
  paymentMethod: 'RAZORPAY' | 'COD';
  /** Client-generated UUID for this checkout attempt; a retry with the same key returns the same order. */
  idempotencyKey: string;
}

/** Everything the browser needs to open Razorpay Checkout. The key SECRET is never included. */
export interface RazorpayCheckoutParams {
  keyId: string;
  razorpayOrderId: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill: { name: string; email: string; contact: string };
}

type OrderRow = NonNullable<Awaited<ReturnType<typeof prisma.order.findUnique>>>;

const summary = (o: OrderRow) => ({
  id: o.id,
  orderNumber: o.orderNumber,
  grandTotal: o.grandTotal,
  paymentMethod: o.paymentMethod,
  paymentStatus: o.paymentStatus,
  fulfilmentStatus: o.fulfilmentStatus,
  stockExpiresAt: o.stockExpiresAt,
});

export function checkoutParams(
  order: Pick<OrderRow, 'orderNumber' | 'shipFullName' | 'shipPhone'>,
  payment: { providerOrderId: string; amount: number; currency: string },
  email: string,
): RazorpayCheckoutParams {
  return {
    keyId: env.RAZORPAY_KEY_ID,
    razorpayOrderId: payment.providerOrderId,
    amount: payment.amount,
    currency: payment.currency,
    name: 'Payantra',
    description: `Order ${order.orderNumber}`,
    prefill: { name: order.shipFullName, email, contact: order.shipPhone },
  };
}

/** What the storefront may offer at checkout. */
export async function checkoutOptions() {
  const { payments } = await getSettings();
  return { razorpayKeyId: env.RAZORPAY_KEY_ID, codEnabled: payments.codEnabled, codMaxOrder: payments.codMaxOrder, reservationMinutes: payments.reservationMinutes };
}

export async function placeOrder(userId: string, email: string, input: CheckoutInput) {
  const existing = await prisma.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return replay(existing, userId, email);

  const settings = await getSettings();
  if (input.paymentMethod === 'COD' && !settings.payments.codEnabled) {
    throw AppError.unprocessable('Cash on Delivery is not available right now', { field: 'paymentMethod' });
  }

  let order: OrderRow;
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Serialise requests that share an idempotency key, then look again UNDER the lock. The loser of a
      // race finds the winner's order and replays it — no unique-violation error is ever needed to
      // detect a duplicate. (The lock is released automatically when this transaction ends.)
      await advisoryLock(tx, `checkout:${input.idempotencyKey}`);
      const already = await tx.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (already) return { kind: 'replay' as const, order: already };

      const address = await tx.address.findFirst({ where: { id: input.addressId, userId } });
      if (!address) throw AppError.unprocessable('Choose a delivery address', { field: 'addressId' });

      // Price EVERYTHING from the database, inside the transaction. Nothing the browser sent is trusted.
      const basket = await loadBasket(tx, userId);
      if (basket.lines.length === 0) throw AppError.unprocessable('Your cart is empty');
      const problems = basket.lines.filter((l) => l.issue);
      if (problems.length) {
        throw AppError.conflict(
          'Some items in your cart have changed. Please review your cart.',
          problems.map((l) => ({ variantId: l.variantId, name: l.name, issue: l.issue, available: l.available })),
        );
      }

      const coupon = basket.couponCode ? await resolveCoupon(tx, basket.couponCode, userId) : null;
      const pricing = computePricing(
        basket.lines.map((l) => ({ variantId: l.variantId, unitPrice: l.unitPrice, quantity: l.quantity, taxRatePercent: l.taxRatePercent })),
        coupon,
        settings.shipping,
      );

      const isCod = input.paymentMethod === 'COD';
      if (isCod && pricing.grandTotal > settings.payments.codMaxOrder) {
        throw AppError.unprocessable('This order is above the Cash on Delivery limit. Please pay online.', { field: 'paymentMethod' });
      }

      // A coupon that gave no discount (e.g. below its minimum) is not recorded on the order.
      const appliedCoupon = pricing.couponApplied ? coupon : null;
      if (appliedCoupon) await claimCouponUse(tx, appliedCoupon.id);

      const byVariant = new Map(basket.lines.map((l) => [l.variantId, l]));
      const created = await tx.order.create({
        data: {
          orderNumber: generateOrderNumber(),
          userId,
          idempotencyKey: input.idempotencyKey,
          couponId: appliedCoupon?.id ?? null,
          couponCode: appliedCoupon?.code ?? null,
          paymentMethod: input.paymentMethod,
          paymentStatus: 'PENDING',
          fulfilmentStatus: 'PLACED',
          subtotal: pricing.subtotal,
          discountTotal: pricing.discountTotal,
          taxTotal: pricing.taxTotal,
          shippingTotal: pricing.shippingTotal,
          grandTotal: pricing.grandTotal,
          // Address snapshot: later edits or deletion of the saved address never alter this order.
          shipFullName: address.fullName,
          shipPhone: address.phone,
          shipLine1: address.line1,
          shipLine2: address.line2,
          shipLandmark: address.landmark,
          shipCity: address.city,
          shipState: address.state,
          shipPostalCode: address.postalCode,
          shipLatitude: address.latitude,
          shipLongitude: address.longitude,
          stockExpiresAt: isCod ? null : new Date(Date.now() + settings.payments.reservationMinutes * 60_000),
          items: {
            create: pricing.lines.map((p) => {
              const l = byVariant.get(p.variantId)!;
              return {
                productId: l.productId,
                variantId: l.variantId,
                productName: l.name,
                sku: l.sku,
                imageUrl: l.image?.url ?? null,
                size: l.size,
                colour: l.colour,
                fabric: l.fabric,
                unitPrice: p.unitPrice,
                taxRatePercent: p.taxRatePercent,
                quantity: p.quantity,
                lineTotal: p.lineTotal,
              };
            }),
          },
        },
        include: { items: true, payments: true },
      });

      await recordStatus(tx, created.id, 'PLACED', isCod ? 'Cash on Delivery order placed' : 'Order placed, awaiting payment', userId);
      await reserveStock(tx, created.id, stockLinesOf(created));

      if (isCod) {
        // Cash orders are firm commitments: sell the stock now and empty the cart.
        await commitReservation(tx, created.id, stockLinesOf(created));
        await tx.cartItem.deleteMany({ where: { cart: { userId } } });
        await tx.cart.updateMany({ where: { userId }, data: { couponCode: null } });
        await notify(tx, userId, `Order ${created.orderNumber} placed`, 'Pay in cash when your order arrives.', `/account/orders/${created.id}`);
      }
      return { kind: 'created' as const, order: created };
    });
    if (result.kind === 'replay') return replay(result.order, userId, email);
    order = result.order;
  } catch (err) {
    // Safety net only: the advisory lock above means a duplicate key should never reach the database.
    if ((err as { code?: string }).code === 'P2002') {
      const winner = await prisma.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (winner) return replay(winner, userId, email);
    }
    throw err;
  }

  if (order.paymentMethod === 'COD') return { order: summary(order), payment: null };
  return startOnlinePayment(order, email);
}

/**
 * Creates the Razorpay order for a freshly reserved checkout. This talks to the network, so it is
 * deliberately OUTSIDE the database transaction: if Razorpay is down we undo the reservation
 * instead of holding a transaction (and stock locks) open across an HTTP call.
 */
async function startOnlinePayment(order: OrderRow, email: string) {
  try {
    const gw = await getGateway().createOrder({
      amount: order.grandTotal,
      receipt: order.orderNumber,
      notes: { orderId: order.id, orderNumber: order.orderNumber },
    });
    if (gw.amount !== order.grandTotal || gw.currency !== 'INR') {
      throw new GatewayError(502, 'AMOUNT_MISMATCH', 'Provider returned an unexpected amount');
    }
    const payment = await prisma.payment.create({
      data: { orderId: order.id, providerOrderId: gw.id, amount: gw.amount, currency: gw.currency, status: 'PENDING' },
    });
    return { order: summary(order), payment: checkoutParams(order, payment, email) };
  } catch (err) {
    logger.error({ err, orderId: order.id }, 'Could not start online payment; releasing the reservation');
    await prisma.$transaction(async (tx) => {
      const locked = await lockOrder(tx, order.id);
      if (locked.paymentStatus === 'PENDING' && locked.fulfilmentStatus === 'PLACED' && locked.payments.length === 0) {
        // Free the idempotency key so the shopper's retry is treated as a fresh attempt.
        await cancelUnpaidOrder(tx, locked, { reason: 'Payment provider unavailable', releaseIdempotencyKey: true });
      }
    });
    throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'We could not start the payment. Please try again in a moment.');
  }
}

/** Same key, same answer: a double-click or a retry after a lost response never creates a second order. */
async function replay(existing: OrderRow, userId: string, email: string) {
  if (existing.userId !== userId) throw AppError.conflict('This checkout reference has already been used');

  if (existing.paymentMethod === 'COD') return { order: summary(existing), payment: null };
  if (existing.fulfilmentStatus === 'CANCELLED') {
    throw AppError.conflict('This checkout expired. Please review your cart and try again.');
  }
  if (existing.paymentStatus === 'CAPTURED') return { order: summary(existing), payment: null };

  const payment = await prisma.payment.findFirst({ where: { orderId: existing.id }, orderBy: { createdAt: 'desc' } });
  if (payment) return { order: summary(existing), payment: checkoutParams(existing, payment, email) };
  // The previous attempt died between reserving stock and creating the provider order: finish the job.
  return startOnlinePayment(existing, email);
}
