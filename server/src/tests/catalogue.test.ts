import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { prisma } from '../config/prisma.js';
import { makeCategory, makeProduct, resetDb } from './helpers.js';

const app = createApp();
const get = (path: string) => request(app).get(`/api/v1${path}`);

let sarees: Awaited<ReturnType<typeof makeCategory>>;
let silk: Awaited<ReturnType<typeof makeCategory>>;
let kurtas: Awaited<ReturnType<typeof makeCategory>>;

beforeAll(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
  sarees = await makeCategory('Sarees', { gender: 'WOMEN' });
  silk = await makeCategory('Silk Sarees', { parentId: sarees.id, gender: 'WOMEN' });
  kurtas = await makeCategory("Men's Kurtas", { gender: 'MEN' });
});

const names = (res: request.Response) => (res.body.data as { name: string }[]).map((p) => p.name);

describe('visibility', () => {
  it('only shows ACTIVE products in active categories', async () => {
    const hidden = await makeCategory('Hidden', { isActive: false });
    await makeProduct({ name: 'Live', categoryId: sarees.id });
    await makeProduct({ name: 'Draft', categoryId: sarees.id, status: 'DRAFT' });
    await makeProduct({ name: 'Archived', categoryId: sarees.id, status: 'ARCHIVED' });
    await makeProduct({ name: 'In Hidden Category', categoryId: hidden.id });

    const res = await get('/products');
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['Live']);
  });

  it('returns 404 for a draft product detail', async () => {
    const draft = await makeProduct({ name: 'Draft', categoryId: sarees.id, status: 'DRAFT' });
    const res = await get(`/products/${draft.slug}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('filters', () => {
  it('includes sub-category products when filtering by a parent category', async () => {
    await makeProduct({ name: 'Banarasi', categoryId: silk.id });
    await makeProduct({ name: 'Plain Saree', categoryId: sarees.id });
    await makeProduct({ name: 'Kurta', categoryId: kurtas.id, gender: 'MEN' });

    const parent = await get(`/products?category=${sarees.slug}`);
    expect(names(parent).sort()).toEqual(['Banarasi', 'Plain Saree']);

    const child = await get(`/products?category=${silk.slug}`);
    expect(names(child)).toEqual(['Banarasi']);
  });

  it('returns an empty page, not an error, for an unknown category', async () => {
    await makeProduct({ name: 'Banarasi', categoryId: silk.id });
    const res = await get('/products?category=does-not-exist');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.total).toBe(0);
  });

  it('filters by gender and keeps unisex items in both', async () => {
    await makeProduct({ name: 'Women Only', categoryId: sarees.id, gender: 'WOMEN' });
    await makeProduct({ name: 'Men Only', categoryId: kurtas.id, gender: 'MEN' });
    await makeProduct({ name: 'Shared Wallet', categoryId: kurtas.id, gender: 'UNISEX' });

    expect(names(await get('/products?gender=WOMEN')).sort()).toEqual(['Shared Wallet', 'Women Only']);
    expect(names(await get('/products?gender=MEN')).sort()).toEqual(['Men Only', 'Shared Wallet']);
  });

  it('filters on the effective (sale-aware) price in paise', async () => {
    await makeProduct({ name: 'Cheap', categoryId: sarees.id, basePrice: 100_000 });
    await makeProduct({ name: 'Mid on sale', categoryId: sarees.id, basePrice: 400_000, salePrice: 250_000 });
    await makeProduct({ name: 'Pricey', categoryId: sarees.id, basePrice: 900_000 });

    expect(names(await get('/products?minPrice=200000&maxPrice=300000'))).toEqual(['Mid on sale']);
    expect(names(await get('/products?maxPrice=100000'))).toEqual(['Cheap']);
  });

  it('requires size and colour to match on the SAME variant', async () => {
    await makeProduct({
      name: 'Red M, Blue L',
      categoryId: sarees.id,
      variants: [
        { sku: 'A-RM', size: 'M', colour: 'Red' },
        { sku: 'A-BL', size: 'L', colour: 'Blue' },
      ],
    });
    await makeProduct({
      name: 'Blue M',
      categoryId: sarees.id,
      variants: [{ sku: 'B-BM', size: 'M', colour: 'Blue' }],
    });

    // Red exists, and M exists, but never together on "Red M, Blue L"'s *Blue* variant.
    expect(names(await get('/products?size=M&colour=Blue'))).toEqual(['Blue M']);
    expect(names(await get('/products?size=M&colour=Red'))).toEqual(['Red M, Blue L']);
  });

  it('accepts comma-separated and repeated multi-value filters, case-insensitively', async () => {
    await makeProduct({ name: 'Small', categoryId: sarees.id, variants: [{ sku: 'S1', size: 'S' }] });
    await makeProduct({ name: 'Large', categoryId: sarees.id, variants: [{ sku: 'L1', size: 'L' }] });
    await makeProduct({ name: 'XL', categoryId: sarees.id, variants: [{ sku: 'X1', size: 'XL' }] });

    expect(names(await get('/products?size=s,l')).sort()).toEqual(['Large', 'Small']);
    expect(names(await get('/products?size=S&size=XL')).sort()).toEqual(['Small', 'XL']);
  });

  it('inStock excludes products whose stock is entirely reserved or zero', async () => {
    await makeProduct({ name: 'Plenty', categoryId: sarees.id, variants: [{ sku: 'P1', onHand: 10 }] });
    await makeProduct({ name: 'All reserved', categoryId: sarees.id, variants: [{ sku: 'R1', onHand: 3, reserved: 3 }] });
    await makeProduct({ name: 'Sold out', categoryId: sarees.id, variants: [{ sku: 'Z1', onHand: 0 }] });
    await makeProduct({
      name: 'Inactive stock only',
      categoryId: sarees.id,
      variants: [{ sku: 'I1', onHand: 9, isActive: false }],
    });

    expect(names(await get('/products?inStock=true'))).toEqual(['Plenty']);
    expect((await get('/products')).body.meta.total).toBe(4);
  });

  it('filters by minimum rating and by featured / new flags', async () => {
    await makeProduct({ name: 'Loved', categoryId: sarees.id, ratingAverage: 4.6, isFeatured: true });
    await makeProduct({ name: 'Meh', categoryId: sarees.id, ratingAverage: 3.1, isNewArrival: true });

    expect(names(await get('/products?minRating=4'))).toEqual(['Loved']);
    expect(names(await get('/products?featured=true'))).toEqual(['Loved']);
    expect(names(await get('/products?newArrival=true'))).toEqual(['Meh']);
  });

  it('rejects an inverted price range and malformed input', async () => {
    expect((await get('/products?minPrice=500&maxPrice=100')).status).toBe(400);
    expect((await get('/products?gender=ROBOT')).status).toBe(400);
    expect((await get('/products?pageSize=1000')).status).toBe(400);
    expect((await get('/products?page=0')).status).toBe(400);
  });
});

describe('search', () => {
  beforeEach(async () => {
    await makeProduct({ name: 'Banarasi Silk Saree', categoryId: silk.id, fabric: 'Silk' });
    await makeProduct({ name: 'Cotton Kurti', categoryId: sarees.id, fabric: 'Cotton' });
  });

  it('matches name, fabric and category case-insensitively', async () => {
    expect(names(await get('/search?q=BANARASI'))).toEqual(['Banarasi Silk Saree']);
    expect(names(await get('/products?q=cotton'))).toEqual(['Cotton Kurti']);
    expect(names(await get('/products?q=silk sarees'))).toEqual(['Banarasi Silk Saree']);
  });

  it('returns suggestions for products and categories', async () => {
    const res = await get('/search/suggestions?q=sil');
    expect(res.status).toBe(200);
    expect(res.body.data.products.map((p: { name: string }) => p.name)).toEqual(['Banarasi Silk Saree']);
    expect(res.body.data.categories.map((c: { name: string }) => c.name)).toEqual(['Silk Sarees']);
  });

  it('requires at least 2 characters for suggestions', async () => {
    expect((await get('/search/suggestions?q=s')).status).toBe(400);
  });

  it('treats SQL metacharacters in the query as plain text', async () => {
    const res = await get(`/products?q=${encodeURIComponent("'; DROP TABLE \"Product\"; --")}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(await prisma.product.count()).toBe(2);
  });
});

describe('sorting and pagination', () => {
  beforeEach(async () => {
    await makeProduct({ name: 'A', categoryId: sarees.id, basePrice: 300_000, soldCount: 5, ratingAverage: 3.5, createdAt: new Date('2026-01-01') });
    await makeProduct({ name: 'B', categoryId: sarees.id, basePrice: 100_000, soldCount: 50, ratingAverage: 4.9, createdAt: new Date('2026-03-01') });
    await makeProduct({ name: 'C', categoryId: sarees.id, basePrice: 500_000, salePrice: 50_000, soldCount: 20, ratingAverage: 4.1, createdAt: new Date('2026-02-01') });
  });

  it.each([
    ['newest', ['B', 'C', 'A']],
    ['price_asc', ['C', 'B', 'A']], // C's sale price (500) is the lowest effective price
    ['price_desc', ['A', 'B', 'C']],
    ['popularity', ['B', 'C', 'A']],
    ['rating', ['B', 'C', 'A']],
  ])('sorts by %s', async (sort, expected) => {
    expect(names(await get(`/products?sort=${sort}`))).toEqual(expected);
  });

  it('paginates with accurate metadata', async () => {
    const p1 = await get('/products?sort=price_asc&pageSize=2&page=1');
    const p2 = await get('/products?sort=price_asc&pageSize=2&page=2');
    expect(names(p1)).toEqual(['C', 'B']);
    expect(names(p2)).toEqual(['A']);
    expect(p1.body.meta).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
  });
});

describe('product detail', () => {
  it('shows capped availability and status without leaking raw stock', async () => {
    const p = await makeProduct({
      name: 'Detail',
      categoryId: silk.id,
      basePrice: 200_000,
      salePrice: 150_000,
      variants: [
        { sku: 'D-S', size: 'S', colour: 'Red', onHand: 500 },
        { sku: 'D-M', size: 'M', colour: 'Red', onHand: 4, lowStockThreshold: 5 },
        { sku: 'D-L', size: 'L', colour: 'Red', onHand: 2, reserved: 2 },
      ],
      images: 3,
    });

    const res = await get(`/products/${p.slug}`);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.price).toBe(150_000);
    expect(d.discountPercent).toBe(25);
    expect(d.images).toHaveLength(3);
    expect(d.breadcrumb.map((b: { name: string }) => b.name)).toEqual(['Sarees', 'Silk Sarees']);

    const bySku = Object.fromEntries(d.variants.map((v: { sku: string }) => [v.sku, v]));
    expect(bySku['D-S']).toMatchObject({ available: 10, stockStatus: 'IN_STOCK' }); // capped at 10
    expect(bySku['D-M']).toMatchObject({ available: 4, stockStatus: 'LOW_STOCK' });
    expect(bySku['D-L']).toMatchObject({ available: 0, stockStatus: 'OUT_OF_STOCK' });
    expect(JSON.stringify(d)).not.toContain('onHand');
    expect(JSON.stringify(d)).not.toContain('reserved');
    expect(d.options.sizes.sort()).toEqual(['L', 'M', 'S']);
  });

  it('hides inactive variants', async () => {
    const p = await makeProduct({
      name: 'Partial',
      categoryId: sarees.id,
      variants: [
        { sku: 'P-1', size: 'S', isActive: true },
        { sku: 'P-2', size: 'M', isActive: false },
      ],
    });
    const res = await get(`/products/${p.slug}`);
    expect(res.body.data.variants.map((v: { sku: string }) => v.sku)).toEqual(['P-1']);
  });
});

describe('categories and facets', () => {
  it('builds a tree whose parent counts include descendants', async () => {
    await makeProduct({ name: 'One', categoryId: silk.id });
    await makeProduct({ name: 'Two', categoryId: silk.id });
    await makeProduct({ name: 'Three', categoryId: sarees.id });
    await makeProduct({ name: 'Draft', categoryId: sarees.id, status: 'DRAFT' });

    const res = await get('/categories');
    const root = res.body.data.find((c: { slug: string }) => c.slug === sarees.slug);
    expect(root.productCount).toBe(3);
    expect(root.children).toHaveLength(1);
    expect(root.children[0]).toMatchObject({ name: 'Silk Sarees', productCount: 2 });
  });

  it('returns a category with its breadcrumb', async () => {
    const res = await get(`/categories/${silk.slug}`);
    expect(res.body.data.breadcrumb.map((b: { name: string }) => b.name)).toEqual(['Sarees', 'Silk Sarees']);
    expect((await get('/categories/nope')).status).toBe(404);
  });

  it('computes facets scoped to a category', async () => {
    await makeProduct({
      name: 'Silk A',
      categoryId: silk.id,
      basePrice: 200_000,
      variants: [
        { sku: 'FA-1', size: 'M', colour: 'Red', fabric: 'Silk' },
        { sku: 'FA-2', size: 'S', colour: 'Blue', fabric: 'Silk' },
      ],
    });
    await makeProduct({
      name: 'Kurta',
      categoryId: kurtas.id,
      gender: 'MEN',
      basePrice: 50_000,
      variants: [{ sku: 'FK-1', size: 'XXL', colour: 'Green', fabric: 'Cotton' }],
    });

    const scoped = (await get(`/products/facets?category=${sarees.slug}`)).body.data;
    expect(scoped.sizes).toEqual(['S', 'M']);
    expect(scoped.colours).toEqual(['Blue', 'Red']);
    expect(scoped.price).toEqual({ min: 200_000, max: 200_000 });

    const all = (await get('/products/facets')).body.data;
    expect(all.sizes).toEqual(['S', 'M', 'XXL']);
    expect(all.price).toEqual({ min: 50_000, max: 200_000 });
  });
});
