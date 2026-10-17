import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../lib/errors.js';

type Source = 'body' | 'query' | 'params';

/**
 * Validates one part of the request and replaces it with the parsed (stripped, coerced) value.
 * Handlers can then trust `req.body` / `res.locals.query` without re-checking.
 */
export function validate(schema: ZodType, source: Source = 'body'): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(
        AppError.badRequest(
          'Validation failed',
          result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        ),
      );
    }
    if (source === 'body') {
      req.body = result.data;
    } else {
      // Express 5 makes req.query a getter, so parsed values travel via res.locals instead.
      res.locals[source] = result.data;
    }
    next();
  };
}
