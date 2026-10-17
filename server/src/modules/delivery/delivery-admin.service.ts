import type { Request } from 'express';
import { prisma, type Prisma } from '../../config/prisma.js';
import { audit } from '../../lib/audit.js';
import { MAX_OTP_ATTEMPTS, OTP_TTL_MS } from '../../lib/deliveryOtp.js';
import { AppError } from '../../lib/errors.js';
import { notify } from '../../lib/notify.js';
import { pageMeta, toSkipTake } from '../../lib/pagination.js';
import { lockOrder } from '../orders/order-lifecycle.js';
import { getSettings } from '../settings/settings.service.js';
import { logDelivery } from './delivery.service.js';

type Tx = Prisma.TransactionClient;

const userSelect = { id: true, fullName: true, email: true, phone: true, role: true, status: true } as const;

// ───────────────────────── Partner applications and accounts ─────────────────────────

export async function listPartners(q: { page: number; pageSize: number; status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED'; q?: string }) {
  const search = q.q?.trim();
  const where: Prisma.DeliveryPartnerWhereInput = {
    ...(q.status ? { status: q.status } : {}),
    ...(search
      ? {
          OR: [
            { user: { fullName: { contains: search, mode: 'insensitive' } } },
            { user: { email: { contains: search, mode: 'insensitive' } } },
            { user: { phone: { contains: search } } },
            { serviceCity: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.deliveryPartner.count({ where }),
    // Applications waiting for a decision come first, then the newest.
    prisma.deliveryPartner.findMany({ where, include: { user: { select: userSelect } }, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], ...toSkipTake(q) }),
  ]);

  const counts = rows.length
    ? await prisma.deliveryAssignment.groupBy({ by: ['partnerId', 'status'], where: { partnerId: { in: rows.map((r) => r.id) } }, _count: { _all: true } })
    : [];
  const tally = (partnerId: string, statuses: string[]) => counts.filter((c) => c.partnerId === partnerId && statuses.includes(c.status)).reduce((n, c) => n + c._count._all, 0);

  return {
    items: rows.map((p) => ({
      id: p.id,
      status: p.status,
      isOnline: p.isOnline,
      serviceCity: p.serviceCity,
      vehicleType: p.vehicleType,
      perDeliveryPayout: p.perDeliveryPayout,
      createdAt: p.createdAt,
      user: p.user,
      active: tally(p.id, ['ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'OUT_FOR_DELIVERY']),
      delivered: tally(p.id, ['DELIVERED']),
      failed: tally(p.id, ['FAILED']),
    })),
    meta: pageMeta(q, total),
  };
}

export async function getPartner(id: string) {
  const p = await prisma.deliveryPartner.findUnique({ where: { id }, include: { user: { select: userSelect } } });
  if (!p) throw AppError.notFound('Delivery partner not found');

  const [byStatus, earnings, recent] = await Promise.all([
    prisma.deliveryAssignment.groupBy({ by: ['status'], where: { partnerId: id }, _count: { _all: true } }),
    prisma.deliveryAssignment.aggregate({ where: { partnerId: id, status: 'DELIVERED' }, _sum: { payoutAmount: true } }),
    prisma.deliveryAssignment.findMany({
      where: { partnerId: id },
      orderBy: { assignedAt: 'desc' },
      take: 20,
      select: { id: true, status: true, assignedAt: true, deliveredAt: true, failureReason: true, payoutAmount: true, order: { select: { id: true, orderNumber: true, shipCity: true } } },
    }),
  ]);
  const count = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
  return {
    id: p.id,
    status: p.status,
    isOnline: p.isOnline,
    user: p.user,
    serviceCity: p.serviceCity,
    vehicleType: p.vehicleType,
    vehicleNumber: p.vehicleNumber,
    idDocumentType: p.idDocumentType,
    idDocumentRef: p.idDocumentRef,
    applicationNote: p.applicationNote,
    rejectionReason: p.rejectionReason,
    perDeliveryPayout: p.perDeliveryPayout,
    approvedAt: p.approvedAt,
    createdAt: p.createdAt,
    stats: {
      delivered: count('DELIVERED'),
      failed: count('FAILED'),
      returnedToOrigin: count('RETURNED_TO_ORIGIN'),
      rejected: count('REJECTED'),
      inProgress: count('ASSIGNED') + count('ACCEPTED') + count('PICKED_UP') + count('OUT_FOR_DELIVERY'),
      earningsAllTime: earnings._sum.payoutAmount ?? 0,
    },
    recent: recent.map(({ order, ...r }) => ({ ...r, orderId: order.id, orderNumber: order.orderNumber, city: order.shipCity })),
  };
}

interface Decision {
  action: 'approve' | 'reject' | 'suspend' | 'reactivate' | 'update';
  reason?: string;
  perDeliveryPayout?: number;
}

/** The only way a delivery partner becomes active: an administrator approves them. */
export async function decide(req: Request, id: string, d: Decision) {
  const settings = await getSettings();
  await prisma.$transaction(async (tx) => {
    const p = await tx.deliveryPartner.findUnique({ where: { id }, include: { user: { select: { id: true, role: true, fullName: true } } } });
    if (!p) throw AppError.notFound('Delivery partner not found');
    const name = p.user.fullName ?? 'Delivery partner';
    const actor = req.user!.id;
    const bad = (msg: string) => AppError.conflict(msg);

    switch (d.action) {
      case 'approve': {
        if (p.status !== 'PENDING' && p.status !== 'REJECTED') throw bad(`A ${p.status.toLowerCase()} application cannot be approved`);
        if (p.user.role === 'ADMIN') throw bad('An administrator cannot become a delivery partner');
        await tx.deliveryPartner.update({
          where: { id },
          data: { status: 'APPROVED', approvedById: actor, approvedAt: new Date(), rejectionReason: null, perDeliveryPayout: d.perDeliveryPayout ?? p.perDeliveryPayout ?? settings.delivery.defaultPayout },
        });
        // Roles are granted server-side, by an admin, and nowhere else.
        await tx.profile.update({ where: { id: p.user.id }, data: { role: 'DELIVERY_PARTNER' } });
        await notify(tx, p.user.id, 'You are approved as a delivery partner', 'Go online from your delivery dashboard to start receiving deliveries.', '/delivery');
        break;
      }
      case 'reject': {
        if (p.status !== 'PENDING') throw bad('Only a pending application can be rejected');
        await tx.deliveryPartner.update({ where: { id }, data: { status: 'REJECTED', rejectionReason: d.reason } });
        await notify(tx, p.user.id, 'Your delivery partner application', `We couldn't approve it this time: ${d.reason}`, '/delivery/apply');
        break;
      }
      case 'suspend': {
        if (p.status !== 'APPROVED') throw bad('Only an active partner can be suspended');
        const inTransit = await tx.deliveryAssignment.count({ where: { partnerId: id, status: { in: ['PICKED_UP', 'OUT_FOR_DELIVERY'] } } });
        if (inTransit > 0) throw bad(`${name} has ${inTransit} parcel${inTransit === 1 ? '' : 's'} in transit. Resolve them before suspending.`);
        await tx.deliveryPartner.update({ where: { id }, data: { status: 'SUSPENDED', isOnline: false, rejectionReason: d.reason } });
        await notify(tx, p.user.id, 'Your delivery account is suspended', d.reason ?? '', '/delivery');
        break;
      }
      case 'reactivate': {
        if (p.status !== 'SUSPENDED') throw bad('Only a suspended partner can be reactivated');
        await tx.deliveryPartner.update({ where: { id }, data: { status: 'APPROVED', rejectionReason: null } });
        await tx.profile.update({ where: { id: p.user.id }, data: { role: 'DELIVERY_PARTNER' } });
        await notify(tx, p.user.id, 'Your delivery account is active again', '', '/delivery');
        break;
      }
      case 'update': {
        await tx.deliveryPartner.update({ where: { id }, data: { perDeliveryPayout: d.perDeliveryPayout } });
        break;
      }
    }
    await audit(tx, req, { action: `partner.${d.action}`, entityType: 'DeliveryPartner', entityId: id, metadata: { reason: d.reason ?? null, payout: d.perDeliveryPayout ?? null } });
  });
  return getPartner(id);
}

/** Partners an admin may give a delivery to, online ones first, with how much each is already carrying. */
export async function assignablePartners() {
  const rows = await prisma.deliveryPartner.findMany({
    where: { status: 'APPROVED', user: { role: 'DELIVERY_PARTNER', status: 'ACTIVE' } },
    include: { user: { select: { fullName: true, phone: true } }, _count: { select: { assignments: { where: { status: { in: ['ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'OUT_FOR_DELIVERY'] } } } } } },
    orderBy: [{ isOnline: 'desc' }, { createdAt: 'asc' }],
  });
  return rows.map((p) => ({ id: p.id, name: p.user.fullName, phone: p.user.phone, isOnline: p.isOnline, serviceCity: p.serviceCity, vehicleType: p.vehicleType, activeJobs: p._count.assignments }));
}

// ───────────────────────── Assigning deliveries ─────────────────────────

const REASSIGNABLE = ['ASSIGNED', 'ACCEPTED', 'REJECTED', 'FAILED'] as const;

export async function assign(req: Request, orderId: string, partnerId: string) {
  await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    const partner = await tx.deliveryPartner.findUnique({ where: { id: partnerId }, include: { user: { select: { id: true, fullName: true, role: true, status: true } } } });
    if (!partner) throw AppError.notFound('Delivery partner not found');
    if (partner.status !== 'APPROVED' || partner.user.role !== 'DELIVERY_PARTNER' || partner.user.status !== 'ACTIVE') {
      throw AppError.conflict('That delivery partner is not active');
    }
    if (!partner.isOnline) throw AppError.conflict(`${partner.user.fullName ?? 'That partner'} is offline`);

    const existing = await tx.deliveryAssignment.findUnique({ where: { orderId } });
    // A packed order is ready for pickup. After a failed attempt the parcel is "shipped" and may be handed to someone else.
    const ready = order.fulfilmentStatus === 'PACKED' || (order.fulfilmentStatus === 'SHIPPED' && existing?.status === 'FAILED');
    if (!ready) throw AppError.conflict('Only a packed order can be given to a delivery partner');
    if (existing && !REASSIGNABLE.includes(existing.status as (typeof REASSIGNABLE)[number])) {
      throw AppError.conflict(`This delivery is already ${existing.status.toLowerCase().replace(/_/g, ' ')}`);
    }
    if (existing?.partnerId === partnerId && (existing.status === 'ASSIGNED' || existing.status === 'ACCEPTED')) {
      throw AppError.conflict('This delivery is already assigned to that partner');
    }

    const fresh = { partnerId, status: 'ASSIGNED' as const, assignedById: req.user!.id, assignedAt: new Date(), acceptedAt: null, pickedUpAt: null, deliveredAt: null, failureReason: null, otpExpiresAt: null, otpAttempts: 0 };
    const row = existing
      ? await tx.deliveryAssignment.update({ where: { id: existing.id }, data: { ...fresh, otpEpoch: { increment: 1 } } })
      : await tx.deliveryAssignment.create({ data: { orderId, ...fresh } });

    await logDelivery(tx, row.id, 'ASSIGNED', `Assigned to ${partner.user.fullName ?? 'partner'}${existing ? ' (reassigned)' : ''}`, req.user!.id);
    await notify(tx, partner.user.id, `New delivery: ${order.orderNumber}`, `${order.shipCity}, ${order.shipPostalCode}. Open it to accept.`, `/delivery/orders/${row.id}`);
    // The previous partner, if any, is told the job moved on.
    if (existing && existing.partnerId !== partnerId) {
      const prev = await tx.deliveryPartner.findUnique({ where: { id: existing.partnerId }, select: { userId: true } });
      if (prev) await notify(tx, prev.userId, `Delivery reassigned: ${order.orderNumber}`, 'This delivery was given to another partner.', '/delivery');
    }
    await audit(tx, req, { action: 'delivery.assign', entityType: 'Order', entityId: orderId, metadata: { partnerId, reassigned: !!existing } });
  });
}

/** Takes the job back before the parcel has left (or after a failed attempt), so the order can be handled by hand again. */
export async function unassign(req: Request, orderId: string) {
  await prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const a = await tx.deliveryAssignment.findUnique({ where: { orderId }, include: { partner: { select: { userId: true } }, order: { select: { orderNumber: true } } } });
    if (!a) throw AppError.notFound('This order has no delivery assignment');
    if (!REASSIGNABLE.includes(a.status as (typeof REASSIGNABLE)[number])) {
      throw AppError.conflict(`A delivery that is ${a.status.toLowerCase().replace(/_/g, ' ')} cannot be unassigned`);
    }
    await tx.deliveryAssignment.delete({ where: { id: a.id } }); // history cascades
    if (a.status === 'ASSIGNED' || a.status === 'ACCEPTED') {
      await notify(tx, a.partner.userId, `Delivery withdrawn: ${a.order.orderNumber}`, 'This delivery is no longer assigned to you.', '/delivery');
    }
    await audit(tx, req, { action: 'delivery.unassign', entityType: 'Order', entityId: orderId, metadata: { was: a.status, partnerId: a.partnerId } });
  });
}

/** For a customer who lost their code, or a partner locked out by wrong guesses: a new code, a fresh set of attempts. */
export async function reissueCode(req: Request, orderId: string) {
  await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    const a = await tx.deliveryAssignment.findUnique({ where: { orderId } });
    if (!a || a.status !== 'OUT_FOR_DELIVERY') throw AppError.conflict('A delivery code exists only while the parcel is out for delivery');
    await tx.deliveryAssignment.update({ where: { id: a.id }, data: { otpEpoch: { increment: 1 }, otpAttempts: 0, otpExpiresAt: new Date(Date.now() + OTP_TTL_MS) } });
    await logDelivery(tx, a.id, 'OUT_FOR_DELIVERY', 'Delivery code reissued by admin', req.user!.id);
    await notify(tx, order.userId, `New delivery code for ${order.orderNumber}`, 'Open your order to see the new code.', `/account/orders/${order.id}`);
    await audit(tx, req, { action: 'delivery.reissue-code', entityType: 'Order', entityId: orderId });
  });
}

/** Everything an admin needs to know about an order's delivery (shown on the order page). */
export async function adminAssignmentView(db: Pick<Tx, 'deliveryAssignment'>, orderId: string) {
  const a = await db.deliveryAssignment.findUnique({
    where: { orderId },
    include: { partner: { include: { user: { select: { fullName: true, phone: true } } } }, history: { orderBy: { createdAt: 'asc' } } },
  });
  if (!a) return null;
  return {
    id: a.id,
    status: a.status,
    partner: { id: a.partnerId, name: a.partner.user.fullName, phone: a.partner.user.phone, vehicleType: a.partner.vehicleType, vehicleNumber: a.partner.vehicleNumber },
    assignedAt: a.assignedAt,
    acceptedAt: a.acceptedAt,
    pickedUpAt: a.pickedUpAt,
    deliveredAt: a.deliveredAt,
    failureReason: a.failureReason,
    notes: a.notes,
    otp: { attemptsLeft: Math.max(0, MAX_OTP_ATTEMPTS - a.otpAttempts), locked: a.otpAttempts >= MAX_OTP_ATTEMPTS, expiresAt: a.otpExpiresAt },
    payoutAmount: a.payoutAmount,
    history: a.history.map((h) => ({ status: h.status, reason: h.reason, at: h.createdAt })),
    canReassign: (REASSIGNABLE as readonly string[]).includes(a.status),
    canReissueCode: a.status === 'OUT_FOR_DELIVERY',
  };
}
