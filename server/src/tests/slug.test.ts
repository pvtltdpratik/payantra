import { describe, expect, it } from 'vitest';
import { slugify, uniqueSlug } from '../lib/slug.js';

describe('slugify', () => {
  it('produces lowercase hyphenated ascii', () => {
    expect(slugify('Banarasi Silk Saree')).toBe('banarasi-silk-saree');
    expect(slugify("Men's Kurtas & Sets")).toBe('men-s-kurtas-and-sets');
  });

  it('strips accents and punctuation', () => {
    expect(slugify('Café  —  Crème!!')).toBe('cafe-creme');
  });

  it('never returns an empty slug', () => {
    expect(slugify('!!!')).toBe('item');
    expect(slugify('')).toBe('item');
  });

  it('caps length without leaving a trailing hyphen', () => {
    const s = slugify('a'.repeat(79) + ' b' + ' c'.repeat(20));
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s.endsWith('-')).toBe(false);
  });
});

describe('uniqueSlug', () => {
  it('returns the base when free', async () => {
    expect(await uniqueSlug('Silk Saree', async () => false)).toBe('silk-saree');
  });

  it('appends an incrementing suffix on collision', async () => {
    const taken = new Set(['silk-saree', 'silk-saree-2']);
    expect(await uniqueSlug('Silk Saree', async (s) => taken.has(s))).toBe('silk-saree-3');
  });
});
