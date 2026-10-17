import { z } from 'zod';
import { paginationQuery } from '../../lib/pagination.js';

/** Accepts `?size=S&size=M` and `?size=S,M`. */
const list = z.preprocess(
  (v) => {
    if (Array.isArray(v)) return v.flatMap((x) => String(x).split(','));
    if (typeof v === 'string') return v.split(',');
    return undefined;
  },
  z
    .array(z.string().trim().min(1).max(40))
    .max(20)
    .optional()
    .transform((a) => (a && a.length ? a : undefined)),
);

const flag = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')
  .optional();

export const PRODUCT_SORTS = ['newest', 'price_asc', 'price_desc', 'popularity', 'rating'] as const;

export const productFilterShape = {
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(100).optional(), // slug; includes sub-categories
  collection: z.string().trim().max(100).optional(), // slug
  gender: z.enum(['WOMEN', 'MEN', 'UNISEX']).optional(),
  /** Prices are integer paise. */
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  size: list,
  colour: list,
  fabric: list,
  inStock: flag,
  minRating: z.coerce.number().min(1).max(5).optional(),
  featured: flag,
  newArrival: flag,
};

export const productListQuery = paginationQuery
  .extend({
    ...productFilterShape,
    sort: z.enum(PRODUCT_SORTS).default('newest'),
  })
  .refine((v) => v.minPrice === undefined || v.maxPrice === undefined || v.minPrice <= v.maxPrice, {
    message: 'minPrice cannot exceed maxPrice',
    path: ['minPrice'],
  });

export type ProductListQuery = z.infer<typeof productListQuery>;

export const facetsQuery = z.object({
  q: productFilterShape.q,
  category: productFilterShape.category,
  gender: productFilterShape.gender,
});

export const suggestionsQuery = z.object({
  q: z.string().trim().min(2).max(60),
});

export const slugParam = z.object({ slug: z.string().trim().min(1).max(160) });
