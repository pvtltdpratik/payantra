import { logger } from '../../config/logger.js';
import { prisma } from '../../config/prisma.js';
import { reconcileOrder } from '../payments/payments.service.js';
import { cancelUnpaidOrder, lockOrder } from './order-lifecycle.js';

export interface SweepResult {
  /** Unpaid orders cancelled and their stock freed. */
  expired: number;
  /** Orders that turned out to have been paid after all (settled instead of cancelled). */
  paid: number;
  /** Orders left alone: the provider could not be asked, or the order changed while we looked. */
  skipped: number;
}

/**
 * Frees stock held by online-payment orders whose payment window has closed.
 *
 * For each overdue order it FIRST asks Razorpay whether money was taken. Only a definite
 * "no payment" leads to cancellation; if the provider cannot be reached the order is left for the
 * next sweep, because cancelling an order a customer has actually paid for is the worse mistake.
 */
export async function expireUnpaidOrders(now = new Date(), batchSize = 50): Promise<SweepResult> {
  const due = await prisma.order.findMany({
    where: { paymentMethod: 'RAZORPAY', paymentStatus: 'PENDING', fulfilmentStatus: 'PLACED', stockExpiresAt: { lt: now } },
    select: { id: true },
    orderBy: { stockExpiresAt: 'asc' },
    take: batchSize,
  });

  const result: SweepResult = { expired: 0, paid: 0, skipped: 0 };
  for (const { id } of due) {
    const recon = await reconcileOrder(id);
    if (recon === 'PAID') {
      result.paid++;
      continue;
    }
    if (recon === 'UNKNOWN') {
      result.skipped++;
      continue;
    }

    const cancelled = await prisma.$transaction(async (tx) => {
      const order = await lockOrder(tx, id);
      // Re-check under the lock: a webhook may have paid it, or the shopper retried and extended the window.
      if (order.paymentStatus !== 'PENDING' || order.fulfilmentStatus !== 'PLACED' || !order.stockExpiresAt || order.stockExpiresAt >= now) {
        return false;
      }
      await cancelUnpaidOrder(tx, order, { reason: 'Payment window expired' });
      return true;
    });
    if (cancelled) result.expired++;
    else result.skipped++;
  }
  if (result.expired || result.paid) logger.info(result, 'Order expiry sweep');
  return result;
}

/** Runs the sweep on an interval; returns a function that stops it. Never overlaps itself. */
export function startExpirySweeper(everySeconds: number): () => void {
  if (everySeconds <= 0) return () => undefined;
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await expireUnpaidOrders();
    } catch (err) {
      logger.error({ err }, 'Order expiry sweep failed');
    } finally {
      running = false;
    }
  }, everySeconds * 1000);
  timer.unref(); // never keep the process alive just for the sweeper
  return () => clearInterval(timer);
}
