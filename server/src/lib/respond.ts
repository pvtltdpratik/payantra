import type { Response } from 'express';

/** Consistent success envelope: { success: true, data, meta? } */
export function ok<T>(res: Response, data: T, meta?: Record<string, unknown>, status = 200) {
  return res.status(status).json(meta ? { success: true, data, meta } : { success: true, data });
}

export const created = <T>(res: Response, data: T) => ok(res, data, undefined, 201);
