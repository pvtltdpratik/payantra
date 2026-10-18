import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/prisma.js';
import { createShutdown } from './lib/lifecycle.js';
import { reportError } from './lib/monitoring.js';
import { startExpirySweeper } from './modules/orders/expiry.js';

const server = createApp().listen(env.PORT, () => {
  logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV, release: env.RELEASE }, 'Payantra API listening');
});

// Must outlive the load balancer's idle timeout (ALB default 60s), or the ALB reuses a socket this side has
// just closed and the customer sees a sporadic 502.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

// Frees stock held by abandoned online payments. Safe to run on several instances at once:
// every order is locked and re-checked inside its own transaction.
const stopSweeper = startExpirySweeper(env.ORDER_EXPIRY_SWEEP_SECONDS);

const shutdown = createShutdown({
  server,
  stopBackground: stopSweeper,
  closeResources: () => prisma.$disconnect(),
  exit: (code) => process.exit(code),
  log: (msg, extra) => logger.info(extra ?? {}, msg),
  drainMs: env.SHUTDOWN_DRAIN_SECONDS * 1000,
  timeoutMs: env.SHUTDOWN_TIMEOUT_SECONDS * 1000,
});

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// A rejected promise nobody awaited is a bug, not a reason to take the shop down; log and report it.
process.on('unhandledRejection', (reason) => reportError(reason, {}, 'Unhandled promise rejection'));
// State after an uncaught exception is undefined: report, then leave through the orderly path so the orchestrator restarts us.
process.on('uncaughtException', (err) => {
  reportError(err, {}, 'Uncaught exception');
  void shutdown('uncaughtException', 1);
});
