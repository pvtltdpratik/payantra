/**
 * "Today", "this week" and "per day" mean India's calendar day, not the server's. IST is a fixed UTC+05:30
 * offset (India has no daylight saving), so plain arithmetic is exact and needs no time-zone database.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant today's IST day began (00:00 IST), as a UTC Date. */
export function istDayStart(at: Date = new Date()): Date {
  const shifted = at.getTime() + IST_OFFSET_MS;
  return new Date(Math.floor(shifted / DAY_MS) * DAY_MS - IST_OFFSET_MS);
}

/** Start of the IST day `days` days from the one containing `at` (negative = earlier). */
export function istDayStartOffset(days: number, at: Date = new Date()): Date {
  return new Date(istDayStart(at).getTime() + days * DAY_MS);
}

/** "2026-10-17" — the IST calendar date of an instant. */
export function istDateKey(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Parses "YYYY-MM-DD" as the start of that IST day. Returns null for anything that is not a real date. */
export function parseIstDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const utc = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(utc)) return null;
  // Date.parse accepts 2026-02-31 by rolling over; reject that.
  if (new Date(utc).toISOString().slice(0, 10) !== value) return null;
  return new Date(utc - IST_OFFSET_MS);
}

/** "2026-10-17 14:05" — an instant as India's wall clock, for reports and CSV files. */
export function istDateTimeString(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
}
