import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { created, ok } from '../../lib/respond.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { sensitiveLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import * as delivery from './delivery.service.js';
import { applyBody, assignmentListQuery, availabilityBody, partnerProfileBody, statusBody } from './delivery.schema.js';

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const idParam = z.object({ id: z.string().uuid() });

/**
 * /delivery — two audiences:
 *   any signed-in user      → see their application, apply
 *   an approved partner     → everything else; each query is scoped to the partner's OWN assignments,
 *                              and the role is re-read from the database on every request.
 */
export const deliveryRouter = Router();
deliveryRouter.use(requireAuth);

deliveryRouter.get('/me', handle(async (req, res) => ok(res, await delivery.getMe(req.user!.id))));
deliveryRouter.post('/apply', sensitiveLimiter, validate(applyBody), handle(async (req, res) => created(res, await delivery.apply(req.user!.id, req.body))));

const partnerOnly = requireRole('DELIVERY_PARTNER');

deliveryRouter.patch('/me', partnerOnly, validate(partnerProfileBody), handle(async (req, res) => ok(res, await delivery.updateMyProfile(req.user!.id, req.body))));
deliveryRouter.put('/availability', partnerOnly, validate(availabilityBody), handle(async (req, res) => ok(res, await delivery.setAvailability(req.user!.id, req.body.isOnline))));
deliveryRouter.get('/stats', partnerOnly, handle(async (req, res) => ok(res, await delivery.stats(req.user!.id))));

deliveryRouter.get(
  '/assignments',
  partnerOnly,
  validate(assignmentListQuery, 'query'),
  handle(async (req, res) => {
    const { items, meta } = await delivery.listAssignments(req.user!.id, res.locals.query);
    ok(res, items, meta);
  }),
);
deliveryRouter.get('/assignments/:id', partnerOnly, validate(idParam, 'params'), handle(async (req, res) => ok(res, await delivery.getAssignment(req.user!.id, req.params.id as string))));
deliveryRouter.post(
  '/assignments/:id/status',
  partnerOnly,
  sensitiveLimiter,
  validate(idParam, 'params'),
  validate(statusBody),
  handle(async (req, res) => ok(res, await delivery.updateStatus(req.user!.id, req.params.id as string, req.body))),
);
