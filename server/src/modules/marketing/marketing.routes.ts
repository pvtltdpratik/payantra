import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { paginationQuery } from '../../lib/pagination.js';
import { created, ok } from '../../lib/respond.js';
import { sensitiveLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import * as marketing from './marketing.service.js';

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const idParam = z.object({ id: z.string().uuid() });

/**
 * A banner image or link is either a path on this site ("/shop", "/placeholder/…") or an https URL.
 * Anything else — javascript:, data:, protocol-relative "//host" — is refused, because these values end up in
 * href and src attributes on the storefront.
 */
export const safeUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => (v.startsWith('/') && !v.startsWith('//') && !v.includes('\\')) || /^https:\/\/[^\s]+$/i.test(v), 'Use a site path like /shop or an https:// URL');

const bannerShape = {
  title: z.string().trim().min(2).max(100),
  subtitle: z.string().trim().max(200).nullish().transform((v) => v || null),
  imageUrl: safeUrl,
  linkUrl: safeUrl.nullish().transform((v) => v || null),
  placement: z.enum(marketing.PLACEMENTS),
  sortOrder: z.number().int().min(0).max(1000),
  isActive: z.boolean(),
  startsAt: z.coerce.date().nullish(),
  endsAt: z.coerce.date().nullish(),
};
const windowOk = (v: { startsAt?: Date | null; endsAt?: Date | null }) => !v.startsAt || !v.endsAt || v.endsAt > v.startsAt;

const bannerCreate = z
  .object({ ...bannerShape, subtitle: bannerShape.subtitle.optional(), linkUrl: bannerShape.linkUrl.optional(), sortOrder: bannerShape.sortOrder.default(0), isActive: bannerShape.isActive.default(true) })
  .strict()
  .refine(windowOk, { message: 'The end date must be after the start date', path: ['endsAt'] });
const bannerUpdate = z
  .object(bannerShape)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' })
  .refine(windowOk, { message: 'The end date must be after the start date', path: ['endsAt'] });

// ── Public ──

export const marketingPublicRouter = Router();

marketingPublicRouter.get(
  '/banners',
  validate(z.object({ placement: z.enum(marketing.PLACEMENTS).optional() }), 'query'),
  handle(async (_req, res) => ok(res, await marketing.publicBanners(res.locals.query.placement))),
);

marketingPublicRouter.post(
  '/newsletter/subscribe',
  sensitiveLimiter,
  validate(z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict()),
  handle(async (req, res) => {
    await marketing.subscribe(req.body.email);
    // The same answer whether or not the address was already on the list.
    ok(res, { subscribed: true });
  }),
);

// ── Admin (mounted inside the admin router) ──

export const marketingAdminRouter = Router();

marketingAdminRouter.get('/banners', handle(async (_req, res) => ok(res, await marketing.listBanners())));
marketingAdminRouter.post('/banners', validate(bannerCreate), handle(async (req, res) => created(res, await marketing.createBanner(req, req.body))));
marketingAdminRouter.patch('/banners/:id', validate(idParam, 'params'), validate(bannerUpdate), handle(async (req, res) => ok(res, await marketing.updateBanner(req, req.params.id as string, req.body))));
marketingAdminRouter.delete(
  '/banners/:id',
  validate(idParam, 'params'),
  handle(async (req, res) => {
    await marketing.deleteBanner(req, req.params.id as string);
    ok(res, { deleted: true });
  }),
);

const subscriberQuery = paginationQuery.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['subscribed', 'unsubscribed']).optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

marketingAdminRouter.get(
  '/newsletter',
  validate(subscriberQuery, 'query'),
  handle(async (_req, res) => {
    const q = res.locals.query as z.infer<typeof subscriberQuery>;
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="payantra-newsletter-subscribers.csv"');
      res.setHeader('Cache-Control', 'no-store');
      return res.send(await marketing.subscribersCsv(q));
    }
    const { items, meta } = await marketing.listSubscribers(q);
    return ok(res, items, meta);
  }),
);
marketingAdminRouter.patch(
  '/newsletter/:id',
  validate(idParam, 'params'),
  validate(z.object({ subscribed: z.boolean() }).strict()),
  handle(async (req, res) => ok(res, await marketing.setSubscribed(req, req.params.id as string, req.body.subscribed))),
);
