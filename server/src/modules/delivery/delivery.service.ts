import { prisma, type Prisma } from '../../config/prisma.js';
import { AppError } from '../../lib/errors.js';
import { codeMatches, MAX_OTP_ATTEMPTS, OTP_TTL_MS } from '../../lib/deliveryOtp.js';
import { advisoryLock } from '../../lib/locks.js';
import { notify, notifyAdmins } from '../../lib/notify.js';
import { pageMeta, toSkipTake } from '../../lib/pagination.js';
import { canTransition, DELIVERY_TRANSITIONS, type DeliveryStatus } from '../../lib/stateMachines.js';
import { istDateKey, istDayStart, istDayStartOffset } from '../../lib/time.js';
import { cancelCommittedOrder, lockOrder, moveOrder } from '../orders/order-lifecycle.js';
import { refundAfterCancel } from '../orders/orders.service.js';
import { getSettings } from '../settings/settings.service.js';
import type { PartnerTargetStatus } from './delivery.schema.js';
import { partnerAssignmentInclude, partnerAssignmentView } from './delivery-view.js';

type Tx = Prisma.TransactionClient;

/** Statuses where the parcel is still the partner's problem. */
export const ACTIVE_DELIVERY: DeliveryStatus[] = ['ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'FAILED'];
const HISTORY_DELIVERY: DeliveryStatus[] = ['DELIVERED', 'RETURNED_TO_ORIGIN', 'REJECTED'];

export async function logDelivery(tx: Tx, assignmentId: string, status: DeliveryStatus, reason: string | null, actorId: string | null) {
  await tx.deliveryStatusHistory.create({ data: { assignmentId, status, reason, actorId } });
}

// ───────────────────────── Onboarding ─────────────────────────

interface ApplyInput {
  fullName: string;
  phone: string;
  vehicleType?: string;
  vehicleNumber?: string;
  serviceCity: string;
  idDocumentType?: string;
  idDocumentRef?: string;
  applicationNote?: string;
}

/** Any signed-in customer can apply; an admin decides. Applying never changes the applicant's role. */
export async function apply(userId: string, input: ApplyInput) {
  const { delivery } = await getSettings();
  if (delivery.requireVehicle && !input.vehicleType) throw AppError.unprocessable('Tell us what vehicle you will deliver with', { field: 'vehicleType' });
  if (delivery.requireIdDocument && !(input.idDocumentType && input.idDocumentRef)) {
    throw AppError.unprocessable('Add an ID document type and its verification reference', { field: 'idDocumentRef' });
  }

  const partner = await prisma.$transaction(async (tx) => {
    await advisoryLock(tx, `partner-apply:${userId}`);
    const profile = await tx.profile.findUnique({ where: { id: userId } });
    if (!profile) throw AppError.notFound('Profile not found');
    if (profile.role === 'ADMIN') throw AppError.forbidden('Administrators cannot apply as delivery partners');

    const existing = await tx.deliveryPartner.findUnique({ where: { userId } });
    if (existing && (existing.status === 'APPROVED' || existing.status === 'SUSPENDED')) {
      throw AppError.conflict(existing.status === 'APPROVED' ? 'You are already a delivery partner' : 'Your delivery partner account is suspended. Contact support.');
    }

    await tx.profile.update({ where: { id: userId }, data: { fullName: input.fullName, phone: input.phone } });
    const data = {
      status: 'PENDING' as const,
      vehicleType: input.vehicleType ?? null,
      vehicleNumber: input.vehicleNumber ?? null,
      serviceCity: input.serviceCity,
      idDocumentType: input.idDocumentType ?? null,
      idDocumentRef: input.idDocumentRef ?? null,
      applicationNote: input.applicationNote ?? null,
      rejectionReason: null,
    };
    const saved = existing
      ? await tx.deliveryPartner.update({ where: { userId }, data })
      : await tx.deliveryPartner.create({ data: { userId, ...data, perDeliveryPayout: delivery.defaultPayout } });
    await notifyAdmins(tx, 'New delivery partner application', `${input.fullName} (${input.serviceCity}) has applied.`, `/admin/delivery-partners/${saved.id}`);
    return saved;
  });
  return partnerSelf(partner);
}

function partnerSelf(p: Prisma.DeliveryPartnerGetPayload<object>) {
  return {
    id: p.id,
    status: p.status,
    isOnline: p.isOnline,
    vehicleType: p.vehicleType,
    vehicleNumber: p.vehicleNumber,
    serviceCity: p.serviceCity,
    idDocumentType: p.idDocumentType,
    rejectionReason: p.status === 'REJECTED' ? p.rejectionReason : null,
    perDeliveryPayout: p.perDeliveryPayout,
    approvedAt: p.approvedAt,
    createdAt: p.createdAt,
  };
}

/** The signed-in user's delivery-partner standing (or null if they never applied), plus what applying asks for. */
export async function getMe(userId: string) {
  const [partner, profile, settings] = await Promise.all([
    prisma.deliveryPartner.findUnique({ where: { userId } }),
    prisma.profile.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true, phone: true, email: true, role: true } }),
    getSettings(),
  ]);
  return {
    profile,
    partner: partner && partnerSelf(partner),
    requirements: { vehicle: settings.delivery.requireVehicle, idDocument: settings.delivery.requireIdDocument },
  };
}

export async function requireActivePartner(userId: string) {
  const partner = await prisma.deliveryPartner.findUnique({ where: { userId } });
  if (!partner || partner.status !== 'APPROVED') throw AppError.forbidden('Your delivery partner account is not active');
  return partner;
}

export async function updateMyProfile(userId: string, input: { vehicleType?: string; vehicleNumber?: string; serviceCity?: string; phone?: string }) {
  const partner = await requireActivePartner(userId);
  const { phone, ...rest } = input;
  await prisma.$transaction(async (tx) => {
    if (Object.keys(rest).length) await tx.deliveryPartner.update({ where: { id: partner.id }, data: rest });
    if (phone) await tx.profile.update({ where: { id: userId }, data: { phone } });
  });
  return getMe(userId);
}

export async function setAvailability(userId: string, isOnline: boolean) {
  const partner = await requireActivePartner(userId);
  const saved = await prisma.deliveryPartner.update({ where: { id: partner.id }, data: { isOnline } });
  return partnerSelf(saved);
}

// ───────────────────────── Reading assignments ─────────────────────────

export async function listAssignments(userId: string, q: { view: 'active' | 'history'; page: number; pageSize: number }) {
  const partner = await requireActivePartner(userId);
  const where: Prisma.DeliveryAssignmentWhereInput = { partnerId: partner.id, status: { in: q.view === 'active' ? ACTIVE_DELIVERY : HISTORY_DELIVERY } };
  const [total, rows] = await prisma.$transaction([
    prisma.deliveryAssignment.count({ where }),
    prisma.deliveryAssignment.findMany({
      where,
      include: partnerAssignmentInclude,
      // Oldest job first while working; newest first in history.
      orderBy: { assignedAt: q.view === 'active' ? 'asc' : 'desc' },
      ...toSkipTake(q),
    }),
  ]);
  return { items: rows.map((r) => partnerAssignmentView(r)), meta: pageMeta(q, total) };
}

/** Another partner's assignment is indistinguishable from one that does not exist. */
export async function getAssignment(userId: string, assignmentId: string) {
  const partner = await requireActivePartner(userId);
  const a = await prisma.deliveryAssignment.findFirst({ where: { id: assignmentId, partnerId: partner.id }, include: partnerAssignmentInclude });
  if (!a) throw AppError.notFound('Delivery not found');
  return partnerAssignmentView(a);
}

// ───────────────────────── Doing the job ─────────────────────────

export interface StatusInput {
  status: PartnerTargetStatus;
  reason?: string;
  notes?: string;
  code?: string;
}

type Outcome =
  | { kind: 'done'; refund: { paymentId: string; amount: number } | null; reason: string }
  | { kind: 'wrong-code'; attemptsLeft: number };

/**
 * Every partner action goes through here. In ONE transaction it locks the order, checks the partner still
 * owns the job and the step is allowed, updates the assignment, and moves the ORDER through the same shared
 * rules an admin uses — so the two dashboards cannot disagree.
 *
 * A wrong delivery code must be COUNTED even though the request fails, so it is reported as a value and
 * thrown only after the transaction has committed.
 */
export async function updateStatus(userId: string, assignmentId: string, input: StatusInput) {
  const partner = await requireActivePartner(userId);
  const owned = await prisma.deliveryAssignment.findFirst({ where: { id: assignmentId, partnerId: partner.id }, select: { orderId: true } });
  if (!owned) throw AppError.notFound('Delivery not found');

  const to = input.status as DeliveryStatus;
  const outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
    const order = await lockOrder(tx, owned.orderId);
    const a = await tx.deliveryAssignment.findUnique({ where: { id: assignmentId } });
    // Reassigned or removed by an admin while we waited for the lock.
    if (!a || a.partnerId !== partner.id) throw AppError.notFound('Delivery not found');
    const live = await tx.deliveryPartner.findUnique({ where: { id: partner.id } });
    if (!live || live.status !== 'APPROVED') throw AppError.forbidden('Your delivery partner account is not active');

    if (!canTransition(DELIVERY_TRANSITIONS, a.status, to)) {
      throw AppError.conflict(`A delivery that is ${a.status.toLowerCase().replace(/_/g, ' ')} cannot move to ${to.toLowerCase().replace(/_/g, ' ')}`, { allowed: DELIVERY_TRANSITIONS[a.status] });
    }
    const now = new Date();
    const reason = input.reason ?? null;

    switch (to) {
      case 'REJECTED': {
        await tx.deliveryAssignment.update({ where: { id: a.id }, data: { status: 'REJECTED', failureReason: reason } });
        await notifyAdmins(tx, 'Delivery assignment rejected', `Order ${order.orderNumber}: ${reason}`, `/admin/orders/${order.id}`);
        break;
      }
      case 'ACCEPTED': {
        await tx.deliveryAssignment.update({ where: { id: a.id }, data: { status: 'ACCEPTED', acceptedAt: now } });
        break;
      }
      case 'PICKED_UP': {
        if (order.fulfilmentStatus === 'PACKED') await moveOrder(tx, order, 'SHIPPED', { actorId: userId, note: 'Picked up by the delivery partner' });
        else if (order.fulfilmentStatus !== 'SHIPPED') throw AppError.conflict('This order is not ready to be picked up');
        await tx.deliveryAssignment.update({ where: { id: a.id }, data: { status: 'PICKED_UP', pickedUpAt: now } });
        break;
      }
      case 'OUT_FOR_DELIVERY': {
        if (order.fulfilmentStatus !== 'SHIPPED') throw AppError.conflict('This order cannot go out for delivery from its current state');
        await moveOrder(tx, order, 'OUT_FOR_DELIVERY', {
          actorId: userId,
          note: 'Out for delivery',
          notifyBody: 'Open your order to see the delivery code. Share it with the delivery partner only when you have your parcel.',
        });
        // A fresh code for every attempt: the previous one (and its failed guesses) no longer count.
        await tx.deliveryAssignment.update({
          where: { id: a.id },
          data: { status: 'OUT_FOR_DELIVERY', otpEpoch: { increment: 1 }, otpAttempts: 0, otpExpiresAt: new Date(now.getTime() + OTP_TTL_MS), failureReason: null },
        });
        break;
      }
      case 'DELIVERED': {
        if (a.otpAttempts >= MAX_OTP_ATTEMPTS) {
          throw new AppError(423, 'OTP_LOCKED', 'Too many wrong codes. Ask the shop to reissue the delivery code.');
        }
        if (!a.otpExpiresAt || a.otpExpiresAt <= now) {
          throw new AppError(409, 'OTP_EXPIRED', 'This delivery code has expired. Ask the shop to reissue it.');
        }
        if (!input.code || !codeMatches(a.id, a.otpEpoch, input.code)) {
          const updated = await tx.deliveryAssignment.update({ where: { id: a.id }, data: { otpAttempts: { increment: 1 } } });
          return { kind: 'wrong-code', attemptsLeft: Math.max(0, MAX_OTP_ATTEMPTS - updated.otpAttempts) };
        }
        await moveOrder(tx, order, 'DELIVERED', { actorId: userId, note: 'Delivered and verified with the delivery code' });
        await tx.deliveryAssignment.update({
          where: { id: a.id },
          data: { status: 'DELIVERED', deliveredAt: now, notes: input.notes ?? a.notes, otpExpiresAt: null, payoutAmount: live.perDeliveryPayout },
        });
        break;
      }
      case 'FAILED': {
        // Back to SHIPPED: the parcel is still out there and can be attempted again.
        await moveOrder(tx, order, 'SHIPPED', {
          actorId: userId,
          note: `Delivery attempt failed: ${reason}`,
          notifyBody: `We couldn't deliver this time (${reason}). We'll try again or contact you.`,
        });
        await tx.deliveryAssignment.update({ where: { id: a.id }, data: { status: 'FAILED', failureReason: reason, notes: input.notes ?? a.notes, otpExpiresAt: null } });
        await notifyAdmins(tx, 'Failed delivery', `Order ${order.orderNumber}: ${reason}`, `/admin/orders/${order.id}`);
        break;
      }
      case 'RETURNED_TO_ORIGIN': {
        if (order.fulfilmentStatus !== 'SHIPPED') throw AppError.conflict('This order cannot be returned to origin from its current state');
        await tx.deliveryAssignment.update({ where: { id: a.id }, data: { status: 'RETURNED_TO_ORIGIN', failureReason: reason, notes: input.notes ?? a.notes } });
        // The parcel is back on the shelf and the sale is void: same path as any cancellation (stock back, coupon back, refund).
        await cancelCommittedOrder(tx, order, { reason: `Returned to origin: ${reason}`, actorId: userId });
        await notifyAdmins(tx, 'Parcel returned to origin', `Order ${order.orderNumber}: ${reason}`, `/admin/orders/${order.id}`);
        const captured = order.payments.find((p) => p.status === 'CAPTURED' || p.status === 'PARTIALLY_REFUNDED');
        await logDelivery(tx, a.id, to, reason, userId);
        return { kind: 'done', refund: captured ? { paymentId: captured.id, amount: captured.amount - captured.refundedAmount } : null, reason: `Returned to origin: ${reason}` };
      }
    }
    await logDelivery(tx, a.id, to, reason ?? input.notes ?? null, userId);
    return { kind: 'done', refund: null, reason: '' };
  });

  if (outcome.kind === 'wrong-code') {
    throw new AppError(422, 'OTP_INVALID', `That code is not right. ${outcome.attemptsLeft} attempt${outcome.attemptsLeft === 1 ? '' : 's'} left.`, { attemptsLeft: outcome.attemptsLeft });
  }
  if (outcome.refund) await refundAfterCancel(owned.orderId, outcome.refund, { actorId: userId, reason: outcome.reason });
  return getAssignment(userId, assignmentId);
}

// ───────────────────────── Dashboard numbers ─────────────────────────

export async function stats(userId: string) {
  const partner = await requireActivePartner(userId);
  const today = istDayStart();
  const since = istDayStartOffset(-13); // 14 IST days including today
  const monthStart = istDayStartOffset(-29);
  const mine = { partnerId: partner.id };

  const [assignedToday, deliveredToday, pending, failedNow, failedToday, deliveredAll, earnToday, earnMonth, earnAll, recentDelivered, recentFailed] = await Promise.all([
    prisma.deliveryAssignment.count({ where: { ...mine, assignedAt: { gte: today } } }),
    prisma.deliveryAssignment.count({ where: { ...mine, status: 'DELIVERED', deliveredAt: { gte: today } } }),
    prisma.deliveryAssignment.count({ where: { ...mine, status: { in: ['ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'OUT_FOR_DELIVERY'] } } }),
    prisma.deliveryAssignment.count({ where: { ...mine, status: 'FAILED' } }),
    prisma.deliveryStatusHistory.count({ where: { status: 'FAILED', createdAt: { gte: today }, assignment: mine } }),
    prisma.deliveryAssignment.count({ where: { ...mine, status: 'DELIVERED' } }),
    prisma.deliveryAssignment.aggregate({ where: { ...mine, status: 'DELIVERED', deliveredAt: { gte: today } }, _sum: { payoutAmount: true } }),
    prisma.deliveryAssignment.aggregate({ where: { ...mine, status: 'DELIVERED', deliveredAt: { gte: monthStart } }, _sum: { payoutAmount: true } }),
    prisma.deliveryAssignment.aggregate({ where: { ...mine, status: 'DELIVERED' }, _sum: { payoutAmount: true } }),
    prisma.deliveryAssignment.findMany({ where: { ...mine, status: 'DELIVERED', deliveredAt: { gte: since } }, select: { deliveredAt: true, pickedUpAt: true } }),
    prisma.deliveryStatusHistory.findMany({ where: { status: 'FAILED', createdAt: { gte: since }, assignment: mine }, select: { createdAt: true } }),
  ]);

  // Per-day performance for the last 14 IST days, zero-filled so the chart has no gaps.
  const days = new Map<string, { date: string; delivered: number; failed: number }>();
  for (let i = 13; i >= 0; i--) {
    const key = istDateKey(istDayStartOffset(-i));
    days.set(key, { date: key, delivered: 0, failed: 0 });
  }
  for (const d of recentDelivered) if (d.deliveredAt) days.get(istDateKey(d.deliveredAt))!.delivered += 1;
  for (const f of recentFailed) days.get(istDateKey(f.createdAt))!.failed += 1;

  const timed = recentDelivered.filter((d) => d.deliveredAt && d.pickedUpAt && d.deliveredAt >= monthStart);
  const avgMinutes = timed.length ? Math.round(timed.reduce((n, d) => n + (d.deliveredAt!.getTime() - d.pickedUpAt!.getTime()) / 60_000, 0) / timed.length) : null;

  return {
    today: { assigned: assignedToday, delivered: deliveredToday, failed: failedToday },
    pending,
    failedAwaitingAction: failedNow,
    deliveredAllTime: deliveredAll,
    averageMinutesPickupToDoor: avgMinutes,
    earnings: {
      ratePerDelivery: partner.perDeliveryPayout,
      today: earnToday._sum.payoutAmount ?? 0,
      last30Days: earnMonth._sum.payoutAmount ?? 0,
      allTime: earnAll._sum.payoutAmount ?? 0,
    },
    performance: [...days.values()],
  };
}
