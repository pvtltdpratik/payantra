import { z } from 'zod';
import { paginationQuery } from '../../lib/pagination.js';

const text = (max: number) => z.string().trim().max(max);
const mobile = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number');

/** A person applying to deliver. Document fields are REFERENCES (type + last digits), never full ID numbers. */
export const applyBody = z
  .object({
    fullName: text(100).min(2),
    phone: mobile,
    vehicleType: text(40).optional(),
    vehicleNumber: text(20).optional(),
    serviceCity: text(80).min(2),
    idDocumentType: text(40).optional(),
    idDocumentRef: text(80).optional(),
    applicationNote: text(500).optional(),
  })
  .strict();

export const partnerProfileBody = z
  .object({
    vehicleType: text(40).optional(),
    vehicleNumber: text(20).optional(),
    serviceCity: text(80).min(2).optional(),
    phone: mobile.optional(),
  })
  .strict();

export const availabilityBody = z.object({ isOnline: z.boolean() }).strict();

export const PARTNER_STATUSES = ['ACCEPTED', 'REJECTED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'RETURNED_TO_ORIGIN'] as const;
export type PartnerTargetStatus = (typeof PARTNER_STATUSES)[number];

/** Reasons a delivery attempt can fail; "OTHER" needs notes. Kept short so a rider can pick one in a tap. */
export const FAILURE_REASONS = [
  'Customer not available',
  'Customer unreachable by phone',
  'Address not found',
  'Customer refused the order',
  'Customer asked to reschedule',
  'Payment (cash) not available',
  'Other',
] as const;

export const statusBody = z
  .object({
    status: z.enum(PARTNER_STATUSES),
    reason: text(200).optional(),
    notes: text(500).optional(),
    code: z.string().trim().regex(/^\d{6}$/, 'The delivery code is 6 digits').optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (['REJECTED', 'FAILED', 'RETURNED_TO_ORIGIN'].includes(v.status) && !(v.reason && v.reason.length >= 3)) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'A reason is required' });
    }
    if (v.status === 'DELIVERED' && !v.code) {
      ctx.addIssue({ code: 'custom', path: ['code'], message: 'Ask the customer for their 6-digit delivery code' });
    }
    if (v.status === 'FAILED' && v.reason === 'Other' && !(v.notes && v.notes.length >= 3)) {
      ctx.addIssue({ code: 'custom', path: ['notes'], message: 'Tell us what happened' });
    }
  });

export const assignmentListQuery = paginationQuery.extend({
  view: z.enum(['active', 'history']).default('active'),
});

// ── Admin ──

export const partnerListQuery = paginationQuery.extend({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']).optional(),
  q: z.string().trim().max(100).optional(),
});

const paise = z.number().int().min(0).max(100_000_00);

export const partnerDecisionBody = z
  .object({
    action: z.enum(['approve', 'reject', 'suspend', 'reactivate', 'update']),
    reason: text(300).optional(),
    perDeliveryPayout: paise.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.action === 'reject' || v.action === 'suspend') && !(v.reason && v.reason.length >= 3)) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'A reason is required' });
    }
    if (v.action === 'update' && v.perDeliveryPayout === undefined) {
      ctx.addIssue({ code: 'custom', path: ['perDeliveryPayout'], message: 'Nothing to update' });
    }
  });

export const assignBody = z.object({ partnerId: z.string().uuid() }).strict();
