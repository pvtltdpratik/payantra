import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { ok } from '../../lib/respond.js';
import { requireAuth } from '../../middleware/auth.js';
import { sensitiveLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { loadBasket, priceBasket } from '../cart/basket.js';
import { getSettings } from '../settings/settings.service.js';
import { resolveCoupon } from './coupons.service.js';
import { computePricing } from '../../lib/pricing.js';

export const couponsRouter = Router();

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

/**
 * Previews what a coupon would do to the current cart WITHOUT attaching it.
 * Rate-limited: this is the endpoint a code-guessing script would hammer.
 */
couponsRouter.post(
  '/validate',
  requireAuth,
  sensitiveLimiter,
  validate(z.object({ code: z.string().trim().min(2).max(40) }).strict()),
  handle(async (req, res) => {
    const userId = req.user!.id;
    const coupon = await resolveCoupon(prisma, req.body.code, userId);
    const settings = await getSettings();
    const priced = await priceBasket(prisma, userId, await loadBasket(prisma, userId), settings.shipping);
    if (!priced.pricing) return ok(res, { valid: true, code: coupon.code, discount: 0, note: 'Add items to your cart to see the saving' });

    const preview = computePricing(
      priced.payable.map((l) => ({ variantId: l.variantId, unitPrice: l.unitPrice, quantity: l.quantity, taxRatePercent: l.taxRatePercent })),
      coupon,
      settings.shipping,
    );
    ok(res, { valid: true, code: coupon.code, discount: preview.discountTotal, note: preview.couponNote, grandTotal: preview.grandTotal });
  }),
);
