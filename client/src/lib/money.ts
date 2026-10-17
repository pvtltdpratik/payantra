/**
 * Rupees <-> paise without floating point. "1499.50" → 149950, never 149949.99999.
 * Returns null for anything that is not a plain non-negative amount with at most 2 decimals.
 */
export function rupeesToPaise(input: string): number | null {
  const s = input.trim().replace(/,/g, "");
  const m = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const paise = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
  return Number.isSafeInteger(paise) ? paise : null;
}

export function paiseToRupees(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "";
  const rupees = Math.floor(paise / 100);
  const rem = paise % 100;
  return rem === 0 ? String(rupees) : `${rupees}.${String(rem).padStart(2, "0")}`;
}
