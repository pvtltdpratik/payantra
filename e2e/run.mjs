/**
 * Full-stack end-to-end suite.
 *
 *   npm run e2e                       all specs
 *   npm run e2e -- shopper admin      only those specs
 *   E2E_DB=postgres npm run e2e       against a private real PostgreSQL instead of PGlite
 *   BROWSER_PATH=… npm run e2e        pick the Chromium-based browser
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { artifacts, launchBrowser } from './lib/browser.mjs';
import { startStack } from './lib/stack.mjs';

// Order matters: later specs build on orders and accounts created by earlier ones.
const ALL = ['auth', 'shopper', 'admin', 'catalogue', 'delivery', 'experience', 'home', 'responsive'];
const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const specs = wanted.length ? ALL.filter((s) => wanted.includes(s)) : ALL;

const results = [];
let currentSection = '';
const t = {
  section(name) {
    currentSection = name;
    console.log(`\n▸ ${name}`);
  },
  check(name, ok, detail = '') {
    results.push({ section: currentSection, name, ok: !!ok, detail });
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${String(detail).slice(0, 160)}` : ''}`);
    return !!ok;
  },
  /** Runs an assertion that may throw (e.g. a timeout waiting for the UI) and records it as a check. */
  async attempt(name, fn) {
    try {
      const detail = await fn();
      return t.check(name, true, typeof detail === 'string' ? detail : '');
    } catch (err) {
      return t.check(name, false, err.message.split('\n')[0]);
    }
  },
};

console.log('Starting the Payantra stack…');
const started = Date.now();
let stack;
let browser;
try {
  stack = await startStack({ log: (m) => console.log(`  ${m}`) });
  browser = await launchBrowser();
  console.log(`Ready in ${Math.round((Date.now() - started) / 1000)}s  (web ${stack.web}, api ${stack.api})`);

  const shared = {};
  for (const name of specs) {
    const spec = await import(`./specs/${name}.spec.mjs`);
    try {
      await spec.run({ stack, browser, t, shared });
    } catch (err) {
      t.check(`spec "${name}" ran to completion`, false, err.stack?.split('\n').slice(0, 3).join(' | ') ?? err.message);
    }
  }
} catch (err) {
  console.error('\nCould not run the suite:', err.message);
  results.push({ section: 'setup', name: 'stack started', ok: false, detail: err.message });
} finally {
  await browser?.close().catch(() => undefined);
  const logs = stack?.logs?.();
  await stack?.stop().catch(() => undefined);
  if (logs && results.some((r) => !r.ok)) {
    mkdirSync(artifacts, { recursive: true });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(artifacts, 'api.log'), logs.api);
    writeFileSync(join(artifacts, 'web.log'), logs.web);
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  [${f.section}] ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  console.log(`\n(server/web logs saved in ${artifacts})`);
}
process.exit(failed.length ? 1 : 0);
