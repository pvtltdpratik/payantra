import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { paginationQuery } from '../../lib/pagination.js';
import { ok } from '../../lib/respond.js';
import { validate } from '../../middleware/validate.js';
import * as customers from './customers.service.js';

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const listQuery = paginationQuery.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});

/** Mounted inside the admin router. Read-only: suspending an account is done under Users & roles (audited). */
export const customersAdminRouter = Router();
customersAdminRouter.get(
  '/customers',
  validate(listQuery, 'query'),
  handle(async (_req, res) => {
    const { items, meta } = await customers.listCustomers(res.locals.query);
    ok(res, items, meta);
  }),
);
customersAdminRouter.get('/customers/:id', validate(z.object({ id: z.string().uuid() }), 'params'), handle(async (req, res) => ok(res, await customers.getCustomer(req.params.id as string))));
