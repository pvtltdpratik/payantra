import { prisma } from '../config/prisma.js';

/** Empties every application table. Fast enough to run before each test. */
export async function resetDb() {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT IN ('_dev_migrations', '_prisma_migrations')`;
  if (!rows.length) return;
  const list = rows.map((r) => `"${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

interface VariantSeed {
  sku: string;
  size?: string | null;
  colour?: string | null;
  fabric?: string | null;
  onHand?: number;
  reserved?: number;
  lowStockThreshold?: number;
  isActive?: boolean;
}

interface ProductSeed {
  name: string;
  categoryId: string;
  gender?: 'WOMEN' | 'MEN' | 'UNISEX';
  basePrice?: number;
  salePrice?: number | null;
  status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  fabric?: string | null;
  isFeatured?: boolean;
  isNewArrival?: boolean;
  soldCount?: number;
  ratingAverage?: number;
  createdAt?: Date;
  variants?: VariantSeed[];
  images?: number;
  description?: string;
}

let counter = 0;

export async function makeCategory(name: string, opts: { parentId?: string; isActive?: boolean; gender?: 'WOMEN' | 'MEN' | 'UNISEX' } = {}) {
  counter++;
  return prisma.category.create({
    data: {
      name,
      slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${counter}`,
      parentId: opts.parentId,
      isActive: opts.isActive ?? true,
      gender: opts.gender,
    },
  });
}

export async function makeProduct(p: ProductSeed) {
  counter++;
  const basePrice = p.basePrice ?? 100_000;
  const salePrice = p.salePrice ?? null;
  const variants = p.variants ?? [{ sku: `SKU-${counter}`, size: 'M', colour: 'Red', onHand: 10 }];
  return prisma.product.create({
    data: {
      name: p.name,
      slug: `${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${counter}`,
      description: p.description ?? `Description for ${p.name}`,
      categoryId: p.categoryId,
      gender: p.gender ?? 'WOMEN',
      fabric: p.fabric ?? null,
      basePrice,
      salePrice,
      effectivePrice: salePrice ?? basePrice,
      status: p.status ?? 'ACTIVE',
      isFeatured: p.isFeatured ?? false,
      isNewArrival: p.isNewArrival ?? false,
      soldCount: p.soldCount ?? 0,
      ratingAverage: p.ratingAverage ?? 0,
      createdAt: p.createdAt,
      images: {
        create: Array.from({ length: p.images ?? 1 }, (_, i) => ({
          url: `/placeholder/5c1a2b?label=${encodeURIComponent(p.name)}&v=${i + 1}`,
          sortOrder: i,
          isPrimary: i === 0,
        })),
      },
      variants: {
        create: variants.map((v) => ({
          sku: v.sku,
          size: v.size ?? null,
          colour: v.colour ?? null,
          fabric: v.fabric ?? null,
          isActive: v.isActive ?? true,
          inventory: {
            create: {
              onHand: v.onHand ?? 10,
              reserved: v.reserved ?? 0,
              lowStockThreshold: v.lowStockThreshold ?? 5,
            },
          },
        })),
      },
    },
    include: { variants: true, images: true },
  });
}
