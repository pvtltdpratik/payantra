import { Router, type Request, type Response, type NextFunction } from 'express';
import { ok } from '../../lib/respond.js';
import { validate } from '../../middleware/validate.js';
import {
  facetsQuery,
  productListQuery,
  slugParam,
  suggestionsQuery,
  type ProductListQuery,
} from './catalogue.schema.js';
import * as catalogue from './catalogue.service.js';

/** Wraps an async handler so rejections reach the central error handler (Express 5 does this natively, but be explicit). */
const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

// ── /categories ──
export const categoriesRouter = Router();

categoriesRouter.get(
  '/',
  handle(async (_req, res) => ok(res, await catalogue.getCategoryTree())),
);

categoriesRouter.get(
  '/:slug',
  validate(slugParam, 'params'),
  handle(async (req, res) => ok(res, await catalogue.getCategoryBySlug(req.params.slug as string))),
);

// ── /collections ──
export const collectionsRouter = Router();

collectionsRouter.get(
  '/',
  handle(async (_req, res) => ok(res, await catalogue.listCollections())),
);

// ── /products ──
export const productsRouter = Router();

productsRouter.get(
  '/',
  validate(productListQuery, 'query'),
  handle(async (_req, res) => {
    const { items, meta } = await catalogue.listProducts(res.locals.query as ProductListQuery);
    ok(res, items, meta);
  }),
);

// Must be registered before "/:slug" or "facets" would be read as a slug.
productsRouter.get(
  '/facets',
  validate(facetsQuery, 'query'),
  handle(async (_req, res) => ok(res, await catalogue.getFacets(res.locals.query))),
);

productsRouter.get(
  '/:slug',
  validate(slugParam, 'params'),
  handle(async (req, res) => ok(res, await catalogue.getProductBySlug(req.params.slug as string))),
);

// ── /search ──
export const searchRouter = Router();

searchRouter.get(
  '/',
  validate(productListQuery, 'query'),
  handle(async (_req, res) => {
    const { items, meta } = await catalogue.listProducts(res.locals.query as ProductListQuery);
    ok(res, items, meta);
  }),
);

searchRouter.get(
  '/suggestions',
  validate(suggestionsQuery, 'query'),
  handle(async (_req, res) => ok(res, await catalogue.getSuggestions(res.locals.query.q))),
);
