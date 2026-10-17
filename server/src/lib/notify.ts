import type { Prisma } from '../config/prisma.js';

type Db = Pick<Prisma.TransactionClient, 'notification'>;

/** In-app notification, written in the same transaction as the event it announces. */
export async function notify(db: Db, userId: string, title: string, body: string, linkUrl?: string): Promise<void> {
  await db.notification.create({ data: { userId, title, body, linkUrl } });
}

/** Tells every active admin about something that needs attention (a rejected assignment, a failed delivery…). */
export async function notifyAdmins(
  db: Pick<Prisma.TransactionClient, 'notification' | 'profile'>,
  title: string,
  body: string,
  linkUrl?: string,
): Promise<void> {
  const admins = await db.profile.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } });
  if (admins.length === 0) return;
  await db.notification.createMany({ data: admins.map((a) => ({ userId: a.id, title, body, linkUrl })) });
}
