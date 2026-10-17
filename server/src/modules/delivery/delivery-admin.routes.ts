import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { created, ok } from '../../lib/respond.js';
import { sensitiveLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import * as admin from './delivery-admin.service.js';
import { assignBody, partnerDecisionBody, partnerListQuery } from './delivery.schema.js';

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const idParam = z.object({ id: z.string().uuid() });

/** Mounted inside the admin router, which already enforces authentication and the ADMIN role. */
export const deliveryAdminRouter = Router();

deliveryAdminRouter.get(
  '/delivery-partners',
  validate(partnerListQuery, 'query'),
  handle(async (_req, res) => {
    const { items, meta } = await admin.listPartners(res.locals.query);
    ok(res, items, meta);
  }),
);
// Registered before "/:id" so "assignable" is not read as an id.
deliveryAdminRouter.get('/delivery-partners/assignable', handle(async (_req, res) => ok(res, await admin.assignablePartners())));
deliveryAdminRouter.get('/delivery-partners/:id', validate(idParam, 'params'), handle(async (req, res) => ok(res, await admin.getPartner(req.params.id as string))));
deliveryAdminRouter.patch(
  '/delivery-partners/:id',
  sensitiveLimiter,
  validate(idParam, 'params'),
  validate(partnerDecisionBody),
  handle(async (req, res) => ok(res, await admin.decide(req, req.params.id as string, req.body))),
);

deliveryAdminRouter.post(
  '/orders/:id/assignment',
  sensitiveLimiter,
  validate(idParam, 'params'),
  validate(assignBody),
  handle(async (req, res) => {
    await admin.assign(req, req.params.id as string, req.body.partnerId);
    created(res, { assigned: true });
  }),
);
deliveryAdminRouter.delete(
  '/orders/:id/assignment',
  sensitiveLimiter,
  validate(idParam, 'params'),
  handle(async (req, res) => {
    await admin.unassign(req, req.params.id as string);
    ok(res, { unassigned: true });
  }),
);
deliveryAdminRouter.post(
  '/orders/:id/assignment/reissue-code',
  sensitiveLimiter,
  validate(idParam, 'params'),
  handle(async (req, res) => {
    await admin.reissueCode(req, req.params.id as string);
    ok(res, { reissued: true });
  }),
);
