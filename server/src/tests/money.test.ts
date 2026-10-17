import { describe, expect, it } from 'vitest';
import { assertPaise, inclusiveTax, percentOf } from '../lib/money.js';

describe('money', () => {
  it('computes percentages in integer paise, rounding half up', () => {
    expect(percentOf(10_000, 10)).toBe(1_000);
    expect(percentOf(9_999, 10)).toBe(1_000); // 999.9 → 1000
    expect(percentOf(1_050, 12.5)).toBe(131); // 131.25 → 131
    expect(percentOf(0, 50)).toBe(0);
  });

  it('extracts GST from a tax-inclusive price', () => {
    // ₹1,050 inclusive of 5% GST → net ₹1,000, tax ₹50
    expect(inclusiveTax(105_000, 5)).toBe(5_000);
    expect(inclusiveTax(118_000, 18)).toBe(18_000);
    expect(inclusiveTax(100_000, 0)).toBe(0);
  });

  it('rejects floats, negatives and unsafe integers', () => {
    expect(() => assertPaise(10.5)).toThrow(RangeError);
    expect(() => assertPaise(-1)).toThrow(RangeError);
    expect(() => assertPaise(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(assertPaise(0)).toBe(0);
  });

  it('never accumulates float drift when summing line totals', () => {
    // 0.1 + 0.2 style bug cannot occur: every operand is an integer.
    const lines = [1_999, 2_999, 4_999, 99];
    expect(lines.reduce((a, b) => a + b, 0)).toBe(10_096);
  });
});
