import type { Request } from 'express';
import { prisma, Prisma } from '../../config/prisma.js';
import { audit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { pageMeta, toSkipTake } from '../../lib/pagination.js';
import { uniqueSlug } from '../../lib/slug.js';
import type { ProductCreate, ProductUpdate, VariantCreate, VariantUpdate } from './admin.schema.js';

type Tx = Prisma.TransactionClient;

const variantKey = (v: { size?: string | null; colour?: string | null; fabric?: string | null; design?: string | null }) =>
  [v.size, v.colour, v.fabric, v.design].map((x) => (x ?? '').trim().toLowerCase()).join('|');

/** A product may only go live with at least one image and one active variant. */
function assertPublishable(imageCount: number, activeVariantCount: number) {
  if (imageCount < 1) throw AppError.unprocessable('Add at least one image before publishing this product');
  if (activeVariantCount < 1) throw AppError.unprocessable('Add at least one active variant before publishing this product');
}

async function assertSkusFree(tx: Tx, skus: string[], exceptVariantId?: string) {
  const dupes = new Set<string>();
  for (const s of skus) {
    if (dupes.has(s.toLowerCase())) throw AppError.conflict(`Duplicate SKU in request: ${s}`);
    dupes.add(s.toLowerCase());
  }
  const taken = await tx.productVariant.findMany({
    where: { sku: { in: skus }, ...(exceptVariantId ? { id: { not: exceptVariantId } } : {}) },
    select: { sku: true },
  });
  if (taken.length) throw AppError.conflict(`SKU already in use: ${taken.map((t) => t.sku).join(', ')}`);
}

async function assertCategoryExists(tx: Tx, id: string) {
  const c = await tx.category.findUnique({ where: { id }, select: { id: true } });
  if (!c) throw AppError.unprocessable('Category does not exist', { field: 'categoryId' });
}

async function assertCollectionsExist(tx: Tx, ids: string[]) {
  if (!ids.length) return;
  const found = await tx.collection.count({ where: { id: { in: ids } } });
  if (found !== new Set(ids).size) throw AppError.unprocessable('One or more collections do not exist', { field: 'collectionIds' });
}

const detailInclude = {
  category: { select: { id: true, name: true, slug: true } },
  images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
  variants: { orderBy: { createdAt: 'asc' }, include: { inventory: true } },
  collections: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.ProductInclude;

// ───────────────────────── Reads ─────────────────────────

export async function listAdminProducts(q: {
  page: number;
  pageSize: number;
  q?: string;
  status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  categoryId?: string;
}) {
  const contains = q.q ? { contains: q.q, mode: 'insensitive' as const } : undefined;
  const where: Prisma.ProductWhereInput = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.categoryId ? { categoryId: q.categoryId } : {}),
    ...(contains ? { OR: [{ name: contains }, { variants: { some: { sku: contains } } }] } : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      ...toSkipTake(q),
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        gender: true,
        basePrice: true,
        salePrice: true,
        effectivePrice: true,
        isFeatured: true,
        isNewArrival: true,
        updatedAt: true,
        category: { select: { name: true } },
        images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], take: 1, select: { url: true } },
        variants: { select: { isActive: true, inventory: { select: { onHand: true, reserved: true } } } },
      },
    }),
  ]);

  const items = rows.map(({ variants, images, category, ...p }) => ({
    ...p,
    category: category.name,
    image: images[0]?.url ?? null,
    variantCount: variants.length,
    available: variants.reduce((sum, v) => sum + Math.max(0, (v.inventory?.onHand ?? 0) - (v.inventory?.reserved ?? 0)), 0),
  }));
  return { items, meta: pageMeta(q, total) };
}

export async function getAdminProduct(id: string) {
  const product = await prisma.product.findUnique({ where: { id }, include: detailInclude });
  if (!product) throw AppError.notFound('Product not found');
  return product;
}

// ───────────────────────── Product writes ─────────────────────────

export async function createProduct(req: Request, input: ProductCreate) {
  const combos = input.variants.map(variantKey);
  if (new Set(combos).size !== combos.length) {
    throw AppError.unprocessable('Two variants have the same size/colour/fabric/design combination');
  }
  if (input.status === 'ACTIVE') {
    assertPublishable(input.images.length, input.variants.filter((v) => v.isActive).length);
  }

  const id = await prisma.$transaction(async (tx) => {
    await assertCategoryExists(tx, input.categoryId);
    await assertCollectionsExist(tx, input.collectionIds);
    await assertSkusFree(tx, input.variants.map((v) => v.sku));

    const slug = await uniqueSlug(input.name, async (s) => !!(await tx.product.findUnique({ where: { slug: s }, select: { id: true } })));
    const product = await tx.product.create({
      data: {
        name: input.name,
        slug,
        description: input.description,
        categoryId: input.categoryId,
        gender: input.gender,
        fabric: input.fabric,
        occasion: input.occasion,
        careNotes: input.careNotes,
        basePrice: input.basePrice,
        salePrice: input.salePrice ?? null,
        effectivePrice: input.salePrice ?? input.basePrice,
        taxRatePercent: input.taxRatePercent,
        hsnCode: input.hsnCode,
        status: input.status,
        isFeatured: input.isFeatured,
        isNewArrival: input.isNewArrival,
        collections: { connect: input.collectionIds.map((cid) => ({ id: cid })) },
        images: {
          create: input.images.map((img, i) => ({ url: img.url, alt: img.alt, sortOrder: i, isPrimary: i === 0 })),
        },
        variants: {
          create: input.variants.map((v) => ({
            sku: v.sku,
            size: v.size,
            colour: v.colour,
            fabric: v.fabric,
            design: v.design,
            priceOverride: v.priceOverride ?? null,
            isActive: v.isActive,
            inventory: { create: { onHand: v.stock, lowStockThreshold: v.lowStockThreshold } },
          })),
        },
      },
      select: { id: true, variants: { select: { id: true, sku: true } } },
    });

    const received = product.variants
      .map((v) => ({ variantId: v.id, quantity: input.variants.find((iv) => iv.sku === v.sku)!.stock }))
      .filter((m) => m.quantity > 0);
    if (received.length) {
      await tx.stockMovement.createMany({
        data: received.map((m) => ({ ...m, type: 'RECEIVED' as const, note: 'Initial stock', actorId: req.user!.id })),
      });
    }

    await audit(tx, req, { action: 'product.create', entityType: 'Product', entityId: product.id, metadata: { name: input.name, slug } });
    return product.id;
  });

  return getAdminProduct(id);
}

export async function updateProduct(req: Request, id: string, patch: ProductUpdate) {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.product.findUnique({
      where: { id },
      select: {
        basePrice: true,
        salePrice: true,
        status: true,
        _count: { select: { images: true } },
      },
    });
    if (!existing) throw AppError.notFound('Product not found');

    const basePrice = patch.basePrice ?? existing.basePrice;
    const salePrice = patch.salePrice === undefined ? existing.salePrice : patch.salePrice;
    if (salePrice !== null && salePrice > basePrice) {
      throw AppError.unprocessable('Sale price cannot exceed the base price', { field: 'salePrice' });
    }

    const nextStatus = patch.status ?? existing.status;
    if (nextStatus === 'ACTIVE') {
      const activeVariants = await tx.productVariant.count({ where: { productId: id, isActive: true } });
      assertPublishable(existing._count.images, activeVariants);
    }

    if (patch.categoryId) await assertCategoryExists(tx, patch.categoryId);
    if (patch.collectionIds) await assertCollectionsExist(tx, patch.collectionIds);

    const { collectionIds, ...fields } = patch;
    await tx.product.update({
      where: { id },
      data: {
        ...fields,
        basePrice,
        salePrice,
        effectivePrice: salePrice ?? basePrice,
        ...(collectionIds ? { collections: { set: collectionIds.map((cid) => ({ id: cid })) } } : {}),
      },
    });

    await audit(tx, req, { action: 'product.update', entityType: 'Product', entityId: id, metadata: { fields: Object.keys(patch) } });
  });
  return getAdminProduct(id);
}

/** Products that appear in past orders are archived instead of deleted, keeping history intact. */
export async function deleteProduct(req: Request, id: string): Promise<{ deleted: boolean; archived: boolean }> {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id }, select: { id: true } });
    if (!product) throw AppError.notFound('Product not found');

    const ordered = await tx.orderItem.count({ where: { productId: id } });
    if (ordered > 0) {
      await tx.product.update({ where: { id }, data: { status: 'ARCHIVED', isFeatured: false } });
      await audit(tx, req, { action: 'product.archive', entityType: 'Product', entityId: id, metadata: { reason: 'has orders' } });
      return { deleted: false, archived: true };
    }

    const variantIds = (await tx.productVariant.findMany({ where: { productId: id }, select: { id: true } })).map((v) => v.id);
    await tx.cartItem.deleteMany({ where: { variantId: { in: variantIds } } });
    await tx.stockMovement.deleteMany({ where: { variantId: { in: variantIds } } });
    await tx.product.delete({ where: { id } });
    await audit(tx, req, { action: 'product.delete', entityType: 'Product', entityId: id });
    return { deleted: true, archived: false };
  });
}

// ───────────────────────── Variants ─────────────────────────

export async function addVariant(req: Request, productId: string, input: VariantCreate) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { id: true, variants: { select: { size: true, colour: true, fabric: true, design: true } } },
    });
    if (!product) throw AppError.notFound('Product not found');
    if (product.variants.some((v) => variantKey(v) === variantKey(input))) {
      throw AppError.conflict('A variant with this size/colour/fabric/design already exists');
    }
    await assertSkusFree(tx, [input.sku]);

    const variant = await tx.productVariant.create({
      data: {
        productId,
        sku: input.sku,
        size: input.size,
        colour: input.colour,
        fabric: input.fabric,
        design: input.design,
        priceOverride: input.priceOverride ?? null,
        isActive: input.isActive,
        inventory: { create: { onHand: input.stock, lowStockThreshold: input.lowStockThreshold } },
      },
      include: { inventory: true },
    });
    if (input.stock > 0) {
      await tx.stockMovement.create({
        data: { variantId: variant.id, type: 'RECEIVED', quantity: input.stock, note: 'Initial stock', actorId: req.user!.id },
      });
    }
    await audit(tx, req, { action: 'variant.create', entityType: 'ProductVariant', entityId: variant.id, metadata: { productId, sku: input.sku } });
    return variant;
  });
}

export async function updateVariant(req: Request, variantId: string, patch: VariantUpdate) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.productVariant.findUnique({
      where: { id: variantId },
      include: { product: { select: { id: true, status: true, variants: true } } },
    });
    if (!existing) throw AppError.notFound('Variant not found');

    const merged = { ...existing, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
    const clash = existing.product.variants.some((v) => v.id !== variantId && variantKey(v) === variantKey(merged));
    if (clash) throw AppError.conflict('Another variant already has this size/colour/fabric/design');
    if (patch.sku) await assertSkusFree(tx, [patch.sku], variantId);

    if (patch.isActive === false && existing.product.status === 'ACTIVE') {
      const otherActive = existing.product.variants.filter((v) => v.id !== variantId && v.isActive).length;
      if (otherActive === 0) throw AppError.unprocessable('A live product needs at least one active variant. Archive the product instead.');
    }

    const { lowStockThreshold, ...fields } = patch;
    const variant = await tx.productVariant.update({
      where: { id: variantId },
      data: {
        ...fields,
        ...(lowStockThreshold !== undefined ? { inventory: { update: { lowStockThreshold } } } : {}),
      },
      include: { inventory: true },
    });
    await audit(tx, req, { action: 'variant.update', entityType: 'ProductVariant', entityId: variantId, metadata: { fields: Object.keys(patch) } });
    return variant;
  });
}

export async function deleteVariant(req: Request, variantId: string): Promise<{ deleted: boolean; deactivated: boolean }> {
  return prisma.$transaction(async (tx) => {
    const variant = await tx.productVariant.findUnique({
      where: { id: variantId },
      include: { product: { select: { status: true, variants: { select: { id: true, isActive: true } } } } },
    });
    if (!variant) throw AppError.notFound('Variant not found');

    const others = variant.product.variants.filter((v) => v.id !== variantId && v.isActive).length;
    if (variant.product.status === 'ACTIVE' && others === 0) {
      throw AppError.unprocessable('A live product needs at least one active variant. Archive the product instead.');
    }

    const ordered = await tx.orderItem.count({ where: { variantId } });
    if (ordered > 0) {
      await tx.productVariant.update({ where: { id: variantId }, data: { isActive: false } });
      await audit(tx, req, { action: 'variant.deactivate', entityType: 'ProductVariant', entityId: variantId, metadata: { reason: 'has orders' } });
      return { deleted: false, deactivated: true };
    }

    await tx.cartItem.deleteMany({ where: { variantId } });
    await tx.stockMovement.deleteMany({ where: { variantId } });
    await tx.productVariant.delete({ where: { id: variantId } });
    await audit(tx, req, { action: 'variant.delete', entityType: 'ProductVariant', entityId: variantId });
    return { deleted: true, deactivated: false };
  });
}

// ───────────────────────── Images ─────────────────────────

export async function addImage(req: Request, productId: string, input: { url: string; alt?: string | null; isPrimary: boolean }) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true, _count: { select: { images: true } } } });
    if (!product) throw AppError.notFound('Product not found');
    if (product._count.images >= 10) throw AppError.unprocessable('A product can have at most 10 images');

    const last = await tx.productImage.aggregate({ where: { productId }, _max: { sortOrder: true } });
    const makePrimary = input.isPrimary || product._count.images === 0;
    if (makePrimary) await tx.productImage.updateMany({ where: { productId }, data: { isPrimary: false } });

    const image = await tx.productImage.create({
      data: { productId, url: input.url, alt: input.alt, sortOrder: (last._max.sortOrder ?? -1) + 1, isPrimary: makePrimary },
    });
    await audit(tx, req, { action: 'image.create', entityType: 'ProductImage', entityId: image.id, metadata: { productId } });
    return image;
  });
}

export async function updateImage(
  req: Request,
  imageId: string,
  patch: { alt?: string | null; sortOrder?: number; isPrimary?: boolean },
) {
  return prisma.$transaction(async (tx) => {
    const image = await tx.productImage.findUnique({ where: { id: imageId } });
    if (!image) throw AppError.notFound('Image not found');
    if (patch.isPrimary === false && image.isPrimary) {
      throw AppError.unprocessable('Choose another image as primary instead of unsetting this one');
    }
    if (patch.isPrimary) await tx.productImage.updateMany({ where: { productId: image.productId }, data: { isPrimary: false } });
    const updated = await tx.productImage.update({ where: { id: imageId }, data: patch });
    await audit(tx, req, { action: 'image.update', entityType: 'ProductImage', entityId: imageId });
    return updated;
  });
}

export async function deleteImage(req: Request, imageId: string) {
  await prisma.$transaction(async (tx) => {
    const image = await tx.productImage.findUnique({
      where: { id: imageId },
      include: { product: { select: { status: true, _count: { select: { images: true } } } } },
    });
    if (!image) throw AppError.notFound('Image not found');
    if (image.product.status === 'ACTIVE' && image.product._count.images <= 1) {
      throw AppError.unprocessable('A live product needs at least one image');
    }

    await tx.productImage.delete({ where: { id: imageId } });
    if (image.isPrimary) {
      const next = await tx.productImage.findFirst({ where: { productId: image.productId }, orderBy: { sortOrder: 'asc' } });
      if (next) await tx.productImage.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    await audit(tx, req, { action: 'image.delete', entityType: 'ProductImage', entityId: imageId });
  });
}
