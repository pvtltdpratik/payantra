import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { ok } from '../../lib/respond.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';

export const usersRouter = Router();

const profileSelect = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  avatarUrl: true,
  role: true,
  createdAt: true,
} as const;

const updateProfileSchema = z
  .object({
    fullName: z.string().trim().min(2).max(100).optional(),
    phone: z
      .string()
      .trim()
      .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number')
      .optional(),
    avatarUrl: z.string().url().max(500).optional(),
  })
  // `.strict()` rejects unknown keys, so `role` / `status` in a body is an error, not ignored.
  .strict();

usersRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const profile = await prisma.profile.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: profileSelect,
    });
    ok(res, profile);
  } catch (err) {
    next(err);
  }
});

usersRouter.patch('/me', requireAuth, validate(updateProfileSchema), async (req, res, next) => {
  try {
    const profile = await prisma.profile.update({
      where: { id: req.user!.id },
      data: req.body,
      select: profileSelect,
    });
    ok(res, profile);
  } catch (err) {
    next(err);
  }
});
