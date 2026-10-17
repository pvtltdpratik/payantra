import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/prisma.js';
import { startExpirySweeper } from './modules/orders/expiry.js';

const server = createApp().listen(env.PORT, () => {
  logger.info(`Payantra API listening on :${env.PORT} (${env.NODE_ENV})`);
});

// Frees stock held by abandoned online payments. Safe to run on several instances at once:
// every order is locked and re-checked inside its own transaction.
const stopSweeper = startExpirySweeper(env.ORDER_EXPIRY_SWEEP_SECONDS);

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  stopSweeper();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  // Hard stop if connections refuse to drain.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
