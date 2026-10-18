import pino from 'pino';
import { scrubDeep, scrubString } from '../lib/redact.js';
import { env } from './env.js';

/**
 * One JSON object per line in production (CloudWatch, Datadog, Loki and friends all parse that natively);
 * human-readable only in development. Everything that is logged passes through the scrubbers in
 * lib/redact.ts first, so a token, an e-mail address or a card number that ends up in a message or an
 * error text still never reaches the log stream.
 *
 * `destination` and `level` exist so tests can capture and inspect exactly what would be written.
 */
export function createLogger(destination?: pino.DestinationStream, level?: pino.LevelWithSilent) {
  const options: pino.LoggerOptions = {
    level: level ?? (env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL),
    base: { service: 'payantra-api', env: env.NODE_ENV, ...(env.RELEASE ? { release: env.RELEASE } : {}) },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Belt: well-known header paths are removed outright, before any serializer sees them.
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-razorpay-signature"]', 'res.headers["set-cookie"]'],
      censor: '[redacted]',
    },
    // Suspenders: scrub the merge object (by key and by shape) and the message string. `req`, `res` and `err` hold live
    // objects (sockets, streams) and have their own serializers, so they are skipped here.
    formatters: {
      log: (obj) => {
        const { req, res, err, ...rest } = obj as Record<string, unknown>;
        return { ...scrubDeep(rest), ...(req !== undefined && { req }), ...(res !== undefined && { res }), ...(err !== undefined && { err }) };
      },
    },
    serializers: {
      err: (e: unknown) => scrubDeep(pino.stdSerializers.err(e as Error)),
    },
    hooks: {
      logMethod(args, method) {
        // pino(msg) / pino(obj, msg, ...interpolation) — scrub whichever argument is a string.
        const scrubbed = args.map((a) => (typeof a === 'string' ? scrubString(a) : a)) as typeof args;
        method.apply(this, scrubbed);
      },
    },
  };
  if (destination) return pino(options, destination);
  return pino({
    ...options,
    transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } : undefined,
  });
}

export const logger = createLogger();
