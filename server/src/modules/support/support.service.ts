import type { Request } from 'express';
import { prisma } from '../../config/prisma.js';
import { audit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { advisoryLock } from '../../lib/locks.js';
import { notify, notifyAdmins } from '../../lib/notify.js';
import { pageMeta, toSkipTake } from '../../lib/pagination.js';

type Status = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
const MAX_OPEN_PER_CUSTOMER = 5;

const own = { id: true, subject: true, message: true, status: true, reply: true, repliedAt: true, orderId: true, createdAt: true, updatedAt: true } as const;

// ───────────────────────── Customer ─────────────────────────

export async function createRequest(userId: string, input: { subject: string; message: string; orderId?: string | null }) {
  return prisma.$transaction(async (tx) => {
    // One customer cannot flood the inbox, even with parallel requests.
    await advisoryLock(tx, `support:${userId}`);
    const open = await tx.supportRequest.count({ where: { userId, status: { in: ['OPEN', 'IN_PROGRESS'] } } });
    if (open >= MAX_OPEN_PER_CUSTOMER) {
      throw AppError.unprocessable(`You already have ${open} open requests. Please wait for a reply before sending more.`);
    }
    let orderNumber: string | null = null;
    if (input.orderId) {
      const order = await tx.order.findFirst({ where: { id: input.orderId, userId }, select: { orderNumber: true } });
      if (!order) throw AppError.notFound('Order not found'); // someone else's order looks exactly like a missing one
      orderNumber = order.orderNumber;
    }
    const created = await tx.supportRequest.create({
      data: { userId, subject: input.subject, message: input.message, orderId: input.orderId ?? null },
      select: own,
    });
    await notifyAdmins(tx, 'New support request', `${input.subject}${orderNumber ? ` (${orderNumber})` : ''}`, '/admin/support');
    return created;
  });
}

export async function listMine(userId: string) {
  return prisma.supportRequest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50, select: own });
}

// ───────────────────────── Admin ─────────────────────────

export async function listAll(q: { page: number; pageSize: number; status?: Status; q?: string }) {
  const search = q.q?.trim();
  const where = {
    ...(q.status ? { status: q.status } : {}),
    ...(search ? { OR: [{ subject: { contains: search, mode: 'insensitive' as const } }, { user: { email: { contains: search, mode: 'insensitive' as const } } }] } : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.supportRequest.count({ where }),
    prisma.supportRequest.findMany({
      where,
      // Open requests first, then the oldest unanswered at the top of each group.
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      ...toSkipTake(q),
      select: { ...own, user: { select: { id: true, email: true, fullName: true } } },
    }),
  ]);
  const orderIds = rows.map((r) => r.orderId).filter((x): x is string => !!x);
  const orders = orderIds.length ? await prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNumber: true } }) : [];
  return { items: rows.map((r) => ({ ...r, orderNumber: orders.find((o) => o.id === r.orderId)?.orderNumber ?? null })), meta: pageMeta(q, total) };
}

export async function respond(req: Request, id: string, patch: { status?: Status; reply?: string }) {
  return prisma.$transaction(async (tx) => {
    const found = await tx.supportRequest.findUnique({ where: { id } });
    if (!found) throw AppError.notFound('Support request not found');

    const data: { status?: Status; reply?: string; repliedById?: string; repliedAt?: Date } = {};
    if (patch.reply !== undefined) {
      data.reply = patch.reply;
      data.repliedById = req.user!.id;
      data.repliedAt = new Date();
    }
    // Answering an untouched request moves it along; an explicit status always wins.
    data.status = patch.status ?? (patch.reply !== undefined && found.status === 'OPEN' ? 'IN_PROGRESS' : undefined);

    const updated = await tx.supportRequest.update({ where: { id }, data, select: { ...own, user: { select: { id: true, email: true, fullName: true } } } });
    if (patch.reply !== undefined) {
      await notify(tx, found.userId, `Reply to your request: ${found.subject}`, patch.reply.slice(0, 200), '/account/support');
    } else if (patch.status && patch.status !== found.status) {
      await notify(tx, found.userId, `Your request is ${patch.status.toLowerCase().replace('_', ' ')}`, found.subject, '/account/support');
    }
    await audit(tx, req, { action: 'support.respond', entityType: 'SupportRequest', entityId: id, metadata: { status: data.status ?? null, replied: patch.reply !== undefined } });
    return updated;
  });
}
