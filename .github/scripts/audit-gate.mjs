/**
 * Dependency-audit gate for CI.
 *
 *   node .github/scripts/audit-gate.mjs <client|server> [--include-dev]
 *
 * Runs `npm audit --json` inside that folder and fails when it finds a HIGH or CRITICAL advisory that is not listed in
 * .github/audit-allowlist.json. An allow-list entry must say why, and it expires: an accepted risk is reviewed again on
 * the expiry date instead of being forgotten. Advisories that DO have a fix are never worth allow-listing — fix them.
 *
 * By default only production dependencies are audited (--omit=dev): that is what runs on the servers. Pass --include-dev
 * to audit the build tooling as well.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [scope, ...flags] = process.argv.slice(2);
if (!['client', 'server'].includes(scope)) {
  console.error('usage: audit-gate.mjs <client|server> [--include-dev]');
  process.exit(2);
}

const allow = JSON.parse(readFileSync(join(root, '.github', 'audit-allowlist.json'), 'utf8')).entries.filter((e) => e.scope === scope);
const today = new Date().toISOString().slice(0, 10);

const args = ['audit', '--json', ...(flags.includes('--include-dev') ? [] : ['--omit=dev'])];
const run = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd: join(root, scope), encoding: 'utf8', shell: process.platform === 'win32' });
let report;
try {
  report = JSON.parse(run.stdout);
} catch {
  console.error(`Could not read npm audit output for ${scope} (is the registry reachable?)\n${run.stderr || run.stdout}`);
  process.exit(2);
}
if (report.error) {
  console.error(`npm audit failed for ${scope}: ${report.error.summary ?? JSON.stringify(report.error)}`);
  process.exit(2);
}

// Every advisory (the objects inside `via`; strings are just "vulnerable because of another package").
const found = new Map();
for (const [pkg, v] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of v.via) {
    if (typeof via === 'string') continue;
    const id = via.url?.split('/').pop() ?? String(via.source);
    if (!found.has(id)) found.set(id, { id, severity: via.severity, title: via.title, packages: new Set() });
    found.get(id).packages.add(pkg);
  }
}

let failed = false;
const meta = report.metadata?.vulnerabilities ?? {};
console.log(`${scope}: ${meta.total ?? 0} vulnerable package(s) — critical ${meta.critical ?? 0}, high ${meta.high ?? 0}, moderate ${meta.moderate ?? 0}, low ${meta.low ?? 0}`);

for (const a of found.values()) {
  const gated = a.severity === 'high' || a.severity === 'critical';
  const entry = allow.find((e) => e.id === a.id);
  const line = `  ${a.severity.padEnd(8)} ${a.id}  ${a.title}  [${[...a.packages].join(', ')}]`;
  if (!gated) {
    console.log(`${line}  (below the gate)`);
  } else if (entry && entry.expires >= today) {
    console.log(`${line}\n           allowed until ${entry.expires}: ${entry.reason}`);
  } else if (entry) {
    console.log(`${line}\n           ALLOW-LIST ENTRY EXPIRED on ${entry.expires} — review it`);
    failed = true;
  } else {
    console.log(`${line}\n           NOT allow-listed`);
    failed = true;
  }
}

// An allow-list entry for something that no longer appears is stale; say so, but do not fail the build for it.
for (const e of allow) if (!found.has(e.id)) console.log(`  note: allow-list entry ${e.id} no longer matches any finding — remove it`);

process.exit(failed ? 1 : 0);
