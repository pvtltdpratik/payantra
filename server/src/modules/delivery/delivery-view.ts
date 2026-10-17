import type { Prisma } from '../../config/prisma.js';
import { deliveryCode, MAX_OTP_ATTEMPTS } from '../../lib/deliveryOtp.js';
import { DELIVERY_TRANSITIONS, type DeliveryStatus } from '../../lib/stateMachines.js';

/**
 * Who may see what about a delivery. These shapers are the privacy boundary: a route never returns a raw
 * assignment, so a field cannot leak because someone forgot to strip it.
 *
 *   customer  → the partner's first name, a phone number only while the parcel is out for delivery, and the
 *               delivery code (which they must read out to the partner)
 *   partner   → just enough to do the job: the area before accepting, the full address and the customer's phone
 *               while working it, and again only the area once finished. Never email, never prices.
 *   admin     → everything operational (see admin service)
 */

export const partnerAssignmentInclude = {
  order: { include: { items: { select: { productName: true, size: true, colour: true, quantity: true } } } },
  history: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.DeliveryAssignmentInclude;

type PartnerAssignment = Prisma.DeliveryAssignmentGetPayload<{ include: typeof partnerAssignmentInclude }>;

const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] || 'Your delivery partner';

type Visibility = 'area' | 'full' | 'closed';
const visibilityOf = (s: DeliveryStatus): Visibility => {
  if (s === 'ASSIGNED' || s === 'REJECTED') return 'area';
  if (s === 'DELIVERED' || s === 'RETURNED_TO_ORIGIN') return 'closed';
  return 'full';
};

/** The assignment as the delivery partner who owns it may see it. */
export function partnerAssignmentView(a: PartnerAssignment, now = new Date()) {
  const o = a.order;
  const visibility = visibilityOf(a.status);
  const full = visibility === 'full';
  const otpLive = a.status === 'OUT_FOR_DELIVERY';

  return {
    id: a.id,
    status: a.status,
    assignedAt: a.assignedAt,
    acceptedAt: a.acceptedAt,
    pickedUpAt: a.pickedUpAt,
    deliveredAt: a.deliveredAt,
    failureReason: a.failureReason,
    notes: a.notes,
    payoutAmount: a.status === 'DELIVERED' ? a.payoutAmount : null,
    nextStatuses: DELIVERY_TRANSITIONS[a.status],
    order: {
      orderNumber: o.orderNumber,
      paymentMethod: o.paymentMethod,
      // Cash to collect at the door. Prepaid orders collect nothing, and the partner never sees item prices.
      collectCash: o.paymentMethod === 'COD' && o.paymentStatus === 'PENDING' ? o.grandTotal : 0,
      itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
      items: visibility === 'area' ? [] : o.items.map((i) => ({ name: i.productName, size: i.size, colour: i.colour, quantity: i.quantity })),
    },
    address: {
      city: o.shipCity,
      state: o.shipState,
      postalCode: o.shipPostalCode,
      fullName: full ? o.shipFullName : null,
      line1: full ? o.shipLine1 : null,
      line2: full ? o.shipLine2 : null,
      landmark: full ? o.shipLandmark : null,
    },
    customerPhone: full ? o.shipPhone : null,
    otp: otpLive
      ? {
          attemptsLeft: Math.max(0, MAX_OTP_ATTEMPTS - a.otpAttempts),
          locked: a.otpAttempts >= MAX_OTP_ATTEMPTS,
          expired: !a.otpExpiresAt || a.otpExpiresAt <= now,
          expiresAt: a.otpExpiresAt,
        }
      : null,
    history: a.history.map((h) => ({ status: h.status, reason: h.reason, at: h.createdAt })),
  };
}

type CustomerAssignment = Pick<
  Prisma.DeliveryAssignmentGetPayload<{ include: { partner: { include: { user: { select: { fullName: true; phone: true } } } } } }>,
  'id' | 'status' | 'failureReason' | 'assignedAt' | 'otpEpoch' | 'otpExpiresAt' | 'otpAttempts' | 'partner'
>;

/** What the customer sees on their order page. The code is derived on demand and only for the owner. */
export function customerDeliveryView(a: CustomerAssignment | null | undefined, now = new Date()) {
  // A partner turning a job down is the shop's business, not the customer's.
  if (!a || a.status === 'REJECTED') return null;
  const out = a.status === 'OUT_FOR_DELIVERY';
  const locked = a.otpAttempts >= MAX_OTP_ATTEMPTS;
  const expired = !a.otpExpiresAt || a.otpExpiresAt <= now;
  const working = a.status !== 'ASSIGNED';
  return {
    status: a.status,
    partnerName: working ? firstName(a.partner.user.fullName) : null,
    partnerPhone: out ? a.partner.user.phone : null,
    failureReason: a.status === 'FAILED' ? a.failureReason : null,
    code: out && !locked && !expired ? deliveryCode(a.id, a.otpEpoch) : null,
    codeLocked: out && locked,
    codeExpired: out && expired && !locked,
  };
}
