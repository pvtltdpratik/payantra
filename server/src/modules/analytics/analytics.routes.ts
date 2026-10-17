import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { ok } from '../../lib/respond.js';
import { validate } from '../../middleware/validate.js';
import { overview } from './analytics.service.js';
import { rangeQuery, resolveRange } from './range.js';
import { GRANULARITIES, REPORT_NAMES, REPORTS, reportToCsv } from './reports.service.js';

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

/** Mounted inside the admin router (authenticated ADMIN only). */
export const analyticsAdminRouter = Router();

analyticsAdminRouter.get(
  '/analytics/overview',
  validate(rangeQuery, 'query'),
  handle(async (_req, res) => ok(res, await overview(resolveRange(res.locals.query)))),
);

const reportQuery = rangeQuery.extend({
  granularity: z.enum(GRANULARITIES).default('day'),
  lowStockOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  format: z.enum(['json', 'csv']).default('json'),
});

/** JSON rows are capped so a screen stays quick; a CSV export may be much longer. */
const JSON_LIMIT = 1_000;
const CSV_LIMIT = 50_000;

analyticsAdminRouter.get(
  '/reports/:name',
  validate(z.object({ name: z.enum(REPORT_NAMES) }), 'params'),
  validate(reportQuery, 'query'),
  handle(async (req, res) => {
    const name = req.params.name as (typeof REPORT_NAMES)[number];
    const q = res.locals.query as z.infer<typeof reportQuery>;
    const range = resolveRange(q);
    const report = await REPORTS[name](range, { granularity: q.granularity, lowStockOnly: q.lowStockOnly, limit: q.format === 'csv' ? CSV_LIMIT : JSON_LIMIT });

    if (q.format === 'csv') {
      const file = name === 'inventory' ? `inventory-${range.toKey}` : `${name}-${range.fromKey}_to_${range.toKey}`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="payantra-${file}.csv"`);
      // Reports hold customer and revenue data: never let a shared cache keep a copy.
      res.setHeader('Cache-Control', 'no-store');
      return res.send(reportToCsv(report));
    }
    return ok(res, { ...report, range: { from: range.fromKey, to: range.toKey, days: range.days } });
  }),
);
