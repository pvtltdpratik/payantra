import { describe, expect, it } from 'vitest';
import {
  canTransition,
  DELIVERY_REASON_REQUIRED,
  DELIVERY_TRANSITIONS,
  FULFILMENT_TRANSITIONS,
  isCancellable,
} from '../lib/stateMachines.js';

describe('fulfilment transitions', () => {
  it('follows the happy path in order', () => {
    const path = [
      'PLACED',
      'PAYMENT_CONFIRMED',
      'PROCESSING',
      'PACKED',
      'SHIPPED',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
    ] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(FULFILMENT_TRANSITIONS, path[i], path[i + 1])).toBe(true);
    }
  });

  it('forbids skipping steps and moving backwards', () => {
    expect(canTransition(FULFILMENT_TRANSITIONS, 'PLACED', 'SHIPPED')).toBe(false);
    expect(canTransition(FULFILMENT_TRANSITIONS, 'PACKED', 'PROCESSING')).toBe(false);
    expect(canTransition(FULFILMENT_TRANSITIONS, 'DELIVERED', 'PLACED')).toBe(false);
  });

  it('treats CANCELLED and RETURNED as terminal', () => {
    expect(FULFILMENT_TRANSITIONS.CANCELLED).toHaveLength(0);
    expect(FULFILMENT_TRANSITIONS.RETURNED).toHaveLength(0);
  });

  it('allows cancellation only before shipping', () => {
    expect(isCancellable('PLACED')).toBe(true);
    expect(isCancellable('PACKED')).toBe(true);
    expect(isCancellable('SHIPPED')).toBe(false);
    expect(isCancellable('DELIVERED')).toBe(false);
  });
});

describe('delivery transitions', () => {
  it('follows Assigned → Accepted → Picked Up → Out for Delivery → Delivered', () => {
    expect(canTransition(DELIVERY_TRANSITIONS, 'ASSIGNED', 'ACCEPTED')).toBe(true);
    expect(canTransition(DELIVERY_TRANSITIONS, 'ACCEPTED', 'PICKED_UP')).toBe(true);
    expect(canTransition(DELIVERY_TRANSITIONS, 'PICKED_UP', 'OUT_FOR_DELIVERY')).toBe(true);
    expect(canTransition(DELIVERY_TRANSITIONS, 'OUT_FOR_DELIVERY', 'DELIVERED')).toBe(true);
  });

  it('cannot mark delivered without going out for delivery first', () => {
    expect(canTransition(DELIVERY_TRANSITIONS, 'ACCEPTED', 'DELIVERED')).toBe(false);
    expect(canTransition(DELIVERY_TRANSITIONS, 'ASSIGNED', 'DELIVERED')).toBe(false);
  });

  it('supports failed delivery retry and return to origin', () => {
    expect(canTransition(DELIVERY_TRANSITIONS, 'OUT_FOR_DELIVERY', 'FAILED')).toBe(true);
    expect(canTransition(DELIVERY_TRANSITIONS, 'FAILED', 'OUT_FOR_DELIVERY')).toBe(true);
    expect(canTransition(DELIVERY_TRANSITIONS, 'FAILED', 'RETURNED_TO_ORIGIN')).toBe(true);
  });

  it('makes DELIVERED final and requires reasons for negative outcomes', () => {
    expect(DELIVERY_TRANSITIONS.DELIVERED).toHaveLength(0);
    expect(DELIVERY_REASON_REQUIRED).toEqual(
      expect.arrayContaining(['REJECTED', 'FAILED', 'RETURNED_TO_ORIGIN']),
    );
  });
});
