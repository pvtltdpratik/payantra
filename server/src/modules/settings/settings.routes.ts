import { Router, type NextFunction, type Request, type Response } from 'express';
import { ok } from '../../lib/respond.js';
import { getSettings } from './settings.service.js';

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

/**
 * /settings/public — the few store rules a shopper is entitled to read (what delivery costs, how long returns
 * last, whether Cash on Delivery is offered), so the policy pages and the home page's trust bar quote the SAME
 * numbers the checkout actually uses. Everything operational (partner payouts, onboarding rules, reservation
 * window) stays admin-only.
 */
export const publicSettingsRouter = Router();

publicSettingsRouter.get(
  '/public',
  handle(async (_req, res) => {
    const s = await getSettings();
    ok(res, {
      shipping: { flatRate: s.shipping.flatRate, freeThreshold: s.shipping.freeThreshold },
      returns: { returnWindowDays: s.returns.returnWindowDays, replacementEnabled: s.returns.replacementEnabled },
      payments: { codEnabled: s.payments.codEnabled, codMaxOrder: s.payments.codMaxOrder },
    });
  }),
);
