import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../lib/errors.js';
import { created, ok } from '../../lib/respond.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { cardSelect, toProductCard } from '../catalogue/catalogue.service.js';

export const wishlistRouter = Router();
wishlistRouter.use(requireAuth);

const MAX_ITEMS = 200;
const productParam = z.object({ productId: z.string().uuid() });

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

/** The wishlist is created lazily so signing up costs nothing. */
async function wishlistIdFor(userId: string) {
  const wl = await prisma.wishlist.upsert({ where: { userId }, create: { userId }, update: {}, select: { id: true } });
  return wl.id;
}

// Only products a shopper could currently see are listed; archived/draft ones quietly drop out.
wishlistRouter.get(
  '/',
  handle(async (req, res) => {
    const items = await prisma.wishlistItem.findMany({
      where: {
        wishlist: { userId: req.user!.id },
        product: { status: 'ACTIVE', category: { isActive: true } },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, product: { select: cardSelect } },
    });
    ok(res, items.map((i) => ({ addedAt: i.createdAt, ...toProductCard(i.product) })));
  }),
);

/** Lightweight list of ids so product grids can render filled hearts without fetching every card. */
wishlistRouter.get(
  '/ids',
  handle(async (req, res) => {
    const rows = await prisma.wishlistItem.findMany({ where: { wishlist: { userId: req.user!.id } }, select: { productId: true } });
    ok(res, rows.map((r) => r.productId));
  }),
);

wishlistRouter.post(
  '/:productId',
  validate(productParam, 'params'),
  handle(async (req, res) => {
    const userId = req.user!.id;
    const productId = req.params.productId as string;
    const product = await prisma.product.findFirst({
      where: { id: productId, status: 'ACTIVE', category: { isActive: true } },
      select: { id: true },
    });
    if (!product) throw AppError.notFound('Product not found');

    const wishlistId = await wishlistIdFor(userId);
    if ((await prisma.wishlistItem.count({ where: { wishlistId } })) >= MAX_ITEMS) {
      throw AppError.unprocessable(`Your wishlist can hold up to ${MAX_ITEMS} items`);
    }
    // Idempotent: saving twice is not an error.
    await prisma.wishlistItem.upsert({
      where: { wishlistId_productId: { wishlistId, productId } },
      create: { wishlistId, productId },
      update: {},
    });
    created(res, { productId, saved: true });
  }),
);

wishlistRouter.delete(
  '/:productId',
  validate(productParam, 'params'),
  handle(async (req, res) => {
    await prisma.wishlistItem.deleteMany({
      where: { productId: req.params.productId as string, wishlist: { userId: req.user!.id } },
    });
    ok(res, { productId: req.params.productId, saved: false });
  }),
);
