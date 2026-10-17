import { Router } from 'express';
import { prisma } from '../../config/prisma.js';

export const healthRouter = Router();

/** Liveness: process is up. Used by load balancers; must never touch dependencies. */
healthRouter.get('/', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', uptime: Math.round(process.uptime()) } });
});

/** Readiness: dependencies reachable. Returns 503 so orchestrators stop routing traffic. */
healthRouter.get('/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ success: true, data: { status: 'ready', database: 'up' } });
  } catch {
    res.status(503).json({ success: false, error: { code: 'NOT_READY', message: 'Database unreachable' } });
  }
});
