import { describe, expect, it } from 'vitest';
import {
  allocateProportionally,
  computePricing,
  MIN_PAYABLE_PAISE,
  type PricingCoupon,
  type PricingLine,
  type ShippingRule,
} from '../lib/pricing.js';

const line = (unitPrice: number, quantity = 1, taxRatePercent = 5, variantId = 'v'): PricingLine => ({
  variantId,
  unitPrice,
  quantity,
  taxRatePercent,
});
const FREE_OVER_2999: ShippingRule = { flatRate: 9_900, freeThreshold: 299_900 };
const ALWAYS_FREE: ShippingRule = { flatRate: 0, freeThreshold: 0 };
const pct = (value: number, extra: Partial<PricingCoupon> = {}): PricingCoupon => ({
  id: 'c',
  code: 'SAVE',
  discountType: 'PERCENTAGE',
  discountValue: value,
  maxDiscount: null,
  minOrderValue: 0,
  ...extra,
});
const flat = (value: number, extra: Partial<PricingCoupon> = {}): PricingCoupon => pct(value, { discountType: 'FLAT', ...extra });

describe('allocateProportionally', () => {
  it('always sums to exactly the total, however awkward the split', () => {
    for (const [total, weights] of [
      [100, [1, 1, 1]],
      [1, [3, 3, 3]],
      [999, [149_900, 49_900, 12_300, 8_700]],
      [7, [0, 5, 0, 5]],
    ] as [number, number[]][]) {
      const parts = allocateProportionally(total, weights);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      parts.forEach((p, i) => weights[i] === 0 && expect(p).toBe(0));
    }
  });

  it('is deterministic: ties go to the earlier line', () => {
    expect(allocateProportionally(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });

  it('returns zeros for no discount or no weight', () => {
    expect(allocateProportionally(0, [5, 5])).toEqual([0, 0]);
    expect(allocateProportionally(10, [0, 0])).toEqual([0, 0]);
  });
});

describe('computePricing — totals', () => {
  it('prices a basket without a coupon and treats prices as tax-inclusive', () => {
    const r = computePricing([line(150_000, 2), line(50_000, 1)], null, ALWAYS_FREE);
    expect(r.subtotal).toBe(350_000);
    expect(r.discountTotal).toBe(0);
    expect(r.grandTotal).toBe(350_000); // GST is inside the price, never added on top
    expect(r.taxTotal).toBe(16_667); // 350000 - 350000/1.05, split across lines
    expect(r.couponApplied).toBe(false);
  });

  it('charges flat shipping below the free threshold and none at or above it', () => {
    expect(computePricing([line(100_000)], null, FREE_OVER_2999).shippingTotal).toBe(9_900);
    expect(computePricing([line(299_900)], null, FREE_OVER_2999).shippingTotal).toBe(0);
    expect(computePricing([line(299_899)], null, FREE_OVER_2999).shippingTotal).toBe(9_900);
  });

  it('judges free shipping on the amount AFTER the discount', () => {
    // ₹3,000 basket qualifies for free shipping, but a ₹500 coupon drops it under the threshold.
    const r = computePricing([line(300_000)], flat(50_000), FREE_OVER_2999);
    expect(r.discountTotal).toBe(50_000);
    expect(r.shippingTotal).toBe(9_900);
    expect(r.grandTotal).toBe(300_000 - 50_000 + 9_900);
  });

  it('keeps grandTotal = subtotal − discount + shipping (the DB CHECK constraint)', () => {
    for (const coupon of [null, pct(10), pct(33, { maxDiscount: 7_000 }), flat(12_345)]) {
      const r = computePricing([line(123_457, 3, 12), line(9_999, 7, 5)], coupon, FREE_OVER_2999);
      expect(r.grandTotal).toBe(r.subtotal - r.discountTotal + r.shippingTotal);
    }
  });
});

describe('computePricing — coupons', () => {
  it('applies a percentage discount rounded to whole paise', () => {
    expect(computePricing([line(99_999)], pct(10), ALWAYS_FREE).discountTotal).toBe(10_000); // 9999.9 → 10000
  });

  it('caps a percentage discount at maxDiscount', () => {
    const r = computePricing([line(1_000_000)], pct(50, { maxDiscount: 100_000 }), ALWAYS_FREE);
    expect(r.discountTotal).toBe(100_000);
  });

  it('applies a flat discount', () => {
    expect(computePricing([line(200_000)], flat(25_000), ALWAYS_FREE).discountTotal).toBe(25_000);
  });

  it('refuses a coupon below its minimum order value and says why', () => {
    const r = computePricing([line(100_000)], pct(20, { minOrderValue: 150_000, code: 'BIG20' }), ALWAYS_FREE);
    expect(r.discountTotal).toBe(0);
    expect(r.couponApplied).toBe(false);
    expect(r.couponNote).toBe('Add items worth ₹500 more to use BIG20');
  });

  it('never lets a coupon push the payable amount below ₹1', () => {
    const r = computePricing([line(50_000)], flat(80_000), ALWAYS_FREE);
    expect(r.discountTotal).toBe(50_000 - MIN_PAYABLE_PAISE);
    expect(r.grandTotal).toBe(MIN_PAYABLE_PAISE);
    expect(computePricing([line(50_000)], pct(100), ALWAYS_FREE).grandTotal).toBe(MIN_PAYABLE_PAISE);
  });

  it('allocates the discount across lines so line discounts sum to the total', () => {
    const r = computePricing([line(100_000, 1, 5, 'a'), line(33_333, 3, 12, 'b'), line(1, 1, 0, 'c')], pct(17), ALWAYS_FREE);
    expect(r.lines.reduce((a, l) => a + l.discount, 0)).toBe(r.discountTotal);
    // Tax is computed on what was actually paid for each line.
    for (const l of r.lines) expect(l.tax).toBeGreaterThanOrEqual(0);
  });

  it('reports less GST when a discount reduces the amount paid', () => {
    const full = computePricing([line(105_000)], null, ALWAYS_FREE).taxTotal;
    const discounted = computePricing([line(105_000)], flat(52_500), ALWAYS_FREE).taxTotal;
    expect(full).toBe(5_000);
    expect(discounted).toBe(2_500);
  });
});

describe('computePricing — input guards', () => {
  it('rejects an empty basket, fractional prices and bad quantities', () => {
    expect(() => computePricing([], null, ALWAYS_FREE)).toThrow(RangeError);
    expect(() => computePricing([line(10.5)], null, ALWAYS_FREE)).toThrow(RangeError);
    expect(() => computePricing([line(100, 0)], null, ALWAYS_FREE)).toThrow(RangeError);
    expect(() => computePricing([line(100, 1.5)], null, ALWAYS_FREE)).toThrow(RangeError);
    expect(() => computePricing([line(-100)], null, ALWAYS_FREE)).toThrow(RangeError);
  });
});
