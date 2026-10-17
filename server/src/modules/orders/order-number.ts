import { randomInt } from 'node:crypto';

// No 0/O, 1/I/L: order numbers are read aloud and typed from emails.
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

/**
 * PYN-YYMMDD-XXXXXX. The random suffix (≈ 7×10^8 combinations per day) keeps the volume of
 * orders unguessable; uniqueness is still enforced by the database, and callers retry on conflict.
 */
export function generateOrderNumber(now = new Date()): string {
  const yy = String(now.getUTCFullYear()).slice(2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += ALPHABET[randomInt(ALPHABET.length)];
  return `PYN-${yy}${mm}${dd}-${suffix}`;
}
