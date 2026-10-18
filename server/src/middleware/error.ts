import type { ErrorRequestHandler, RequestHandler } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { reportError } from '../lib/monitoring.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(AppError.notFound(`Route not found: ${req.method} ${req.path}`));
};

/** Single place that turns any thrown value into the standard error envelope. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    return void res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  // Prisma errors that genuinely describe the CLIENT's request (a unique-constraint race, a missing
  // row). Anything else from the database is a server fault and falls through to the logged 500.
  const prismaClientErrors: Record<string, [number, string, string]> = {
    P2002: [409, 'CONFLICT', 'A record with these unique values already exists'],
    P2003: [409, 'CONFLICT', 'This record is referenced by other data'],
    P2025: [404, 'NOT_FOUND', 'Resource not found'],
  };
  if (typeof err?.code === 'string' && err.code in prismaClientErrors) {
    const [status, code, message] = prismaClientErrors[err.code];
    return void res.status(status).json({ success: false, error: { code, message } });
  }

  // body-parser errors (malformed JSON, payload too large)
  const status = typeof err?.status === 'number' ? err.status : 500;
  if (status >= 400 && status < 500) {
    return void res.status(status).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: err.type === 'entity.too.large' ? 'Payload too large' : 'Malformed request' },
    });
  }

  const requestId = typeof req.id === 'string' ? req.id : undefined;
  reportError(err, { requestId, method: req.method, path: req.path, userId: req.user?.id });
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      // Quote this to support: it finds the exact log lines for this request.
      ...(requestId ? { requestId } : {}),
      // Never leak internals in production.
      message: env.NODE_ENV === 'production' ? 'Something went wrong' : String(err?.message ?? err),
    },
  });
};
