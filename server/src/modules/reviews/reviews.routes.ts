import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { paginationQuery } from '../../lib/pagination.js';
import { created, ok } from '../../lib/respond.js';
import { requireAuth } from '../../middleware/auth.js';
import { sensitiveLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import * as reviews from './reviews.service.js';

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const idParam = z.object({ id: z.string().uuid() });
const text = (max: number) => z.string().trim().max(max).nullish();
const rating = z.number().int().min(1).max(5);

const createBody = z.object({ productId: z.string().uuid(), orderId: z.string().uuid(), rating, title: text(100), body: text(2000) }).strict();
const updateBody = z
  .object({ rating: rating.optional(), title: text(100), body: text(2000) })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const reviewsRouter = Router();

// Public: the best recent reviews across the shop, for the home page. (Registered before "/:id" routes.)
reviewsRouter.get(
  '/featured',
  validate(z.object({ limit: z.coerce.number().int().min(1).max(12).default(6) }), 'query'),
  handle(async (_req, res) => ok(res, await reviews.featuredReviews(res.locals.query.limit))),
);

// Public: anyone may read a product's visible reviews.
reviewsRouter.get(
  '/product/:slug',
  validate(z.object({ slug: z.string().trim().min(1).max(200) }), 'params'),
  validate(paginationQuery.extend({ sort: z.enum(['newest', 'highest', 'lowest']).default('newest') }), 'query'),
  handle(async (req, res) => {
    const { items, meta, summary } = await reviews.productReviews(req.params.slug as string, res.locals.query);
    ok(res, { summary, items }, meta);
  }),
);

// Signed in: write and manage your own.
reviewsRouter.get('/mine', requireAuth, handle(async (req, res) => ok(res, await reviews.myReviews(req.user!.id))));
reviewsRouter.post('/', requireAuth, sensitiveLimiter, validate(createBody), handle(async (req, res) => created(res, await reviews.createReview(req.user!.id, req.body))));
reviewsRouter.patch('/:id', requireAuth, validate(idParam, 'params'), validate(updateBody), handle(async (req, res) => ok(res, await reviews.updateReview(req.user!.id, req.params.id as string, req.body))));
reviewsRouter.delete(
  '/:id',
  requireAuth,
  validate(idParam, 'params'),
  handle(async (req, res) => {
    await reviews.deleteReview(req.user!.id, req.params.id as string);
    ok(res, { deleted: true });
  }),
);

/** Mounted inside the admin router. */
export const reviewsAdminRouter = Router();
reviewsAdminRouter.get(
  '/reviews',
  validate(paginationQuery.extend({ status: z.enum(['visible', 'hidden']).optional(), rating: z.coerce.number().int().min(1).max(5).optional() }), 'query'),
  handle(async (_req, res) => {
    const { items, meta } = await reviews.listForModeration(res.locals.query);
    ok(res, items, meta);
  }),
);
reviewsAdminRouter.patch(
  '/reviews/:id',
  validate(idParam, 'params'),
  validate(z.object({ isVisible: z.boolean() }).strict()),
  handle(async (req, res) => ok(res, await reviews.setVisibility(req, req.params.id as string, req.body.isVisible))),
);
