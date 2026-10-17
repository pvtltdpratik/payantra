import type { Request } from 'express';
import { prisma, Prisma } from '../../config/prisma.js';
import { audit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { advisoryLock } from '../../lib/locks.js';
import { pageMeta, toSkipTake } from '../../lib/pagination.js';
import { getSettings } from '../settings/settings.service.js';

type Role = 'CUSTOMER' | 'DELIVERY_PARTNER' | 'ADMIN';
type Status = 'ACTIVE' | 'SUSPENDED';

const userSelect = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  role: true,
  status: true,
  createdAt: true,
} as const;

export async function listUsers(q: { page: number; pageSize: number; q?: string; role?: Role; status?: Status }) {
  const contains = q.q ? { contains: q.q, mode: 'insensitive' as const } : undefined;
  const where: Prisma.ProfileWhereInput = {
    ...(q.role ? { role: q.role } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(contains ? { OR: [{ email: contains }, { fullName: contains }] } : {}),
  };
  const [total, items] = await prisma.$transaction([
    prisma.profile.count({ where }),
    prisma.profile.findMany({ where, orderBy: { createdAt: 'desc' }, select: userSelect, ...toSkipTake(q) }),
  ]);
  return { items, meta: pageMeta(q, total) };
}

/**
 * Role/status changes — the only way privileges are granted through the API.
 * Guard rails: you cannot change yourself, and the last active admin can never be removed.
 */
export async function updateUser(req: Request, targetId: string, patch: { role?: Role; status?: Status }) {
  if (targetId === req.user!.id) {
    throw AppError.forbidden('You cannot change your own role or status');
  }

  return prisma.$transaction(async (tx) => {
      // All role changes queue behind one lock, so two concurrent demotions can never both pass the
      // "is this the last admin?" check. (A keyed lock instead of Serializable isolation, which can
      // abort unrelated transactions with serialization failures on a real database.)
      await advisoryLock(tx, 'admin-roles');
      const target = await tx.profile.findUnique({ where: { id: targetId }, select: userSelect });
      if (!target) throw AppError.notFound('User not found');

      const losesAdmin =
        target.role === 'ADMIN' &&
        target.status === 'ACTIVE' &&
        ((patch.role !== undefined && patch.role !== 'ADMIN') || patch.status === 'SUSPENDED');

      if (losesAdmin) {
        const activeAdmins = await tx.profile.count({ where: { role: 'ADMIN', status: 'ACTIVE' } });
        if (activeAdmins <= 1) throw AppError.conflict('Cannot remove the last active administrator');
      }

      const updated = await tx.profile.update({ where: { id: targetId }, data: patch, select: userSelect });

      // An admin granting the delivery role IS the approval, so the partner record must exist and be active;
      // taking the role away (or suspending the account) sends the partner offline.
      if (patch.role === 'DELIVERY_PARTNER') {
        const { delivery } = await getSettings(tx);
        await tx.deliveryPartner.upsert({
          where: { userId: targetId },
          create: { userId: targetId, status: 'APPROVED', approvedById: req.user!.id, approvedAt: new Date(), perDeliveryPayout: delivery.defaultPayout },
          update: { status: 'APPROVED', approvedById: req.user!.id, approvedAt: new Date(), rejectionReason: null },
        });
      } else if ((patch.role !== undefined && target.role === 'DELIVERY_PARTNER') || patch.status === 'SUSPENDED') {
        await tx.deliveryPartner.updateMany({ where: { userId: targetId }, data: { isOnline: false } });
      }
      await audit(tx, req, {
        action: 'user.update',
        entityType: 'Profile',
        entityId: targetId,
        metadata: { email: target.email, from: { role: target.role, status: target.status }, to: patch },
      });
      return updated;
  });
}

export async function listAuditLogs(q: { page: number; pageSize: number; entityType?: string }) {
  const where: Prisma.AuditLogWhereInput = q.entityType ? { entityType: q.entityType } : {};
  const [total, items] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { actor: { select: { email: true, fullName: true } } },
      ...toSkipTake(q),
    }),
  ]);
  return { items, meta: pageMeta(q, total) };
}
