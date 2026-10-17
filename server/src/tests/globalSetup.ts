import { startMockRazorpay } from '../../scripts/lib/mock-razorpay.mjs';
import { startPglite } from '../../scripts/lib/pglite-server.mjs';
import { startRealPostgres } from '../../scripts/lib/real-postgres.mjs';

/**
 * Boots the two external dependencies every integration test needs:
 *  - a Postgres with all migrations applied                 → DATABASE_URL
 *      default:            PGlite (in-memory, no install needed, ONE session)
 *      TEST_DB=postgres:   a private throwaway cluster on a real PostgreSQL server, with a real
 *                          multi-connection pool — this is what proves the concurrency guarantees
 *  - a mock Razorpay REST API                               → RAZORPAY_API_BASE, RAZORPAY_SIM_BASE
 * Workers are spawned after this runs, so they inherit these variables.
 *
 * The key id/secret MUST match the dummy values in vitest.config.mts.
 */
export default async function setup() {
  const real = process.env.TEST_DB === 'postgres';
  const db = real ? await startRealPostgres() : await startPglite();
  process.env.DATABASE_URL = db.url;

  const razorpay = await startMockRazorpay({ keyId: 'rzp_test_dummy', keySecret: 'dummy_secret' });
  process.env.RAZORPAY_API_BASE = razorpay.apiBase;
  process.env.RAZORPAY_SIM_BASE = razorpay.simBase;

  return async () => {
    await razorpay.stop();
    await db.stop();
  };
}
