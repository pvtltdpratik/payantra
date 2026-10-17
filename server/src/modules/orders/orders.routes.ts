import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { paginationQuery } from '../../lib/pagination.js';
import { created, ok } from '../../lib/respond.js';
import { requireAuth } from '../../middleware/auth.js';
import { sensitiveLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import * as orders from './orders.service.js';

export const ordersRouter = Router();
ordersRouter.use(requireAuth);

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const idParam = z.object({ id: z.string().uuid() });
const cancelBody = z.object({ reason: z.string().trim().min(3).max(300).default('Cancelled by customer') }).strict();
const returnBody = z
  .object({
    type: z.enum(['RETURN', 'REPLACEMENT']),
    reason: z.string().trim().min(3).max(300),
    details: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

ordersRouter.get(
  '/',
  validate(paginationQuery, 'query'),
  handle(async (req, res) => {
    const { items, meta } = await orders.listOrders(req.user!.id, res.locals.query);
    ok(res, items, meta);
  }),
);

ordersRouter.get('/:id', validate(idParam, 'params'), handle(async (req, res) => ok(res, await orders.getOrder(req.user!.id, req.params.id as string))));

ordersRouter.post(
  '/:id/cancel',
  sensitiveLimiter,
  validate(idParam, 'params'),
  validate(cancelBody),
  handle(async (req, res) =>
    ok(res, await orders.cancelOrder(req.params.id as string, { userId: req.user!.id, actorId: req.user!.id, reason: req.body.reason })),
  ),
);

ordersRouter.post(
  '/:id/returns',
  sensitiveLimiter,
  validate(idParam, 'params'),
  validate(returnBody),
  handle(async (req, res) => created(res, await orders.requestReturn(req.user!.id, req.params.id as string, req.body))),
);

ordersRouter.post('/:id/reorder', validate(idParam, 'params'), handle(async (req, res) => ok(res, await orders.reorder(req.user!.id, req.params.id as string))));

ordersRouter.get('/:id/invoice', validate(idParam, 'params'), handle(async (req, res) => ok(res, await orders.getInvoice(req.user!.id, req.params.id as string))));
