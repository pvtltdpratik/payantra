import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { istDateKey, istDayStart, istDayStartOffset, parseIstDate } from '../../lib/time.js';

const MAX_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const rangeQuery = z.object({ from: dateStr.optional(), to: dateStr.optional() });

export interface Range {
  /** Inclusive start (00:00 IST of the first day), as a UTC instant. */
  from: Date;
  /** EXCLUSIVE end (00:00 IST of the day after the last day). */
  to: Date;
  fromKey: string;
  /** The last day included. */
  toKey: string;
  days: number;
}

/**
 * A reporting window, in India's calendar days and inclusive of both ends ("2026-10-01" to "2026-10-07" is seven
 * days). Defaults to the last 30 days including today.
 */
export function resolveRange(q: { from?: string; to?: string }, now = new Date()): Range {
  const last = q.to ? parseIstDate(q.to) : istDayStart(now);
  const first = q.from ? parseIstDate(q.from) : last ? new Date(last.getTime() - 29 * DAY_MS) : null;
  if (!last || !first) throw AppError.badRequest('That is not a valid date');
  if (first > last) throw AppError.badRequest('"from" must not be after "to"');
  const days = Math.round((last.getTime() - first.getTime()) / DAY_MS) + 1;
  if (days > MAX_DAYS) throw AppError.badRequest(`Choose a range of at most ${MAX_DAYS} days`);
  const to = new Date(last.getTime() + DAY_MS);
  return { from: first, to, fromKey: istDateKey(first), toKey: istDateKey(last), days };
}

/** The window of the same length immediately before `r`, for "vs previous period" comparisons. */
export function previousRange(r: Range): Range {
  const length = r.days * DAY_MS;
  const from = new Date(r.from.getTime() - length);
  const to = r.from;
  return { from, to, fromKey: istDateKey(from), toKey: istDateKey(new Date(to.getTime() - DAY_MS)), days: r.days };
}

/** Every IST date key in the range, so charts have no gaps on quiet days. */
export function dayKeys(r: Range): string[] {
  return Array.from({ length: r.days }, (_, i) => istDateKey(new Date(r.from.getTime() + i * DAY_MS)));
}

export { istDayStartOffset };
