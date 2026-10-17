/**
 * All currency in Payantra is an integer number of paise (1 INR = 100 paise).
 * These helpers keep arithmetic in integers and round exactly once, in one place.
 */

export function assertPaise(value: number, label = 'amount'): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer number of paise, got ${value}`);
  }
  return value;
}

/** Percentage of an amount, rounded half-up to the nearest paisa. `percent` may have 2 decimals. */
export function percentOf(amountPaise: number, percent: number): number {
  assertPaise(amountPaise);
  // Work in basis points (percent * 100) so that 2-decimal percentages stay integral.
  const basisPoints = Math.round(percent * 100);
  return Math.round((amountPaise * basisPoints) / 10_000);
}

/**
 * Tax contained inside a tax-inclusive price (Indian retail MRP is tax-inclusive).
 * tax = gross - gross / (1 + rate)
 */
export function inclusiveTax(grossPaise: number, ratePercent: number): number {
  assertPaise(grossPaise);
  const basisPoints = Math.round(ratePercent * 100);
  const net = Math.round((grossPaise * 10_000) / (10_000 + basisPoints));
  return grossPaise - net;
}

export function formatINR(paise: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);
}
