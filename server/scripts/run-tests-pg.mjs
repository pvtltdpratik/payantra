/**
 * Runs the whole suite against a private, real PostgreSQL server (see scripts/lib/real-postgres.mjs).
 *   npm run test:pg
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn(process.execPath, [join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, TEST_DB: 'postgres', NODE_ENV: 'test' },
});
child.on('exit', (code) => process.exit(code ?? 1));
