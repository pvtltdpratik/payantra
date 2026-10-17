/**
 * A throwaway, PRIVATE PostgreSQL cluster for tests that need real concurrency.
 *
 * Why: the default test database (PGlite) is a single session, so overlapping transactions can't
 * truly race. A real server, with a multi-connection pool, exercises row locks, advisory locks and
 * READ COMMITTED re-checks exactly as production does.
 *
 * Safety: this NEVER touches an existing Postgres. It creates its own data directory under the OS
 * temp folder, listens only on 127.0.0.1 on a free port, and deletes everything on stop().
 *
 * It needs the server binaries (initdb, pg_ctl) — set PG_BIN, or have them on PATH / in the default
 * install location. If they cannot be found, startRealPostgres() throws a clear error.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import pg from 'pg';
import { applyMigrations, freePort } from './pglite-server.mjs';

const exe = process.platform === 'win32' ? '.exe' : '';

function findBinDir() {
  const candidates = [];
  if (process.env.PG_BIN) candidates.push(process.env.PG_BIN);
  for (const dir of (process.env.PATH ?? '').split(delimiter)) candidates.push(dir);
  const roots = [process.env.ProgramFiles && join(process.env.ProgramFiles, 'PostgreSQL'), '/usr/lib/postgresql', '/opt/homebrew/opt', '/usr/local/pgsql'];
  for (const root of roots.filter(Boolean)) {
    if (!existsSync(root)) continue;
    // Newest version first (e.g. PostgreSQL/18/bin).
    for (const v of readdirSync(root).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
      candidates.push(join(root, v, 'bin'));
    }
  }
  const found = candidates.find((d) => d && existsSync(join(d, `initdb${exe}`)) && existsSync(join(d, `pg_ctl${exe}`)));
  if (!found) throw new Error('PostgreSQL server binaries (initdb, pg_ctl) not found. Set PG_BIN to the directory containing them.');
  return found;
}

export async function startRealPostgres({ log = () => {} } = {}) {
  const bin = findBinDir();
  const dir = mkdtempSync(join(tmpdir(), 'payantra-pg-'));
  const port = await freePort();
  const run = (cmd, args, stdio = 'pipe') => execFileSync(join(bin, `${cmd}${exe}`), args, { stdio, encoding: 'utf8', timeout: 90_000 });

  try {
    run('initdb', ['-D', dir, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--no-locale']);
    // Durability is irrelevant for a disposable test database; turning it off makes it much faster.
    // stdio MUST be 'ignore' here: `pg_ctl start` leaves the server running, and a server that inherits
    // a captured pipe keeps it open forever, so execFileSync would never see the command finish.
    run(
      'pg_ctl',
      [
        '-D', dir, '-w', '-t', '60',
        '-l', join(dir, 'server.log'),
        '-o', `-p ${port} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=100`,
        'start',
      ],
      'ignore',
    );
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`Could not start a private PostgreSQL: ${err.stderr || err.message}`);
  }

  const admin = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' });
  await admin.connect();
  await admin.query('CREATE DATABASE payantra_test');
  await admin.end();

  const db = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'payantra_test' });
  await db.connect();
  // Same migrations, same order, as production.
  await applyMigrations({ exec: (sql) => db.query(sql), query: (sql, params) => db.query(sql, params) }, log);
  await db.end();

  return {
    port,
    url: `postgresql://postgres@127.0.0.1:${port}/payantra_test`,
    async stop() {
      try {
        run('pg_ctl', ['-D', dir, '-m', 'immediate', '-w', 'stop'], 'ignore');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
