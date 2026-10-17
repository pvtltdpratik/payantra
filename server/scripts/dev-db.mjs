/**
 * Local development database — a real Postgres (PGlite) persisted in server/.pglite.
 * Lets you run the whole stack with no AWS RDS instance.
 *
 *   npm run db:dev            # starts on port 5433
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres
 *
 * Production uses AWS RDS PostgreSQL; this is for local work only.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPglite } from './lib/pglite-server.mjs';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '.pglite');
const port = Number(process.env.DEV_DB_PORT ?? 5433);

const pg = await startPglite({ dataDir, port, log: (m) => console.log(m) });
console.log(`\nPayantra dev database ready (data: ${dataDir})`);
console.log(`DATABASE_URL=${pg.url}`);
// PGlite is a single Postgres session shared by all connections: overlapping transactions from a
// multi-connection pool interleave and fail. A pool of one serialises them correctly.
console.log(`DATABASE_POOL_MAX=1   # required with this dev database; use the default (10) on RDS\n`);

const shutdown = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
