import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Delivery codes are DERIVED, not stored: HMAC-SHA256(secret, "assignmentId:epoch") reduced to six digits.
 *
 *  - the customer's order page can show the code (the server recomputes it for the owner),
 *  - the database never contains it, so a leaked backup or a stray SELECT reveals nothing usable,
 *  - bumping `otpEpoch` instantly invalidates the old code (a new attempt, or an admin reset).
 *
 * Guessing is bounded separately: the assignment counts wrong attempts and locks after MAX_OTP_ATTEMPTS.
 */
const DEV_SECRET = 'payantra-development-only-delivery-otp-secret';
const secret = () => env.DELIVERY_OTP_SECRET ?? DEV_SECRET;

export const MAX_OTP_ATTEMPTS = 5;
/** A code stays valid this long after the parcel goes out for delivery. */
export const OTP_TTL_MS = 12 * 60 * 60 * 1000;

export function deliveryCode(assignmentId: string, epoch: number): string {
  const mac = createHmac('sha256', secret()).update(`${assignmentId}:${epoch}`).digest();
  // 32 bits → six digits. The modulo bias (~0.02%) is irrelevant for a rate-limited code.
  return String(mac.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

/** Constant-time comparison; false for anything that is not exactly the expected code. */
export function codeMatches(assignmentId: string, epoch: number, submitted: string): boolean {
  const expected = Buffer.from(deliveryCode(assignmentId, epoch));
  const given = Buffer.from(submitted);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
