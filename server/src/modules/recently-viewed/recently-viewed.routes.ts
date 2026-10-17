import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../lib/errors.js';
import { ok } from '../../lib/respond.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { cardSelect, toProductCard } from '../catalogue/catalogue.service.js';

const KEEP = 20;
const SHOW = 12;

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

/** /recently-viewed — the signed-in shopper's own browsing trail. Guests have none stored on the server. */
export const recentlyViewedRouter = Router();
recentlyViewedRouter.use(requireAuth);

recentlyViewedRouter.get(
  '/',
  handle(async (req, res) => {
    const rows = await prisma.recentlyViewed.findMany({
      // Products that were archived since drop out quietly.
      where: { userId: req.user!.id, product: { status: 'ACTIVE', category: { isActive: true } } },
      orderBy: { viewedAt: 'desc' },
      take: SHOW,
      select: { viewedAt: true, product: { select: cardSelect } },
    });
    ok(res, rows.map((r) => toProductCard(r.product)));
  }),
);

recentlyViewedRouter.post(
  '/:productId',
  validate(z.object({ productId: z.string().uuid() }), 'params'),
  handle(async (req, res) => {
    const userId = req.user!.id;
    const productId = req.params.productId as string;
    const product = await prisma.product.findFirst({ where: { id: productId, status: 'ACTIVE' }, select: { id: true } });
    if (!product) throw AppError.notFound('Product not found');

    await prisma.recentlyViewed.upsert({ where: { userId_productId: { userId, productId } }, create: { userId, productId }, update: { viewedAt: new Date() } });
    // Keep the trail short: forget everything older than the newest KEEP.
    const stale = await prisma.recentlyViewed.findMany({ where: { userId }, orderBy: { viewedAt: 'desc' }, skip: KEEP, select: { productId: true } });
    if (stale.length) await prisma.recentlyViewed.deleteMany({ where: { userId, productId: { in: stale.map((s) => s.productId) } } });
    ok(res, { recorded: true });
  }),
);

recentlyViewedRouter.delete(
  '/',
  handle(async (req, res) => {
    const r = await prisma.recentlyViewed.deleteMany({ where: { userId: req.user!.id } });
    ok(res, { cleared: r.count });
  }),
);
