import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../lib/errors.js';
import { advisoryLock } from '../../lib/locks.js';
import { created, ok } from '../../lib/respond.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';

export const addressesRouter = Router();
addressesRouter.use(requireAuth);

const MAX_ADDRESSES = 10;

const text = (max: number) => z.string().trim().min(1).max(max);
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional();

export const addressInput = z.object({
  label: optional(30),
  fullName: text(100),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number'),
  line1: text(200),
  line2: optional(200),
  landmark: optional(100),
  city: text(80),
  state: text(80),
  postalCode: z.string().trim().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit PIN code'),
  isDefault: z.boolean().default(false),
});
const addressUpdate = addressInput.partial().strict();
const idParam = z.object({ id: z.string().uuid() });

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

/** Every query is scoped by userId: an address id from another account behaves as "not found". */
async function ownAddress(userId: string, id: string) {
  const address = await prisma.address.findFirst({ where: { id, userId } });
  if (!address) throw AppError.notFound('Address not found');
  return address;
}

addressesRouter.get(
  '/',
  handle(async (req, res) => {
    const items = await prisma.address.findMany({
      where: { userId: req.user!.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    ok(res, items);
  }),
);

addressesRouter.post(
  '/',
  validate(addressInput),
  handle(async (req, res) => {
    const userId = req.user!.id;
    const address = await prisma.$transaction(async (tx) => {
      // One shopper's address changes are serialised; other shoppers are unaffected.
      await advisoryLock(tx, `addresses:${userId}`);
      const count = await tx.address.count({ where: { userId } });
      if (count >= MAX_ADDRESSES) throw AppError.unprocessable(`You can save up to ${MAX_ADDRESSES} addresses`);
      // The first address is always the default; otherwise only when asked.
      const makeDefault = count === 0 || req.body.isDefault;
      if (makeDefault) await tx.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
      return tx.address.create({ data: { ...req.body, userId, isDefault: makeDefault } });
    });
    created(res, address);
  }),
);

addressesRouter.patch(
  '/:id',
  validate(idParam, 'params'),
  validate(addressUpdate),
  handle(async (req, res) => {
    const userId = req.user!.id;
    const id = req.params.id as string;
    const updated = await prisma.$transaction(async (tx) => {
      await advisoryLock(tx, `addresses:${userId}`);
      const current = await tx.address.findFirst({ where: { id, userId } });
      if (!current) throw AppError.notFound('Address not found');
      if (req.body.isDefault === false && current.isDefault) {
        throw AppError.unprocessable('Choose another address as the default instead of unsetting this one');
      }
      if (req.body.isDefault) await tx.address.updateMany({ where: { userId, isDefault: true, id: { not: id } }, data: { isDefault: false } });
      return tx.address.update({ where: { id }, data: req.body });
    });
    ok(res, updated);
  }),
);

addressesRouter.delete(
  '/:id',
  validate(idParam, 'params'),
  handle(async (req, res) => {
    const userId = req.user!.id;
    const id = req.params.id as string;
    await ownAddress(userId, id);
    await prisma.$transaction(async (tx) => {
      await advisoryLock(tx, `addresses:${userId}`);
      const removed = await tx.address.delete({ where: { id } });
      // Orders carry their own address snapshot, so deleting is always safe. Promote a new default.
      if (removed.isDefault) {
        const next = await tx.address.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
        if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
    ok(res, { deleted: true });
  }),
);
