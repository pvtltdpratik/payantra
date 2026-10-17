import { z } from 'zod';
import { paginationQuery } from '../../lib/pagination.js';

/** Integer paise, capped at ₹10,00,000 per unit to catch fat-fingered values. */
const paise = z.number().int().min(0).max(100_000_000);

/** https URL or a site-relative path (but not protocol-relative `//host`). */
const mediaUrl = z
  .string()
  .trim()
  .max(500)
  .refine((u) => /^https:\/\/[^\s]+$/.test(u) || /^\/(?!\/)[^\s]*$/.test(u), 'Must be an https URL or a site path');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional();

/** SKUs are stored uppercase so "v-1" and "V-1" can never be two different items. */
const sku = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/, 'SKU must be 2–40 letters, digits, ".", "_" or "-"')
  .transform((s) => s.toUpperCase());

const variantAttrs = {
  size: optionalText(30),
  colour: optionalText(40),
  fabric: optionalText(40),
  design: optionalText(60),
};

export const variantCreate = z.object({
  sku,
  ...variantAttrs,
  priceOverride: paise.nullable().optional(),
  stock: z.number().int().min(0).max(1_000_000).default(0),
  lowStockThreshold: z.number().int().min(0).max(10_000).default(5),
  isActive: z.boolean().default(true),
});

export const variantUpdate = z
  .object({
    sku: sku.optional(),
    ...variantAttrs,
    priceOverride: paise.nullable().optional(),
    lowStockThreshold: z.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const imageCreate = z.object({
  url: mediaUrl,
  alt: optionalText(160),
  isPrimary: z.boolean().default(false),
});

export const imageUpdate = z
  .object({ alt: optionalText(160), sortOrder: z.number().int().min(0).max(1000).optional(), isPrimary: z.boolean().optional() })
  .strict();

const productFields = {
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().min(10).max(5000),
  categoryId: z.string().uuid(),
  gender: z.enum(['WOMEN', 'MEN', 'UNISEX']),
  fabric: optionalText(60),
  occasion: optionalText(60),
  careNotes: optionalText(1000),
  basePrice: paise,
  salePrice: paise.nullable().optional(),
  taxRatePercent: z.number().min(0).max(28).default(5),
  hsnCode: optionalText(12),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).default('DRAFT'),
  isFeatured: z.boolean().default(false),
  isNewArrival: z.boolean().default(false),
  collectionIds: z.array(z.string().uuid()).max(20).default([]),
};

const saleNotAboveBase = (v: { basePrice?: number; salePrice?: number | null }) =>
  v.salePrice == null || v.basePrice === undefined || v.salePrice <= v.basePrice;

export const productCreate = z
  .object({
    ...productFields,
    images: z.array(z.object({ url: mediaUrl, alt: optionalText(160) })).max(10).default([]),
    variants: z.array(variantCreate).min(1, 'At least one variant is required').max(100),
  })
  .refine(saleNotAboveBase, { message: 'Sale price cannot exceed the base price', path: ['salePrice'] });

export const productUpdate = z
  .object({
    name: productFields.name.optional(),
    description: productFields.description.optional(),
    categoryId: productFields.categoryId.optional(),
    gender: productFields.gender.optional(),
    fabric: productFields.fabric,
    occasion: productFields.occasion,
    careNotes: productFields.careNotes,
    basePrice: paise.optional(),
    salePrice: paise.nullable().optional(),
    taxRatePercent: z.number().min(0).max(28).optional(),
    hsnCode: productFields.hsnCode,
    status: productFields.status.optional(),
    isFeatured: z.boolean().optional(),
    isNewArrival: z.boolean().optional(),
    collectionIds: productFields.collectionIds.optional(),
  })
  .strict()
  .refine(saleNotAboveBase, { message: 'Sale price cannot exceed the base price', path: ['salePrice'] });

export const adminProductListQuery = paginationQuery.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
  categoryId: z.string().uuid().optional(),
});

export const categoryCreate = z.object({
  name: z.string().trim().min(2).max(80),
  parentId: z.string().uuid().nullable().optional(),
  description: optionalText(500),
  imageUrl: mediaUrl.nullable().optional(),
  gender: z.enum(['WOMEN', 'MEN', 'UNISEX']).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  isActive: z.boolean().default(true),
});

export const categoryUpdate = categoryCreate.partial().strict();

export const collectionCreate = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: optionalText(500),
    imageUrl: mediaUrl.nullable().optional(),
    isSeasonal: z.boolean().default(false),
    isActive: z.boolean().default(true),
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional(),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
  })
  .refine((v) => !v.startsAt || !v.endsAt || v.endsAt > v.startsAt, {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });

export const collectionUpdate = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: optionalText(500),
    imageUrl: mediaUrl.nullable(),
    isSeasonal: z.boolean(),
    isActive: z.boolean(),
    startsAt: z.coerce.date().nullable(),
    endsAt: z.coerce.date().nullable(),
    sortOrder: z.number().int().min(0).max(10_000),
  })
  .partial()
  .strict();

export const inventoryListQuery = paginationQuery.extend({
  q: z.string().trim().max(100).optional(),
  lowStock: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const inventoryAdjust = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('delta'),
    quantity: z
      .number()
      .int()
      .min(-1_000_000)
      .max(1_000_000)
      .refine((n) => n !== 0, 'Quantity cannot be zero'),
    reason: z.string().trim().min(3).max(200),
  }),
  z.object({
    mode: z.literal('set'),
    quantity: z.number().int().min(0).max(1_000_000),
    reason: z.string().trim().min(3).max(200),
  }),
]);

export const userListQuery = paginationQuery.extend({
  q: z.string().trim().max(100).optional(),
  role: z.enum(['CUSTOMER', 'DELIVERY_PARTNER', 'ADMIN']).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});

export const userUpdate = z
  .object({
    role: z.enum(['CUSTOMER', 'DELIVERY_PARTNER', 'ADMIN']).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  })
  .strict()
  .refine((v) => v.role !== undefined || v.status !== undefined, { message: 'Provide role and/or status' });

const couponShape = {
  description: optionalText(200),
  discountType: z.enum(['PERCENTAGE', 'FLAT']),
  /** Percent (1–100) for PERCENTAGE coupons, paise for FLAT. */
  discountValue: z.number().int().min(1).max(100_000_000),
  maxDiscount: paise.nullable().optional(),
  minOrderValue: paise,
  usageLimit: z.number().int().min(1).max(10_000_000).nullable().optional(),
  perUserLimit: z.number().int().min(1).max(100),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  isActive: z.boolean(),
};

export const couponCreate = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{3,20}$/, 'Code: 3–20 letters, digits, "_" or "-"'),
    ...couponShape,
    minOrderValue: couponShape.minOrderValue.default(0),
    perUserLimit: couponShape.perUserLimit.default(1),
    isActive: couponShape.isActive.default(true),
  })
  .refine((v) => v.discountType !== 'PERCENTAGE' || v.discountValue <= 100, {
    message: 'A percentage discount cannot exceed 100',
    path: ['discountValue'],
  })
  .refine((v) => v.endsAt > v.startsAt, { message: 'endsAt must be after startsAt', path: ['endsAt'] });

export const couponUpdate = z.object(couponShape).partial().strict();

export const couponListQuery = paginationQuery.extend({ q: z.string().trim().max(40).optional() });

export const settingKeyParam = z.object({ key: z.enum(['shipping', 'payments', 'returns']) });

const FULFILMENT = [
  'PLACED',
  'PAYMENT_CONFIRMED',
  'PROCESSING',
  'PACKED',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'RETURN_REQUESTED',
  'RETURNED',
] as const;

export const adminOrderListQuery = paginationQuery.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(FULFILMENT).optional(),
  paymentStatus: z.enum(['PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED']).optional(),
  paymentMethod: z.enum(['RAZORPAY', 'COD']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const orderStatusBody = z.object({ status: z.enum(FULFILMENT), note: z.string().trim().max(300).optional() }).strict();
export const orderCancelBody = z.object({ reason: z.string().trim().min(3).max(300) }).strict();
export const orderRefundBody = z
  .object({
    /** Paise; omit to refund everything still refundable. */
    amount: z.number().int().min(1).max(100_000_000).optional(),
    reason: z.string().trim().min(3).max(300),
    /** Generated once per refund intention so a double-click cannot refund twice. */
    idempotencyKey: z.string().trim().min(16).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
  })
  .strict();

export const returnListQuery = paginationQuery.extend({ status: z.enum(['REQUESTED', 'APPROVED', 'REJECTED', 'COMPLETED']).optional() });
export const returnActionBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), adminNote: z.string().trim().max(500).optional() }).strict(),
  z.object({ action: z.literal('reject'), adminNote: z.string().trim().min(3).max(500) }).strict(),
  z
    .object({
      action: z.literal('complete'),
      adminNote: z.string().trim().max(500).optional(),
      refundAmount: z.number().int().min(0).max(100_000_000).optional(),
      /** Put the returned items back into sellable stock. */
      restock: z.boolean().default(true),
    })
    .strict(),
]);

export const idParam = z.object({ id: z.string().uuid() });

export type ProductCreate = z.infer<typeof productCreate>;
export type ProductUpdate = z.infer<typeof productUpdate>;
export type VariantCreate = z.infer<typeof variantCreate>;
export type VariantUpdate = z.infer<typeof variantUpdate>;
