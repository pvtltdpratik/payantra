import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { created, ok } from '../../lib/respond.js';
import { requireAuth } from '../../middleware/auth.js';
import { sensitiveLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { MAX_PER_LINE } from './basket.js';
import * as cart from './cart.service.js';

export const cartRouter = Router();
cartRouter.use(requireAuth);

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const variantParam = z.object({ variantId: z.string().uuid() });
const qty = z.number().int().min(1).max(MAX_PER_LINE);
const addBody = z.object({ variantId: z.string().uuid(), quantity: qty.default(1) }).strict();
const setBody = z.object({ quantity: qty }).strict();
const couponBody = z.object({ code: z.string().trim().min(2).max(40) }).strict();

cartRouter.get('/', handle(async (req, res) => ok(res, await cart.getCartView(req.user!.id))));

/** Cheap endpoint for the header badge. */
cartRouter.get('/summary', handle(async (req, res) => ok(res, { count: await cart.cartCount(req.user!.id) })));

cartRouter.post(
  '/items',
  validate(addBody),
  handle(async (req, res) => {
    await cart.addItem(req.user!.id, req.body.variantId, req.body.quantity);
    created(res, await cart.getCartView(req.user!.id));
  }),
);

cartRouter.patch(
  '/items/:variantId',
  validate(variantParam, 'params'),
  validate(setBody),
  handle(async (req, res) => {
    await cart.setQuantity(req.user!.id, req.params.variantId as string, req.body.quantity);
    ok(res, await cart.getCartView(req.user!.id));
  }),
);

cartRouter.delete(
  '/items/:variantId',
  validate(variantParam, 'params'),
  handle(async (req, res) => {
    await cart.removeItem(req.user!.id, req.params.variantId as string);
    ok(res, await cart.getCartView(req.user!.id));
  }),
);

cartRouter.delete(
  '/',
  handle(async (req, res) => {
    await cart.clearCart(req.user!.id);
    ok(res, await cart.getCartView(req.user!.id));
  }),
);

// Coupon codes are guessable secrets; rate-limit attempts.
cartRouter.put(
  '/coupon',
  sensitiveLimiter,
  validate(couponBody),
  handle(async (req, res) => {
    await cart.applyCoupon(req.user!.id, req.body.code);
    ok(res, await cart.getCartView(req.user!.id));
  }),
);

cartRouter.delete(
  '/coupon',
  handle(async (req, res) => {
    await cart.removeCoupon(req.user!.id);
    ok(res, await cart.getCartView(req.user!.id));
  }),
);
