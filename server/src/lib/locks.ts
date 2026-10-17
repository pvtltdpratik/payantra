import type { Prisma } from '../config/prisma.js';

/**
 * Takes a transaction-scoped advisory lock on an arbitrary string key. Anyone else asking for the
 * same key waits until this transaction ends; unrelated keys never block each other.
 *
 * Prefer this to `Serializable` isolation for "check, then change" logic: Serializable can abort
 * unrelated transactions with serialization failures under real concurrency, while a keyed lock
 * serialises exactly the operations that conflict.
 *
 * (The outer SELECT matters: Prisma cannot deserialise the `void` the lock function returns.)
 */
export async function advisoryLock(tx: Pick<Prisma.TransactionClient, '$queryRaw'>, key: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS "locked" FROM (SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))) AS l`;
}
