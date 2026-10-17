import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { paginationQuery, pageMeta, toSkipTake } from '../../lib/pagination.js';
import { ok } from '../../lib/respond.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

notificationsRouter.get(
  '/',
  validate(paginationQuery, 'query'),
  handle(async (req, res) => {
    const page = res.locals.query as { page: number; pageSize: number };
    const where = { userId: req.user!.id };
    const [total, unread, items] = await prisma.$transaction([
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { ...where, isRead: false } }),
      prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...toSkipTake(page) }),
    ]);
    ok(res, items, { ...pageMeta(page, total), unread });
  }),
);

notificationsRouter.post(
  '/read-all',
  handle(async (req, res) => {
    const r = await prisma.notification.updateMany({ where: { userId: req.user!.id, isRead: false }, data: { isRead: true } });
    ok(res, { updated: r.count });
  }),
);

notificationsRouter.patch(
  '/:id/read',
  validate(z.object({ id: z.string().uuid() }), 'params'),
  handle(async (req, res) => {
    // Scoped by userId so one shopper cannot mark another's notifications.
    const r = await prisma.notification.updateMany({ where: { id: req.params.id as string, userId: req.user!.id }, data: { isRead: true } });
    ok(res, { updated: r.count });
  }),
);
