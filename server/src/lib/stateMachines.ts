/**
 * Order and delivery status transition tables.
 * Pure data + one predicate so they can be unit tested and shared by every
 * dashboard — the single source of truth for "what may happen next".
 */

export type FulfilmentStatus =
  | 'PLACED'
  | 'PAYMENT_CONFIRMED'
  | 'PROCESSING'
  | 'PACKED'
  | 'SHIPPED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'RETURN_REQUESTED'
  | 'RETURNED';

export type DeliveryStatus =
  | 'ASSIGNED'
  | 'ACCEPTED'
  | 'PICKED_UP'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'FAILED'
  | 'RETURNED_TO_ORIGIN'
  | 'REJECTED';

export const FULFILMENT_TRANSITIONS: Record<FulfilmentStatus, readonly FulfilmentStatus[]> = {
  PLACED: ['PAYMENT_CONFIRMED', 'CANCELLED'],
  PAYMENT_CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['PACKED', 'CANCELLED'],
  PACKED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'SHIPPED'], // SHIPPED again after a failed attempt
  DELIVERED: ['RETURN_REQUESTED'],
  RETURN_REQUESTED: ['RETURNED', 'DELIVERED'], // DELIVERED = return rejected
  RETURNED: [],
  CANCELLED: [],
};

export const DELIVERY_TRANSITIONS: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  ASSIGNED: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: ['PICKED_UP'],
  PICKED_UP: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'FAILED'],
  FAILED: ['OUT_FOR_DELIVERY', 'RETURNED_TO_ORIGIN'],
  DELIVERED: [],
  RETURNED_TO_ORIGIN: [],
  REJECTED: [],
};

/** Delivery statuses where the partner must record a reason. */
export const DELIVERY_REASON_REQUIRED: readonly DeliveryStatus[] = [
  'REJECTED',
  'FAILED',
  'RETURNED_TO_ORIGIN',
];

export function canTransition<S extends string>(
  table: Record<S, readonly S[]>,
  from: S,
  to: S,
): boolean {
  return table[from]?.includes(to) ?? false;
}

/** Customers may self-cancel only before the parcel leaves the warehouse. */
export function isCancellable(status: FulfilmentStatus): boolean {
  return canTransition(FULFILMENT_TRANSITIONS, status, 'CANCELLED');
}
