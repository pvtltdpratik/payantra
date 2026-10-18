/**
 * Scrubbing for anything that leaves the process as a log line or an error report.
 *
 * Two independent nets, because neither is enough alone:
 *  - by KEY: a field called `password`, `authorization`, `razorpay_signature`… is replaced whatever it holds;
 *  - by SHAPE: an e-mail address, a JWT, a bearer token or a card number inside any string is replaced,
 *    which catches the ones that arrive inside an error message ("Unique constraint failed on bob@x.in").
 */
const REDACTED = '[redacted]';

/** Field names whose value is never logged. Matched case-insensitively against the whole key. */
const SENSITIVE_KEY =
  /^(authorization|cookie|set-cookie|proxy-authorization|password|passwd|pwd|secret|token|access_?token|refresh_?token|id_?token|api_?key|apikey|x-api-key|x-razorpay-signature|razorpay_signature|signature|otp|cvv|cvc|card_?number|card|aadhaar|phone|mobile|email|dsn|.*(secret|password|token)$)$/i;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const CARD_CANDIDATE = /\b\d(?:[ -]?\d){12,18}\b/g;
/** Razorpay secrets and Supabase keys, should one ever appear in free text. */
const KEYLIKE = /\b(?:rzp_(?:live|test)_[A-Za-z0-9]{6,}|sb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}|whsec_[A-Za-z0-9]{8,})\b/g;

/** Luhn check, so that an order number or a timestamp is not mistaken for a card number. */
export function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function scrubString(input: string): string {
  return input
    .replace(JWT, '[redacted-jwt]')
    .replace(BEARER, '$1 [redacted]')
    .replace(KEYLIKE, '[redacted-key]')
    .replace(EMAIL, '[redacted-email]')
    .replace(CARD_CANDIDATE, (m) => {
      const digits = m.replace(/[ -]/g, '');
      return digits.length >= 13 && digits.length <= 19 && passesLuhn(digits) ? '[redacted-card]' : m;
    });
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/** Deep copy with sensitive keys blanked and every string scrubbed. Cycle- and depth-safe; never throws. */
export function scrubDeep<T>(value: T, depth = 0, seen = new WeakSet<object>()): T {
  if (typeof value === 'string') return scrubString(value) as T;
  if (value === null || typeof value !== 'object') return value;
  if (depth > 6) return '[truncated]' as T;
  if (seen.has(value as object)) return '[circular]' as T;
  seen.add(value as object);

  if (value instanceof Error) {
    const copy: Record<string, unknown> = { type: value.name, message: scrubString(value.message) };
    if (value.stack) copy.stack = scrubString(value.stack);
    const code = (value as { code?: unknown }).code;
    if (typeof code === 'string') copy.code = code;
    return copy as T;
  }
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1, seen)) as T;
  if (value instanceof Date || Buffer.isBuffer(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k) ? REDACTED : scrubDeep(v, depth + 1, seen);
  }
  return out as T;
}
