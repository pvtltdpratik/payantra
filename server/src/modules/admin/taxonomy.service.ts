import type { Request } from 'express';
import { prisma } from '../../config/prisma.js';
import { audit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { uniqueSlug } from '../../lib/slug.js';

type CategoryInput = {
  name: string;
  parentId?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  gender?: 'WOMEN' | 'MEN' | 'UNISEX' | null;
  sortOrder?: number;
  isActive?: boolean;
};

export async function listAllCategories() {
  const rows = await prisma.category.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { products: true, children: true } } },
  });
  return rows.map(({ _count, ...c }) => ({ ...c, productCount: _count.products, childCount: _count.children }));
}

export async function createCategory(req: Request, input: CategoryInput) {
  return prisma.$transaction(async (tx) => {
    if (input.parentId) {
      const parent = await tx.category.findUnique({ where: { id: input.parentId }, select: { parentId: true } });
      if (!parent) throw AppError.unprocessable('Parent category does not exist', { field: 'parentId' });
      if (parent.parentId) throw AppError.unprocessable('Categories can be nested at most two levels deep', { field: 'parentId' });
    }
    const slug = await uniqueSlug(input.name, async (s) => !!(await tx.category.findUnique({ where: { slug: s }, select: { id: true } })));
    const category = await tx.category.create({ data: { ...input, slug } });
    await audit(tx, req, { action: 'category.create', entityType: 'Category', entityId: category.id, metadata: { name: input.name } });
    return category;
  });
}

export async function updateCategory(req: Request, id: string, patch: Partial<CategoryInput>) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.category.findUnique({ where: { id }, include: { _count: { select: { children: true } } } });
    if (!existing) throw AppError.notFound('Category not found');

    if (patch.parentId !== undefined && patch.parentId !== null) {
      if (patch.parentId === id) throw AppError.unprocessable('A category cannot be its own parent', { field: 'parentId' });
      const parent = await tx.category.findUnique({ where: { id: patch.parentId }, select: { parentId: true } });
      if (!parent) throw AppError.unprocessable('Parent category does not exist', { field: 'parentId' });
      // Depth is capped at two levels, which also makes cycles impossible.
      if (parent.parentId) throw AppError.unprocessable('Categories can be nested at most two levels deep', { field: 'parentId' });
      if (existing._count.children > 0) {
        throw AppError.unprocessable('A category with sub-categories cannot become a sub-category', { field: 'parentId' });
      }
    }

    const category = await tx.category.update({ where: { id }, data: patch });
    await audit(tx, req, { action: 'category.update', entityType: 'Category', entityId: id, metadata: { fields: Object.keys(patch) } });
    return category;
  });
}

export async function deleteCategory(req: Request, id: string) {
  await prisma.$transaction(async (tx) => {
    const category = await tx.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true, children: true } } },
    });
    if (!category) throw AppError.notFound('Category not found');
    if (category._count.products > 0) {
      throw AppError.conflict(`Move or archive its ${category._count.products} product(s) before deleting this category`);
    }
    if (category._count.children > 0) {
      throw AppError.conflict('Delete or move its sub-categories first');
    }
    await tx.category.delete({ where: { id } });
    await audit(tx, req, { action: 'category.delete', entityType: 'Category', entityId: id, metadata: { name: category.name } });
  });
}

// ───────────────────────── Collections ─────────────────────────

type CollectionInput = {
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  isSeasonal?: boolean;
  isActive?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
  sortOrder?: number;
};

export async function listAllCollections() {
  const rows = await prisma.collection.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { products: true } } },
  });
  return rows.map(({ _count, ...c }) => ({ ...c, productCount: _count.products }));
}

export async function createCollection(req: Request, input: CollectionInput) {
  return prisma.$transaction(async (tx) => {
    const slug = await uniqueSlug(input.name, async (s) => !!(await tx.collection.findUnique({ where: { slug: s }, select: { id: true } })));
    const collection = await tx.collection.create({ data: { ...input, slug } });
    await audit(tx, req, { action: 'collection.create', entityType: 'Collection', entityId: collection.id, metadata: { name: input.name } });
    return collection;
  });
}

export async function updateCollection(req: Request, id: string, patch: Partial<CollectionInput>) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.collection.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Collection not found');

    const startsAt = patch.startsAt === undefined ? existing.startsAt : patch.startsAt;
    const endsAt = patch.endsAt === undefined ? existing.endsAt : patch.endsAt;
    if (startsAt && endsAt && endsAt <= startsAt) {
      throw AppError.unprocessable('endsAt must be after startsAt', { field: 'endsAt' });
    }

    const collection = await tx.collection.update({ where: { id }, data: patch });
    await audit(tx, req, { action: 'collection.update', entityType: 'Collection', entityId: id, metadata: { fields: Object.keys(patch) } });
    return collection;
  });
}

export async function deleteCollection(req: Request, id: string) {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.collection.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw AppError.notFound('Collection not found');
    await tx.collection.delete({ where: { id } });
    await audit(tx, req, { action: 'collection.delete', entityType: 'Collection', entityId: id });
  });
}
