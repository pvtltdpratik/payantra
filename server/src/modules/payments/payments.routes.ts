import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { ok } from '../../lib/respond.js';
import { requireAuth } from '../../middleware/auth.js';
import { sensitiveLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { handleWebhook, retryPayment, verifyPayment } from './payments.service.js';

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

// ── /payments (shopper) ──
export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

const verifyBody = z
  .object({
    razorpay_order_id: z.string().min(5).max(64),
    razorpay_payment_id: z.string().min(5).max(64),
    razorpay_signature: z.string().min(10).max(256),
  })
  .strict();

paymentsRouter.post(
  '/verify',
  sensitiveLimiter,
  validate(verifyBody),
  handle(async (req, res) => ok(res, await verifyPayment(req.user!.id, req.body))),
);

paymentsRouter.post(
  '/:orderId/retry',
  sensitiveLimiter,
  validate(z.object({ orderId: z.string().uuid() }), 'params'),
  handle(async (req, res) => ok(res, await retryPayment(req.user!.id, req.user!.email, req.params.orderId as string))),
);

// ── /webhooks/razorpay ──
/**
 * Mounted BEFORE express.json() (see app.ts) and given the raw body as a Buffer: Razorpay signs the
 * exact bytes it sent, and re-serialising parsed JSON would not reproduce them.
 * No user session here — authenticity comes solely from the HMAC signature.
 */
export const razorpayWebhookRouter = Router();
razorpayWebhookRouter.post(
  '/',
  express.raw({ type: '*/*', limit: '512kb' }),
  handle(async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const result = await handleWebhook(raw, req.header('x-razorpay-signature'), req.header('x-razorpay-event-id'));
    ok(res, { received: true, duplicate: result.duplicate });
  }),
);
