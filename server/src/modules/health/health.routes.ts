import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { isShuttingDown } from '../../lib/lifecycle.js';
import { renderMetrics } from '../../lib/metrics.js';

export const healthRouter = Router();

const DB_CHECK_TIMEOUT_MS = 2000;

/** Liveness: process is up. Used by load balancers; must never touch dependencies. */
healthRouter.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, data: { status: 'ok', uptime: Math.round(process.uptime()), ...(env.RELEASE ? { release: env.RELEASE } : {}) } });
});

/**
 * Readiness: dependencies reachable AND not draining. Returns 503 so orchestrators stop routing traffic —
 * during shutdown this flips first, which is what lets a deploy finish without dropping requests.
 * A hung database must not hang the probe, hence the timeout.
 */
healthRouter.get('/ready', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (isShuttingDown()) {
    return void res.status(503).json({ success: false, error: { code: 'SHUTTING_DOWN', message: 'Instance is draining' } });
  }
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('db timeout')), DB_CHECK_TIMEOUT_MS).unref()),
    ]);
    res.json({ success: true, data: { status: 'ready', database: 'up' } });
  } catch {
    // The reason stays in the logs/metrics; the probe response never describes the infrastructure.
    res.status(503).json({ success: false, error: { code: 'NOT_READY', message: 'Database unreachable' } });
  }
});

function tokenMatches(header: string | undefined, expected: string): boolean {
  const given = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Prometheus-format metrics. Does not exist unless METRICS_TOKEN is configured, and then requires it as a
 * bearer token — metrics describe traffic and routes, which is not for the public internet.
 */
healthRouter.get('/metrics', (req, res, next) => {
  if (!env.METRICS_TOKEN) return next(); // falls through to the standard 404
  if (!tokenMatches(req.headers.authorization, env.METRICS_TOKEN)) {
    return void res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.type('text/plain; version=0.0.4').send(renderMetrics({ release: env.RELEASE }));
});
