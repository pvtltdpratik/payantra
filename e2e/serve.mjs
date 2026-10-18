/**
 * Starts the whole stack (throwaway database, mock Supabase/Razorpay, the API, a PRODUCTION build of the storefront)
 * and leaves it running, so a person or a tool (Lighthouse, a screenshot script) can browse it.
 *
 *   node serve.mjs                 PGlite, builds the storefront
 *   E2E_SKIP_BUILD=1 node serve.mjs   reuse the previous build (only if no client code changed)
 *
 * Prints the storefront URL and an admin login, then waits; press Ctrl+C to stop everything.
 */
import { startStack } from './lib/stack.mjs';

const stack = await startStack({ log: (m) => console.log(`  ${m}`) });
console.log(`\nSTOREFRONT ${stack.web}\nAPI        ${stack.api}`);
console.log(`ADMIN      ${stack.accounts.admin.email}  /  ${stack.accounts.admin.password}`);
console.log('READY');

const stop = async () => {
  await stack.stop().catch(() => undefined);
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => undefined, 1 << 30); // keep the process alive
