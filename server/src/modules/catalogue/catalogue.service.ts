import { prisma, Prisma } from '../../config/prisma.js';
import { AppError } from '../../lib/errors.js';
import { pageMeta, toSkipTake } from '../../lib/pagination.js';
import type { ProductListQuery } from './catalogue.schema.js';

/** Public visibility rule, applied everywhere a shopper can see a product. */
const PUBLIC_PRODUCT: Prisma.ProductWhereInput = {
  status: 'ACTIVE',
  category: { isActive: true },
};

// ───────────────────────── Categories ─────────────────────────

export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  gender: string | null;
  productCount: number;
  children: CategoryNode[];
}

async function loadActiveCategories() {
  return prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      parentId: true,
      name: true,
      slug: true,
      description: true,
      imageUrl: true,
      gender: true,
      _count: { select: { products: { where: { status: 'ACTIVE' } } } },
    },
  });
}

export async function getCategoryTree(): Promise<CategoryNode[]> {
  const rows = await loadActiveCategories();
  const nodes = new Map<string, CategoryNode>();
  for (const r of rows) {
    nodes.set(r.id, {
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      imageUrl: r.imageUrl,
      gender: r.gender,
      productCount: r._count.products,
      children: [],
    });
  }
  const roots: CategoryNode[] = [];
  for (const r of rows) {
    const node = nodes.get(r.id)!;
    const parent = r.parentId ? nodes.get(r.parentId) : undefined;
    // A child of an inactive parent is promoted to a root rather than silently disappearing.
    (parent ? parent.children : roots).push(node);
  }
  // A parent's count includes its descendants so "Sarees" reflects "Silk Sarees".
  const total = (n: CategoryNode): number => {
    n.productCount += n.children.reduce((sum, c) => sum + total(c), 0);
    return n.productCount;
  };
  roots.forEach(total);
  return roots;
}

export async function getCategoryBySlug(slug: string) {
  const rows = await loadActiveCategories();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const current = rows.find((r) => r.slug === slug);
  if (!current) throw AppError.notFound('Category not found');

  const breadcrumb: { name: string; slug: string }[] = [];
  for (let c: typeof current | undefined = current; c; c = c.parentId ? byId.get(c.parentId) : undefined) {
    breadcrumb.unshift({ name: c.name, slug: c.slug });
  }
  const children = rows
    .filter((r) => r.parentId === current.id)
    .map((r) => ({ id: r.id, name: r.name, slug: r.slug, imageUrl: r.imageUrl, productCount: r._count.products }));

  return {
    id: current.id,
    name: current.name,
    slug: current.slug,
    description: current.description,
    imageUrl: current.imageUrl,
    gender: current.gender,
    breadcrumb,
    children,
  };
}

/** The category's own id plus every descendant id. Undefined → unknown slug. */
async function categoryIdsWithDescendants(slug: string): Promise<string[] | undefined> {
  const all = await prisma.category.findMany({
    where: { isActive: true },
    select: { id: true, parentId: true, slug: true },
  });
  const root = all.find((c) => c.slug === slug);
  if (!root) return undefined;
  const ids = new Set([root.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of all) {
      if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) {
        ids.add(c.id);
        grew = true;
      }
    }
  }
  return [...ids];
}

// ───────────────────────── Product listing ─────────────────────────

type FilterInput = Partial<
  Pick<
    ProductListQuery,
    'q' | 'collection' | 'gender' | 'minPrice' | 'maxPrice' | 'size' | 'colour' | 'fabric' | 'inStock' | 'minRating' | 'featured' | 'newArrival'
  >
>;

/**
 * Pure translation of public filters into a Prisma where-clause.
 * `categoryIds` is resolved separately because it needs a database lookup.
 */
export function buildProductWhere(f: FilterInput, categoryIds?: string[]): Prisma.ProductWhereInput {
  const and: Prisma.ProductWhereInput[] = [PUBLIC_PRODUCT];

  if (categoryIds) and.push({ categoryId: { in: categoryIds } });
  if (f.collection) and.push({ collections: { some: { slug: f.collection, isActive: true } } });
  if (f.gender) and.push({ gender: { in: [f.gender, 'UNISEX'] } });
  if (f.minPrice !== undefined) and.push({ effectivePrice: { gte: f.minPrice } });
  if (f.maxPrice !== undefined) and.push({ effectivePrice: { lte: f.maxPrice } });
  if (f.minRating !== undefined) and.push({ ratingAverage: { gte: f.minRating } });
  if (f.featured) and.push({ isFeatured: true });
  if (f.newArrival) and.push({ isNewArrival: true });

  if (f.q) {
    const contains = { contains: f.q, mode: 'insensitive' as const };
    and.push({
      OR: [
        { name: contains },
        { description: contains },
        { fabric: contains },
        { occasion: contains },
        { category: { name: contains } },
      ],
    });
  }

  // All variant-level filters must be satisfied by the SAME variant (e.g. size M *in* red).
  const variant: Prisma.ProductVariantWhereInput = { isActive: true };
  if (f.size) variant.size = { in: f.size, mode: 'insensitive' };
  if (f.colour) variant.colour = { in: f.colour, mode: 'insensitive' };
  if (f.fabric) variant.fabric = { in: f.fabric, mode: 'insensitive' };
  if (f.inStock) {
    variant.inventory = { is: { onHand: { gt: prisma.inventory.fields.reserved } } };
  }
  if (Object.keys(variant).length > 1) and.push({ variants: { some: variant } });

  return { AND: and };
}

function buildOrderBy(sort: ProductListQuery['sort']): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case 'price_asc':
      return [{ effectivePrice: 'asc' }, { id: 'asc' }];
    case 'price_desc':
      return [{ effectivePrice: 'desc' }, { id: 'asc' }];
    case 'popularity':
      return [{ soldCount: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }];
    case 'rating':
      return [{ ratingAverage: 'desc' }, { ratingCount: 'desc' }, { id: 'asc' }];
    case 'newest':
    default:
      return [{ createdAt: 'desc' }, { id: 'asc' }];
  }
}

export const cardSelect = {
  id: true,
  name: true,
  slug: true,
  gender: true,
  fabric: true,
  basePrice: true,
  salePrice: true,
  effectivePrice: true,
  isFeatured: true,
  isNewArrival: true,
  ratingAverage: true,
  ratingCount: true,
  category: { select: { name: true, slug: true } },
  images: {
    orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
    take: 2,
    select: { url: true, alt: true },
  },
  variants: {
    where: { isActive: true },
    select: { colour: true, inventory: { select: { onHand: true, reserved: true } } },
  },
} satisfies Prisma.ProductSelect;

type CardRow = Prisma.ProductGetPayload<{ select: typeof cardSelect }>;

export function toProductCard(p: CardRow) {
  const colours = [...new Set(p.variants.map((v) => v.colour).filter((c): c is string => !!c))];
  const inStock = p.variants.some((v) => v.inventory && v.inventory.onHand - v.inventory.reserved > 0);
  const discountPercent =
    p.salePrice !== null && p.basePrice > 0 ? Math.round((1 - p.salePrice / p.basePrice) * 100) : 0;
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    gender: p.gender,
    fabric: p.fabric,
    category: p.category,
    basePrice: p.basePrice,
    salePrice: p.salePrice,
    price: p.effectivePrice,
    discountPercent,
    isFeatured: p.isFeatured,
    isNewArrival: p.isNewArrival,
    ratingAverage: Number(p.ratingAverage),
    ratingCount: p.ratingCount,
    image: p.images[0] ?? null,
    hoverImage: p.images[1] ?? null,
    colours,
    inStock,
  };
}

export async function listProducts(query: ProductListQuery) {
  let categoryIds: string[] | undefined;
  if (query.category) {
    categoryIds = await categoryIdsWithDescendants(query.category);
    // Unknown category → empty result (not an error) so stale links degrade gracefully.
    if (!categoryIds) {
      return { items: [], meta: pageMeta(query, 0) };
    }
  }

  const where = buildProductWhere(query, categoryIds);
  const [total, rows] = await prisma.$transaction([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: buildOrderBy(query.sort),
      select: cardSelect,
      ...toSkipTake(query),
    }),
  ]);

  return { items: rows.map(toProductCard), meta: pageMeta(query, total) };
}

// ───────────────────────── Product detail ─────────────────────────

const LOW_STOCK_DISPLAY_CAP = 10;

export async function getProductBySlug(slug: string) {
  const product = await prisma.product.findFirst({
    where: { slug, ...PUBLIC_PRODUCT },
    include: {
      category: { select: { id: true, name: true, slug: true, parentId: true } },
      images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], select: { id: true, url: true, alt: true } },
      variants: {
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
        include: { inventory: true },
      },
      collections: { where: { isActive: true }, select: { name: true, slug: true } },
    },
  });
  if (!product) throw AppError.notFound('Product not found');

  const variants = product.variants.map((v) => {
    const available = Math.max(0, (v.inventory?.onHand ?? 0) - (v.inventory?.reserved ?? 0));
    const threshold = v.inventory?.lowStockThreshold ?? 5;
    return {
      id: v.id,
      sku: v.sku,
      size: v.size,
      colour: v.colour,
      fabric: v.fabric,
      design: v.design,
      price: v.priceOverride ?? product.effectivePrice,
      // Raw stock counts are internal; shoppers see a capped number and a status.
      available: Math.min(available, LOW_STOCK_DISPLAY_CAP),
      stockStatus: available === 0 ? 'OUT_OF_STOCK' : available <= threshold ? 'LOW_STOCK' : 'IN_STOCK',
    };
  });

  const card = toProductCard({
    ...product,
    images: product.images.slice(0, 2),
    variants: product.variants.map((v) => ({ colour: v.colour, inventory: v.inventory })),
  });

  // Breadcrumb: walk parents.
  const cats = await prisma.category.findMany({ select: { id: true, parentId: true, name: true, slug: true } });
  const byId = new Map(cats.map((c) => [c.id, c]));
  const breadcrumb: { name: string; slug: string }[] = [];
  for (let c = byId.get(product.categoryId); c; c = c.parentId ? byId.get(c.parentId) : undefined) {
    breadcrumb.unshift({ name: c.name, slug: c.slug });
  }

  return {
    ...card,
    description: product.description,
    careNotes: product.careNotes,
    occasion: product.occasion,
    taxRatePercent: Number(product.taxRatePercent),
    images: product.images,
    variants,
    options: {
      sizes: unique(variants.map((v) => v.size)),
      colours: unique(variants.map((v) => v.colour)),
      fabrics: unique(variants.map((v) => v.fabric)),
    },
    collections: product.collections,
    breadcrumb,
    inStock: variants.some((v) => v.stockStatus !== 'OUT_OF_STOCK'),
  };
}

function unique(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))];
}

// ───────────────────────── Facets & suggestions ─────────────────────────

export async function getFacets(f: { q?: string; category?: string; gender?: 'WOMEN' | 'MEN' | 'UNISEX' }) {
  let categoryIds: string[] | undefined;
  if (f.category) {
    categoryIds = await categoryIdsWithDescendants(f.category);
    if (!categoryIds) return emptyFacets();
  }
  const productWhere = buildProductWhere({ q: f.q, gender: f.gender }, categoryIds);

  const [variants, price] = await Promise.all([
    prisma.productVariant.findMany({
      where: { isActive: true, product: productWhere },
      select: { size: true, colour: true, fabric: true },
    }),
    prisma.product.aggregate({ where: productWhere, _min: { effectivePrice: true }, _max: { effectivePrice: true } }),
  ]);

  return {
    sizes: sortSizes(unique(variants.map((v) => v.size))),
    colours: unique(variants.map((v) => v.colour)).sort(),
    fabrics: unique(variants.map((v) => v.fabric)).sort(),
    price: { min: price._min.effectivePrice ?? 0, max: price._max.effectivePrice ?? 0 },
  };
}

function emptyFacets() {
  return { sizes: [], colours: [], fabrics: [], price: { min: 0, max: 0 } };
}

const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', 'FREE SIZE', 'FREE'];
function sortSizes(sizes: string[]): string[] {
  const rank = (s: string) => {
    const i = SIZE_ORDER.indexOf(s.toUpperCase());
    return i === -1 ? SIZE_ORDER.length : i;
  };
  return [...sizes].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true }));
}

export async function getSuggestions(q: string) {
  const contains = { contains: q, mode: 'insensitive' as const };
  const [products, categories] = await Promise.all([
    prisma.product.findMany({
      where: { AND: [PUBLIC_PRODUCT, { name: contains }] },
      orderBy: [{ soldCount: 'desc' }, { name: 'asc' }],
      take: 6,
      select: {
        name: true,
        slug: true,
        effectivePrice: true,
        images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], take: 1, select: { url: true, alt: true } },
      },
    }),
    prisma.category.findMany({
      where: { isActive: true, name: contains },
      orderBy: { name: 'asc' },
      take: 3,
      select: { name: true, slug: true },
    }),
  ]);
  return {
    products: products.map((p) => ({ name: p.name, slug: p.slug, price: p.effectivePrice, image: p.images[0] ?? null })),
    categories,
  };
}

// ───────────────────────── Collections ─────────────────────────

export async function listCollections() {
  const now = new Date();
  return prisma.collection.findMany({
    where: {
      isActive: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, slug: true, description: true, imageUrl: true, isSeasonal: true },
  });
}
