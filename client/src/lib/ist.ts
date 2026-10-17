/**
 * India has no daylight saving: IST is always UTC+05:30. Dashboard ranges are India calendar days
 * ("YYYY-MM-DD"), matching the API, so "today" must be India's today even when this code runs on a UTC server.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** India's calendar date for an instant. */
export function istDateKey(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Moves a "YYYY-MM-DD" key by whole days. */
export function addDays(key: string, days: number): string {
  return new Date(Date.parse(`${key}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function isDateKey(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00.000Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === value;
}

/** "17 Oct" for a date key. */
export function shortDate(key: string): string {
  return new Date(`${key}T00:00:00.000Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** A date range from the URL, falling back to the last `days` days ending today (India). Never throws on bad input. */
export function rangeFromParams(from: string | undefined, to: string | undefined, now: Date, days = 30): { from: string; to: string } {
  const today = istDateKey(now);
  let end = isDateKey(to) ? to : today;
  let start = isDateKey(from) ? from : addDays(end, -(days - 1));
  if (start > end) [start, end] = [end, start];
  // The API allows at most a year; clamp here so a typed-in range cannot produce an error page.
  if (Date.parse(end) - Date.parse(start) > 365 * 86_400_000) start = addDays(end, -365);
  return { from: start, to: end };
}
