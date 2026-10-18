import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Production behaviour of the operational surface: what errors look like to a caller, what ends up in the logs and in
 * the error reporter, the health/metrics endpoints, and the shutdown sequence. `config/env` is replaced with a
 * production-mode copy; the logger writes into an array so the tests can read exactly what an operator would see.
 */
const h = await vi.hoisted(async () => {
  const { createServer } = await import('node:http');
  const logLines: string[] = [];
  const sentry: { url: string; headers: Record<string, string | string[] | undefined>; body: string }[] = [];
  const sink = {
    write(chunk: string) {
      logLines.push(chunk);
    },
  };
  const stub = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      sentry.push({ url: req.url ?? '', headers: req.headers, body });
      res.statusCode = 200;
      res.end('{}');
    });
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', () => r()));
  const port = (stub.address() as { port: number }).port;
  return { logLines, sentry, sink, stub, port };
});

vi.mock('../config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/env.js')>();
  return {
    ...actual,
    env: {
      ...actual.env,
      NODE_ENV: 'production',
      RELEASE: 'rel-2026-10-abc123',
      METRICS_TOKEN: 'metrics-token-0123456789abcdef',
      SENTRY_DSN: `http://pubkey123@127.0.0.1:${h.port}/42`,
    },
  };
});

vi.mock('../config/logger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/logger.js')>();
  return { ...actual, logger: actual.createLogger(h.sink as never, 'info') };
});

const { createApp } = await import('../app.js');
const { errorHandler, notFoundHandler } = await import('../middleware/error.js');
const { requestLogging } = await import('../middleware/requestLogging.js');
const { buildEnvelope, parseDsn } = await import('../lib/monitoring.js');
const { createShutdown, isShuttingDown, resetLifecycle } = await import('../lib/lifecycle.js');
const { resetMetrics } = await import('../lib/metrics.js');

afterAll(() => h.stub.close());

const lines = () => h.logLines.map((l) => JSON.parse(l) as Record<string, any>);
const logText = () => h.logLines.join('');

beforeEach(() => {
  h.logLines.length = 0;
  h.sentry.length = 0;
  resetLifecycle();
  resetMetrics();
});

/** A tiny app with the real logging and error middleware and a few endpoints that fail in nasty ways. */
function probe() {
  const app = express();
  app.use(requestLogging);
  app.get('/boom', () => {
    throw new Error('connect ECONNREFUSED postgresql://app:hunter2@db.internal:5432/payantra while loading bob@example.test');
  });
  app.get('/async-boom', async () => {
    throw Object.assign(new Error('relation "Order" does not exist'), { code: '42P01', stack: 'Error: x\n    at secret (/srv/app/dist/modules/orders/orders.service.js:88:11)' });
  });
  app.get('/string-boom', () => {
    throw 'a plain string with token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln';
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

async function waitFor<T>(fn: () => T | undefined, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('what a caller sees when the server fails (production mode)', () => {
  it.each(['/boom', '/async-boom', '/string-boom'])('%s → a generic 500 with a request id and nothing else', async (path) => {
    const res = await request(probe()).get(path).set('X-Request-Id', 'client-trace-0001');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: { code: 'INTERNAL_ERROR', requestId: 'client-trace-0001', message: 'Something went wrong' } });
    expect(res.headers['x-request-id']).toBe('client-trace-0001');
    const raw = res.text;
    for (const secret of ['hunter2', 'postgresql', 'ECONNREFUSED', 'db.internal', 'bob@example.test', '42P01', 'Order', 'orders.service', '/srv/app', 'node_modules', 'eyJ']) {
      expect(raw, secret).not.toContain(secret);
    }
  });

  it('an unknown route and a malformed body are boring too', async () => {
    const app = probe();
    const missing = await request(app).get('/nope');
    expect(missing.status).toBe(404);
    expect(Object.keys(missing.body.error).sort()).toEqual(['code', 'message']);
    const bad = await request(express().use(express.json()).use(errorHandler)).post('/').set('Content-Type', 'application/json').send('{oops');
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toMatch(/SyntaxError|Unexpected|position|stack/i);
  });
});

describe('what an operator sees in the logs', () => {
  it('is one JSON object per line, tagged with service, release and the request id', async () => {
    await request(probe()).get('/boom').set('X-Request-Id', 'trace-for-logs-77');
    const all = lines();
    expect(all.length).toBeGreaterThanOrEqual(2); // the error report and the access line
    for (const l of all) {
      expect(l.service).toBe('payantra-api');
      expect(l.release).toBe('rel-2026-10-abc123');
      expect(l.time).toMatch(/^\d{4}-\d\d-\d\dT/);
    }
    const access = all.find((l) => l.req && l.res);
    expect(access).toMatchObject({ level: 50, req: { id: 'trace-for-logs-77', method: 'GET', path: '/boom' }, res: { statusCode: 500 } });
    const report = all.find((l) => l.msg === 'Unhandled error');
    expect(report).toMatchObject({ level: 50, requestId: 'trace-for-logs-77', path: '/boom' });
    expect(report!.err.message).toContain('ECONNREFUSED'); // the operator DOES get the diagnosis…
  });

  it('…but never the secrets inside it', async () => {
    await request(probe()).get('/boom');
    await request(probe()).get('/string-boom');
    const text = logText();
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('bob@example.test');
    expect(text).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(text).toContain('[redacted-email]');
  });

  it('does not log credentials, cookies, query strings or the caller’s headers', async () => {
    await request(createApp())
      .get('/api/v1/search?q=carol%40example.test&token=tok9z8y7x')
      .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl')
      .set('Cookie', 'sb-access-token=supersecretcookie')
      .set('X-Razorpay-Signature', 'deadbeefsignature')
      .set('User-Agent', 'jest/ua carol@example.test');
    const text = logText();
    expect(text).toContain('/api/v1/search');
    for (const secret of ['carol', 'tok9z8y7x', 'eyJhbGci', 'supersecretcookie', 'deadbeefsignature', 'authorization', 'cookie']) {
      expect(text.toLowerCase(), secret).not.toContain(secret.toLowerCase());
    }
  });

  it('keeps card numbers out of anything logged', async () => {
    const { logger } = await import('../config/logger.js');
    logger.info({ note: 'declined 4111 1111 1111 1111', card: '4111111111111111', nested: { cardNumber: '4111111111111111' } }, 'Payment failed for card 4111111111111111');
    const text = logText();
    expect(text).not.toMatch(/4111/);
  });

  it('stays quiet about health probes (they would drown the real traffic)', async () => {
    await request(createApp()).get('/api/v1/health');
    await request(createApp()).get('/api/v1/health/ready');
    expect(lines().filter((l) => l.req)).toHaveLength(0);
  });
});

describe('error reporting (Sentry-compatible, optional)', () => {
  it('delivers a scrubbed envelope to the configured project, without an SDK', async () => {
    await request(probe()).get('/boom').set('X-Request-Id', 'trace-for-sentry-9').set('Authorization', 'Bearer should-never-be-sent');
    const got = await waitFor(() => h.sentry[0]);
    expect(got.url).toBe('/api/42/envelope/');
    expect(got.headers['content-type']).toBe('application/x-sentry-envelope');
    expect(String(got.headers['x-sentry-auth'])).toContain('sentry_key=pubkey123');

    const [header, item, event] = got.body.trim().split('\n').map((l) => JSON.parse(l));
    expect(header.event_id).toMatch(/^[0-9a-f]{32}$/);
    expect(item).toEqual({ type: 'event' });
    expect(event).toMatchObject({ environment: 'production', release: 'rel-2026-10-abc123', platform: 'node', tags: { request_id: 'trace-for-sentry-9', method: 'GET' } });
    expect(event.exception.values[0].type).toBe('Error');
    for (const secret of ['hunter2', 'bob@example.test', 'should-never-be-sent', 'Bearer']) expect(got.body, secret).not.toContain(secret);
  });

  it('parses DSNs the way Sentry documents them, and refuses nonsense', () => {
    expect(parseDsn('https://abc@o123.ingest.sentry.io/456')).toEqual({ endpoint: 'https://o123.ingest.sentry.io/api/456/envelope/', publicKey: 'abc' });
    expect(parseDsn('https://abc:ignored@sentry.example.com/prefix/7')).toEqual({ endpoint: 'https://sentry.example.com/prefix/api/7/envelope/', publicKey: 'abc' });
    expect(parseDsn('https://sentry.io/1')).toBeNull(); // no key
    expect(parseDsn('not a dsn')).toBeNull();
  });

  it('never throws, whatever it is given', () => {
    expect(() => buildEnvelope(undefined, {})).not.toThrow();
    expect(() => buildEnvelope({ weird: true }, { extra: { cyc: (() => { const o: any = {}; o.o = o; return o; })() } })).not.toThrow();
  });
});

describe('health and metrics', () => {
  const app = createApp();

  it('liveness reports the release and is never cached', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'ok', release: 'rel-2026-10-abc123' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('readiness turns to 503 the moment shutdown begins, before anything is closed', async () => {
    expect((await request(app).get('/api/v1/health/ready')).status).toBe(200);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const shutdown = createShutdown({
      server: { close: (cb?: (e?: Error) => void) => void gate.then(() => cb?.()), closeIdleConnections() {}, closeAllConnections() {} } as never,
      stopBackground() {},
      closeResources: async () => {},
      exit: () => {},
      log: () => {},
      drainMs: 0,
      timeoutMs: 5000,
    });
    void shutdown('test');
    const res = await request(app).get('/api/v1/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SHUTTING_DOWN');
    expect((await request(app).get('/api/v1/health')).status).toBe(200); // liveness stays up: the process is fine, just leaving
    release();
  });

  it('metrics are invisible without the token, and hold route PATTERNS, not raw URLs', async () => {
    expect((await request(app).get('/api/v1/health/metrics')).status).toBe(401);
    expect((await request(app).get('/api/v1/health/metrics').set('Authorization', 'Bearer wrong-token-wrong-token-wrong')).status).toBe(401);
    expect((await request(app).get('/api/v1/health/metrics').set('Authorization', 'Bearer short')).status).toBe(401);

    await request(app).get('/api/v1/products/customer-secret-slug-123');
    await request(app).get('/api/v1/definitely/not/here/bob@example.test');
    const res = await request(app).get('/api/v1/health/metrics').set('Authorization', 'Bearer metrics-token-0123456789abcdef');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain('# TYPE payantra_http_requests_total counter');
    expect(res.text).toContain('route="/api/v1/products/:slug"');
    expect(res.text).toContain('route="unmatched"');
    expect(res.text).toContain('payantra_build_info{release="rel-2026-10-abc123"} 1');
    expect(res.text).not.toContain('customer-secret-slug-123');
    expect(res.text).not.toContain('bob@example.test');
  });
});

describe('graceful shutdown', () => {
  const started: Server[] = [];
  afterAll(() => started.forEach((s) => s.close()));

  async function listen(handler: (req: IncomingMessage, res: import('node:http').ServerResponse) => void) {
    const server = createServer(handler);
    started.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
  }

  function harness(server: Server, over: Partial<Parameters<typeof createShutdown>[0]> = {}) {
    const events: string[] = [];
    const exit = vi.fn((code: number) => void events.push(`exit:${code}`));
    const shutdown = createShutdown({
      server,
      stopBackground: () => void events.push('stopBackground'),
      closeResources: async () => void events.push('closeResources'),
      exit,
      log: () => {},
      drainMs: 0,
      timeoutMs: 2000,
      ...over,
    });
    return { shutdown, events, exit };
  }

  it('lets a request that is already running finish, then closes resources, then exits 0 — in that order', async () => {
    const { server, url } = await listen((_req, res) => setTimeout(() => res.end('done'), 150));
    const { shutdown, events, exit } = harness(server);

    const inflight = fetch(url).then((r) => r.text());
    await new Promise((r) => setTimeout(r, 30));
    const done = shutdown('SIGTERM');
    expect(isShuttingDown()).toBe(true);

    expect(await inflight).toBe('done'); // the customer's request was not cut off
    await done;
    expect(events).toEqual(['stopBackground', 'closeResources', 'exit:0']);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('keeps serving during the drain window, so the load balancer has time to notice', async () => {
    const { server, url } = await listen((_req, res) => res.end('ok'));
    const { shutdown, events } = harness(server, { drainMs: 150 });
    const t0 = Date.now();
    const done = shutdown('SIGTERM');
    expect(isShuttingDown()).toBe(true);
    expect(await (await fetch(url)).text()).toBe('ok'); // still accepting
    expect(events).toEqual([]); // nothing closed yet
    await done;
    expect(Date.now() - t0).toBeGreaterThanOrEqual(140);
    expect(events).toEqual(['stopBackground', 'closeResources', 'exit:0']);
  });

  it('runs once, however many signals arrive', async () => {
    const { server } = await listen((_req, res) => res.end('ok'));
    const { shutdown, events, exit } = harness(server);
    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT'), shutdown('SIGTERM')]);
    expect(events.filter((e) => e === 'closeResources')).toHaveLength(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('gives up after the deadline when a request never finishes, and exits 1', async () => {
    const { server, url } = await listen(() => {
      /* never answers */
    });
    const { shutdown, exit } = harness(server, { timeoutMs: 250 });
    const hung = fetch(url).catch(() => 'aborted');
    await new Promise((r) => setTimeout(r, 30));
    void shutdown('SIGTERM');
    await waitFor(() => (exit.mock.calls.length ? true : undefined), 3000);
    expect(exit).toHaveBeenCalledWith(1);
    await hung;
  });

  it('exits non-zero when releasing resources fails, and still exits', async () => {
    const { server } = await listen((_req, res) => res.end('ok'));
    const { shutdown, exit } = harness(server, {
      closeResources: async () => {
        throw new Error('pool refused to close');
      },
    });
    await shutdown('SIGTERM');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('after a crash it skips the courtesy drain and exits with the crash code', async () => {
    const { server } = await listen((_req, res) => res.end('ok'));
    const { shutdown, exit } = harness(server, { drainMs: 5000 });
    const t0 = Date.now();
    await shutdown('uncaughtException', 1);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
