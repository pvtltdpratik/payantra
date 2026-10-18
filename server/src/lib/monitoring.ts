import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { scrubDeep, scrubString } from './redact.js';

/**
 * Error reporting hook. Provider-neutral by construction:
 *
 *  1. Every reported error is ALWAYS written to the log as a structured `level:50` line (alert on that in
 *     CloudWatch / Loki / Datadog and no SDK is needed).
 *  2. If SENTRY_DSN is set it is additionally POSTed to that project, using Sentry's documented envelope
 *     endpoint over plain `fetch` — no SDK, no monkey-patching, nothing loaded when the variable is unset.
 *
 * Reporting is fire-and-forget with a short timeout and can never throw into the request path.
 * Payloads go through the same scrubbers as the logs: no request bodies, headers or user e-mails are sent.
 */
export interface ErrorContext {
  requestId?: string;
  method?: string;
  path?: string;
  userId?: string;
  extra?: Record<string, unknown>;
}

interface ParsedDsn {
  endpoint: string;
  publicKey: string;
}

export function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.split('/').filter(Boolean).pop();
    if (!u.username || !projectId) return null;
    const prefix = u.pathname.split('/').filter(Boolean).slice(0, -1).join('/');
    return { endpoint: `${u.protocol}//${u.host}${prefix ? `/${prefix}` : ''}/api/${projectId}/envelope/`, publicKey: u.username };
  } catch {
    return null;
  }
}

const dsn = env.SENTRY_DSN ? parseDsn(env.SENTRY_DSN) : null;
if (env.SENTRY_DSN && !dsn) logger.warn('SENTRY_DSN is set but could not be parsed; errors will only be logged');

/** Builds the Sentry envelope for one exception. Exported for tests. */
export function buildEnvelope(err: unknown, ctx: ErrorContext, release?: string): string {
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'Non-error thrown');
  const eventId = randomUUID().replace(/-/g, '');
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: 'node',
    level: 'error',
    environment: env.NODE_ENV,
    ...(release ? { release } : {}),
    exception: { values: [{ type: e.name, value: scrubString(e.message), stacktrace: { frames: parseStack(e.stack) } }] },
    tags: { ...(ctx.requestId ? { request_id: ctx.requestId } : {}), ...(ctx.method ? { method: ctx.method } : {}) },
    request: ctx.path ? { url: scrubString(ctx.path), method: ctx.method } : undefined,
    user: ctx.userId ? { id: ctx.userId } : undefined,
    extra: ctx.extra ? scrubDeep(ctx.extra) : undefined,
  };
  const header = JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() });
  const item = JSON.stringify({ type: 'event' });
  return `${header}\n${item}\n${JSON.stringify(event)}\n`;
}

function parseStack(stack?: string) {
  if (!stack) return [];
  const frames = stack
    .split('\n')
    .slice(1)
    .map((l) => /^\s*at (?:(.*?) \()?(.*?):(\d+):(\d+)\)?$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ function: m[1], filename: scrubString(m[2]), lineno: Number(m[3]), colno: Number(m[4]) }));
  return frames.reverse(); // Sentry wants the oldest frame first
}

export function reportError(err: unknown, ctx: ErrorContext = {}, message = 'Unhandled error'): void {
  try {
    logger.error({ err, ...ctx }, message);
    if (!dsn || !env.SENTRY_DSN) return;
    const body = buildEnvelope(err, ctx, env.RELEASE);
    void fetch(dsn.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-sentry-envelope',
        'x-sentry-auth': `Sentry sentry_version=7, sentry_client=payantra-fetch/1.0, sentry_key=${dsn.publicKey}`,
      },
      body,
      signal: AbortSignal.timeout(3000),
    }).catch((sendErr: unknown) => logger.warn({ err: sendErr }, 'Could not deliver error report'));
  } catch {
    /* monitoring must never break the thing it monitors */
  }
}
