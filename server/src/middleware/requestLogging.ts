import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { logger } from '../config/logger.js';
import { recordRequest } from '../lib/metrics.js';
import { scrubString } from '../lib/redact.js';

/** A caller-supplied id is only trusted if it is boring: it ends up in logs and in a response header. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

export function requestIdFor(req: IncomingMessage): string {
  const inbound = req.headers['x-request-id'];
  const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
  return candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();
}

/** Never log the query string (search terms and filters routinely contain e-mail addresses and phone numbers). */
function pathOnly(url: string | undefined): string {
  return scrubString((url ?? '').split('?')[0] ?? '');
}

/**
 * Request id + one structured access-log line per request.
 *
 * - `req.id` / `X-Request-Id`: propagated from the load balancer when it sent a sane one, generated otherwise.
 *   Every log line written during the request (pino-http's `req.log`) carries it.
 * - What is logged about the request is an allow-list (method, path, user agent, address) — not the headers.
 */
export const createRequestLogging = (log: Logger) =>
  pinoHttp({
    logger: log,
    genReqId: (req, res) => {
      const id = requestIdFor(req);
      res.setHeader('X-Request-Id', id);
      return id;
    },
    autoLogging: { ignore: (req) => req.url?.startsWith('/api/v1/health') ?? false },
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    serializers: {
      req: (req: IncomingMessage & { id?: string; remoteAddress?: string }) => ({
        id: req.id,
        method: req.method,
        path: pathOnly(req.url),
        userAgent: scrubString(String(req.headers?.['user-agent'] ?? '')).slice(0, 200),
        remoteAddress: req.socket?.remoteAddress,
      }),
      res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
    },
    customProps: (req) => {
      const user = (req as { user?: { id: string; role: string } }).user;
      return user ? { userId: user.id, role: user.role } : {};
    },
  });

export const requestLogging = createRequestLogging(logger);

/**
 * The route PATTERN of a finished request ("/api/v1/orders/:id/cancel"), never the raw URL: a label per distinct id would
 * be unbounded cardinality, and ids/slugs/e-mails in a metrics store are data that should not be there.
 *
 * Express resets `req.baseUrl` when an error unwinds out of a router, but `req.route` (the matched pattern, relative to its
 * mount point) and `req.originalUrl` survive, so the mount prefix is whatever precedes the route's own segments in the URL.
 */
export function routeLabel(req: { route?: { path?: unknown }; originalUrl?: string; url?: string }): string {
  const pattern = req.route?.path;
  if (typeof pattern !== 'string') return 'unmatched';
  const own = pattern.split('/').filter(Boolean);
  const actual = (req.originalUrl ?? req.url ?? '').split('?')[0].split('/').filter(Boolean);
  if (own.length > actual.length) return 'unmatched';
  return `/${[...actual.slice(0, actual.length - own.length), ...own].join('/')}`;
}

/** Feeds the in-process metrics from the same request lifecycle. */
export const metricsMiddleware = (
  req: IncomingMessage & { route?: { path?: unknown }; originalUrl?: string },
  res: ServerResponse,
  next: () => void,
) => {
  const start = process.hrtime.bigint();
  res.once('finish', () => {
    recordRequest(req.method ?? 'GET', routeLabel(req), res.statusCode, Number(process.hrtime.bigint() - start) / 1e9);
  });
  next();
};
