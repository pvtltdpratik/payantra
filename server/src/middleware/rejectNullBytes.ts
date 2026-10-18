import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';

/**
 * PostgreSQL text cannot contain a NUL (U+0000) character: the driver rejects it, and without this guard that
 * rejection surfaced as an HTTP 500 (and an error report) for something as small as `/search?q=%00`.
 * No legitimate input contains one, so every request that carries one is refused up front, in the path, the query
 * string or anywhere in a JSON body, rather than checking each field of each endpoint.
 */
const NUL_IN_URL = /%00|\0/i;

function hasNul(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return value.includes('\0');
  if (value === null || typeof value !== 'object' || depth > 20) return false;
  if (Array.isArray(value)) return value.some((v) => hasNul(v, depth + 1));
  return Object.entries(value).some(([k, v]) => k.includes('\0') || hasNul(v, depth + 1));
}

export const rejectNullBytes: RequestHandler = (req, _res, next) => {
  if (NUL_IN_URL.test(req.url) || hasNul(req.body)) return next(AppError.badRequest('Malformed request'));
  next();
};
