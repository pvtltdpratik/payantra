/**
 * Detects drift between prisma/migrations/*.sql and prisma/schema.prisma.
 *
 * Replays every migration into a throwaway shadow database (PGlite behind a socket) and asks
 * Prisma to diff the result against the schema. Exits non-zero when they disagree, so a migration
 * that was edited by hand but not reflected in the schema (or vice versa) fails CI.
 *
 *   npm run db:drift
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort } from './lib/pglite-server.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = new PGlite();
await db.waitReady;
const port = await freePort();
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 5 });
await server.start();

// sslmode=disable: the in-process PGlite socket does not speak TLS.
const shadow = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`;

// Must be async: the shadow database lives in THIS process, so blocking the event loop
// (spawnSync) would stop it from answering Prisma.
const run = await new Promise((resolve) => {
  const child = spawn(
    process.execPath,
    [
      join(root, 'node_modules', 'prisma', 'build', 'index.js'),
      'migrate',
      'diff',
      '--from-migrations',
      'prisma/migrations',
      '--to-schema',
      'prisma/schema.prisma',
      '--script',
    ],
    // prisma.config.ts reads these; the shadow DB is where the migrations get replayed.
    { cwd: root, env: { ...process.env, DATABASE_URL: shadow, SHADOW_DATABASE_URL: shadow } },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => (stdout += d));
  child.stderr.on('data', (d) => (stderr += d));
  child.on('close', (status) => resolve({ status, stdout, stderr }));
});

await server.stop();
await db.close();

const out = run.stdout.trim();
const err = run.stderr.trim();
if (run.status !== 0) {
  console.error('prisma migrate diff failed:\n' + err + '\n' + out);
  process.exit(2);
}

// An empty diff script is "-- This is an empty migration."
const meaningful = out
  .split('\n')
  .filter((l) => l.trim() && !l.trim().startsWith('--'))
  .join('\n');

if (meaningful) {
  console.error('DRIFT: schema.prisma and the migrations disagree. Prisma would apply:\n\n' + out);
  process.exit(1);
}
console.log('No drift: migrations and schema.prisma agree.');
