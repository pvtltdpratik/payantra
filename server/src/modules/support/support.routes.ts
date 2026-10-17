import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { paginationQuery } from '../../lib/pagination.js';
import { created, ok } from '../../lib/respond.js';
import { requireAuth } from '../../middleware/auth.js';
import { sensitiveLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import * as support from './support.service.js';

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const createBody = z
  .object({
    subject: z.string().trim().min(3).max(120),
    message: z.string().trim().min(10).max(2000),
    orderId: z.string().uuid().nullish(),
  })
  .strict();

/** /support — a signed-in customer's own requests. */
export const supportRouter = Router();
supportRouter.use(requireAuth);
supportRouter.get('/', handle(async (req, res) => ok(res, await support.listMine(req.user!.id))));
supportRouter.post('/', sensitiveLimiter, validate(createBody), handle(async (req, res) => created(res, await support.createRequest(req.user!.id, req.body))));

const listQuery = paginationQuery.extend({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
  q: z.string().trim().max(100).optional(),
});
const patchBody = z
  .object({
    status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
    reply: z.string().trim().min(2).max(2000).optional(),
  })
  .strict()
  .refine((v) => v.status !== undefined || v.reply !== undefined, { message: 'Nothing to update' });

/** Mounted inside the admin router. */
export const supportAdminRouter = Router();
supportAdminRouter.get(
  '/support',
  validate(listQuery, 'query'),
  handle(async (_req, res) => {
    const { items, meta } = await support.listAll(res.locals.query);
    ok(res, items, meta);
  }),
);
supportAdminRouter.patch(
  '/support/:id',
  sensitiveLimiter,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(patchBody),
  handle(async (req, res) => ok(res, await support.respond(req, req.params.id as string, req.body))),
);
