import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { created, ok } from '../../lib/respond.js';
import { requireAuth } from '../../middleware/auth.js';
import { sensitiveLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { checkoutOptions, placeOrder } from './checkout.service.js';

export const checkoutRouter = Router();
checkoutRouter.use(requireAuth);

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const body = z
  .object({
    addressId: z.string().uuid(),
    paymentMethod: z.enum(['RAZORPAY', 'COD']),
    idempotencyKey: z.string().trim().min(16).max(64).regex(/^[A-Za-z0-9_-]+$/, 'Use letters, digits, "-" or "_"'),
  })
  // `.strict()`: a client cannot smuggle in a price, a discount or a total — they are not accepted at all.
  .strict();

checkoutRouter.get('/options', handle(async (_req, res) => ok(res, await checkoutOptions())));

checkoutRouter.post(
  '/',
  sensitiveLimiter,
  validate(body),
  handle(async (req, res) => created(res, await placeOrder(req.user!.id, req.user!.email, req.body))),
);
