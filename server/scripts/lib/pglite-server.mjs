/**
 * Real Postgres (PGlite, WASM) exposed over the wire protocol so Prisma can connect to it.
 * Used by `npm run db:dev` (local development without RDS) and by the integration tests.
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'prisma', 'migrations');

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** Applies every migration directory (sorted) that has not been applied to this database yet. */
export async function applyMigrations(db, log = () => {}) {
  await db.exec(`create table if not exists "_dev_migrations" (name text primary key, applied_at timestamptz default now())`);
  const done = new Set((await db.query(`select name from "_dev_migrations"`)).rows.map((r) => r.name));
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const name of dirs) {
    if (done.has(name)) continue;
    await db.exec(readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8'));
    await db.query(`insert into "_dev_migrations"(name) values ($1)`, [name]);
    log(`applied migration ${name}`);
  }
}

/**
 * @param {{ dataDir?: string, port?: number, log?: (m: string) => void }} opts
 *   dataDir omitted → in-memory database that disappears when the process exits.
 */
export async function startPglite({ dataDir, port, log = () => {} } = {}) {
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  await db.waitReady;
  await applyMigrations(db, log);

  const listenPort = port ?? (await freePort());
  const server = new PGLiteSocketServer({ db, port: listenPort, host: '127.0.0.1', maxConnections: 20 });
  await server.start();

  return {
    db,
    port: listenPort,
    url: `postgresql://postgres:postgres@127.0.0.1:${listenPort}/postgres`,
    async stop() {
      await server.stop();
      await db.close();
    },
  };
}
