import { assertPaise, inclusiveTax, percentOf } from './money.js';

/**
 * The single source of truth for what a basket costs. Pure and deterministic: the cart view, the
 * checkout and the invoice all call this, so the number a shopper sees is the number they are charged.
 *
 * All amounts are integer paise and all catalogue prices are GST-INCLUSIVE (Indian retail MRP), so
 * tax is reported for the invoice but never added on top.
 */

/** Razorpay's minimum chargeable amount is ₹1. A coupon may never take the order below this. */
export const MIN_PAYABLE_PAISE = 100;

export interface PricingLine {
  variantId: string;
  /** Tax-inclusive price of one unit. */
  unitPrice: number;
  quantity: number;
  taxRatePercent: number;
}

export interface PricingCoupon {
  id: string;
  code: string;
  discountType: 'PERCENTAGE' | 'FLAT';
  /** Percent (1–100) for PERCENTAGE, paise for FLAT. */
  discountValue: number;
  /** Paise cap for PERCENTAGE coupons. */
  maxDiscount: number | null;
  minOrderValue: number;
}

export interface ShippingRule {
  /** Paise charged when the order is below the free-shipping threshold. */
  flatRate: number;
  /** Paise of (post-discount) merchandise at which shipping becomes free. 0 = always free. */
  freeThreshold: number;
}

export interface PricedLine extends PricingLine {
  lineTotal: number;
  /** This line's share of the order-level discount. */
  discount: number;
  /** GST contained in (lineTotal − discount). */
  tax: number;
}

export interface PricingResult {
  lines: PricedLine[];
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  /** GST contained in the amount paid; informational (already inside the prices). */
  taxTotal: number;
  grandTotal: number;
  couponApplied: boolean;
  /** Why a supplied coupon had no effect, when it had none. */
  couponNote: string | null;
}

/**
 * Splits `total` across `weights` so the parts always sum to exactly `total`
 * (largest-remainder method; ties go to the earlier line, so the result is deterministic).
 */
export function allocateProportionally(total: number, weights: number[]): number[] {
  assertPaise(total, 'allocation total');
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0 || total === 0) return weights.map(() => 0);

  const exact = weights.map((w) => (total * w) / sum);
  const floors = exact.map(Math.floor);
  let remainder = total - floors.reduce((a, b) => a + b, 0);

  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return floors;
}

export function computePricing(
  lines: PricingLine[],
  coupon: PricingCoupon | null,
  shipping: ShippingRule,
): PricingResult {
  if (lines.length === 0) throw new RangeError('Cannot price an empty basket');
  for (const l of lines) {
    assertPaise(l.unitPrice, 'unitPrice');
    if (!Number.isInteger(l.quantity) || l.quantity < 1) throw new RangeError(`Invalid quantity for ${l.variantId}`);
  }

  const lineTotals = lines.map((l) => l.unitPrice * l.quantity);
  const subtotal = lineTotals.reduce((a, b) => a + b, 0);

  let discountTotal = 0;
  let couponNote: string | null = null;
  if (coupon) {
    if (subtotal < coupon.minOrderValue) {
      couponNote = `Add items worth ₹${((coupon.minOrderValue - subtotal) / 100).toFixed(2).replace(/\.00$/, '')} more to use ${coupon.code}`;
    } else {
      const raw =
        coupon.discountType === 'PERCENTAGE'
          ? Math.min(percentOf(subtotal, coupon.discountValue), coupon.maxDiscount ?? Number.MAX_SAFE_INTEGER)
          : coupon.discountValue;
      // Never discount below the minimum chargeable amount.
      discountTotal = Math.max(0, Math.min(raw, subtotal - MIN_PAYABLE_PAISE));
    }
  }

  const shares = allocateProportionally(discountTotal, lineTotals);
  const priced: PricedLine[] = lines.map((l, i) => ({
    ...l,
    lineTotal: lineTotals[i],
    discount: shares[i],
    tax: inclusiveTax(lineTotals[i] - shares[i], l.taxRatePercent),
  }));

  const merchandise = subtotal - discountTotal;
  const shippingTotal = merchandise >= shipping.freeThreshold ? 0 : shipping.flatRate;
  const grandTotal = merchandise + shippingTotal;

  return {
    lines: priced,
    subtotal,
    discountTotal,
    shippingTotal,
    taxTotal: priced.reduce((a, l) => a + l.tax, 0),
    grandTotal,
    couponApplied: discountTotal > 0,
    couponNote,
  };
}
