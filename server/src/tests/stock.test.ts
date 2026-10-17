import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../config/prisma.js';
import { OutOfStockError, commitReservation, releaseReservation, reserveStock, restock, sellFreeStock } from '../modules/orders/stock.js';
import { makeCategory, makeProduct, resetDb } from './helpers.js';

/**
 * The stock ledger is the last line of defence against overselling: the cart and checkout checks
 * can be stale by the time a transaction runs, so these functions must refuse on their own.
 * They are tested directly (not through checkout) precisely so that guard is exercised.
 */
let orderId: string;

beforeEach(async () => {
  await resetDb();
  orderId = randomUUID();
});

async function variant(onHand: number, reserved = 0) {
  const cat = await makeCategory('Stock');
  const p = await makeProduct({ name: 'P', categoryId: cat.id, variants: [{ sku: `S-${randomUUID().slice(0, 6)}`, onHand, reserved }] });
  return p.variants[0].id;
}
const inv = (variantId: string) => prisma.inventory.findUniqueOrThrow({ where: { variantId } });
const tx = <T>(fn: Parameters<typeof prisma.$transaction>[0] & ((t: any) => Promise<T>)) => prisma.$transaction(fn as never) as Promise<T>;

describe('reserveStock', () => {
  it('reserves up to exactly the free units and refuses one more', async () => {
    const v = await variant(5, 2); // 3 free
    await tx((t) => reserveStock(t, orderId, [{ variantId: v, quantity: 3 }]));
    expect(await inv(v)).toMatchObject({ onHand: 5, reserved: 5 });

    await expect(tx((t) => reserveStock(t, orderId, [{ variantId: v, quantity: 1 }]))).rejects.toBeInstanceOf(OutOfStockError);
    expect(await inv(v)).toMatchObject({ onHand: 5, reserved: 5 });
  });

  it('refuses to reserve more than is free even when asked for everything at once', async () => {
    const v = await variant(2);
    const err = await tx((t) => reserveStock(t, orderId, [{ variantId: v, quantity: 3 }])).catch((e) => e);
    expect(err).toBeInstanceOf(OutOfStockError);
    expect(err.status).toBe(409);
    expect(err.details).toEqual({ variantId: v });
    expect(await inv(v)).toMatchObject({ reserved: 0 });
  });

  it('is all-or-nothing across lines: one short line undoes the lines before it', async () => {
    const plenty = await variant(10);
    const scarce = await variant(1);
    // Fix the lock order deterministically so "plenty" is processed first when its id sorts first.
    const [first, second] = [plenty, scarce].sort();
    const lines = [
      { variantId: first, quantity: first === scarce ? 5 : 2 },
      { variantId: second, quantity: second === scarce ? 5 : 2 },
    ];
    await expect(tx((t) => reserveStock(t, orderId, lines))).rejects.toBeInstanceOf(OutOfStockError);
    expect((await inv(plenty)).reserved).toBe(0);
    expect((await inv(scarce)).reserved).toBe(0);
    expect(await prisma.stockMovement.count()).toBe(0); // the ledger rolled back with it
  });

  it('merges duplicate lines for the same variant before checking', async () => {
    const v = await variant(3);
    await expect(
      tx((t) => reserveStock(t, orderId, [{ variantId: v, quantity: 2 }, { variantId: v, quantity: 2 }])),
    ).rejects.toBeInstanceOf(OutOfStockError);
    expect((await inv(v)).reserved).toBe(0);
  });

  it('never lets simultaneous buyers reserve more units than exist', async () => {
    const v = await variant(5);
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => tx((t) => reserveStock(t, randomUUID(), [{ variantId: v, quantity: 1 }]))));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(7);
    const i = await inv(v);
    expect(i.reserved).toBe(5);
    expect(i.reserved).toBeLessThanOrEqual(i.onHand);
  });
});

describe('release, commit, restock', () => {
  it('release hands reservations back, and refuses to release more than was reserved', async () => {
    const v = await variant(5, 3);
    await tx((t) => releaseReservation(t, orderId, [{ variantId: v, quantity: 2 }], 'expired'));
    expect(await inv(v)).toMatchObject({ onHand: 5, reserved: 1 });
    await expect(tx((t) => releaseReservation(t, orderId, [{ variantId: v, quantity: 2 }], 'oops'))).rejects.toThrow(/ledger mismatch/i);
    expect((await inv(v)).reserved).toBe(1);
  });

  it('commit turns reserved units into sold units, and refuses to sell units that were never reserved', async () => {
    const v = await variant(5, 2);
    await tx((t) => commitReservation(t, orderId, [{ variantId: v, quantity: 2 }]));
    expect(await inv(v)).toMatchObject({ onHand: 3, reserved: 0 });
    await expect(tx((t) => commitReservation(t, orderId, [{ variantId: v, quantity: 1 }]))).rejects.toThrow(/ledger mismatch/i);
    expect(await inv(v)).toMatchObject({ onHand: 3, reserved: 0 });
  });

  it('sellFreeStock refuses to take units that are reserved for someone else', async () => {
    const v = await variant(5, 4); // 1 free
    await expect(tx((t) => sellFreeStock(t, orderId, [{ variantId: v, quantity: 2 }]))).rejects.toBeInstanceOf(OutOfStockError);
    await tx((t) => sellFreeStock(t, orderId, [{ variantId: v, quantity: 1 }]));
    expect(await inv(v)).toMatchObject({ onHand: 4, reserved: 4 });
  });

  it('restock adds units back and records a signed movement', async () => {
    const v = await variant(1);
    await tx((t) => restock(t, orderId, [{ variantId: v, quantity: 3 }], 'Returned'));
    expect((await inv(v)).onHand).toBe(4);
    expect(await prisma.stockMovement.findFirstOrThrow({ where: { orderId } })).toMatchObject({ type: 'RETURNED', quantity: 3 });
  });

  it('the database itself refuses an impossible state (reserved above on-hand)', async () => {
    const v = await variant(2);
    await expect(prisma.inventory.update({ where: { variantId: v }, data: { reserved: 3 } })).rejects.toThrow();
  });
});
