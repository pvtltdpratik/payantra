import type { Prisma } from '../config/prisma.js';

type Db = Pick<Prisma.TransactionClient, 'notification'>;

/** In-app notification, written in the same transaction as the event it announces. */
export async function notify(db: Db, userId: string, title: string, body: string, linkUrl?: string): Promise<void> {
  await db.notification.create({ data: { userId, title, body, linkUrl } });
}
