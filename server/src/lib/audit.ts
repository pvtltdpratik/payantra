import type { Request } from 'express';
import type { Prisma } from '../config/prisma.js';

type Db = Pick<Prisma.TransactionClient, 'auditLog'>;

export interface AuditEntry {
  action: string; // e.g. "product.create"
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Writes an audit row using the SAME transaction client as the change it describes,
 * so an action and its audit record commit or roll back together.
 */
export async function audit(db: Db, req: Request, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: req.user?.id ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata,
      ip: req.ip ?? null,
    },
  });
}
