import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';

const base = { standardHeaders: 'draft-7', legacyHeaders: false } as const;

const body = (message: string) => ({
  success: false,
  error: { code: 'RATE_LIMITED', message },
});

/** Generous global ceiling to blunt scraping and accidental loops. */
export const globalLimiter = rateLimit({
  ...base,
  windowMs: 60_000,
  limit: env.RATE_LIMIT_MAX,
  message: body('Too many requests, please slow down'),
});

/** Strict limiter for sensitive flows (checkout, coupon guessing, refunds, role changes). */
export const sensitiveLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60_000,
  limit: env.RATE_LIMIT_SENSITIVE_MAX,
  message: body('Too many attempts, please try again later'),
});
