import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { paginationQuery } from '../../lib/pagination.js';
import { created, ok } from '../../lib/respond.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { sensitiveLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import {
  adminOrderListQuery,
  orderCancelBody,
  orderRefundBody,
  orderStatusBody,
  returnActionBody,
  returnListQuery,
  adminProductListQuery,
  categoryCreate,
  categoryUpdate,
  collectionCreate,
  collectionUpdate,
  couponCreate,
  couponListQuery,
  couponUpdate,
  idParam,
  imageCreate,
  imageUpdate,
  inventoryAdjust,
  inventoryListQuery,
  productCreate,
  productUpdate,
  settingKeyParam,
  userListQuery,
  userUpdate,
  variantCreate,
  variantUpdate,
} from './admin.schema.js';
import { AppError } from '../../lib/errors.js';
import { analyticsAdminRouter } from '../analytics/analytics.routes.js';
import { customersAdminRouter } from '../customers/customers.routes.js';
import { deliveryAdminRouter } from '../delivery/delivery-admin.routes.js';
import { marketingAdminRouter } from '../marketing/marketing.routes.js';
import { reviewsAdminRouter } from '../reviews/reviews.routes.js';
import { supportAdminRouter } from '../support/support.routes.js';
import * as coupons from '../coupons/coupons.service.js';
import * as settings from '../settings/settings.service.js';
import * as inventory from './inventory.service.js';
import * as orders from './orders.service.js';
import * as products from './products.service.js';
import * as taxonomy from './taxonomy.service.js';
import * as users from './users.service.js';

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const id = (req: Request) => req.params.id as string;

/**
 * Every route below requires an authenticated ADMIN. The guard is mounted once on the router
 * so a new endpoint cannot be added to this file without it.
 */
export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('ADMIN'));
adminRouter.use(deliveryAdminRouter);
adminRouter.use(analyticsAdminRouter);
adminRouter.use(customersAdminRouter);
adminRouter.use(supportAdminRouter);
adminRouter.use(marketingAdminRouter);
adminRouter.use(reviewsAdminRouter);

// ── Products ──
adminRouter.get(
  '/products',
  validate(adminProductListQuery, 'query'),
  handle(async (_req, res) => {
    const { items, meta } = await products.listAdminProducts(res.locals.query);
    ok(res, items, meta);
  }),
);
adminRouter.post(
  '/products',
  validate(productCreate),
  handle(async (req, res) => created(res, await products.createProduct(req, req.body))),
);
adminRouter.get(
  '/products/:id',
  validate(idParam, 'params'),
  handle(async (req, res) => ok(res, await products.getAdminProduct(id(req)))),
);
adminRouter.patch(
  '/products/:id',
  validate(idParam, 'params'),
  validate(productUpdate),
  handle(async (req, res) => ok(res, await products.updateProduct(req, id(req), req.body))),
);
adminRouter.delete(
  '/products/:id',
  validate(idParam, 'params'),
  handle(async (req, res) => ok(res, await products.deleteProduct(req, id(req)))),
);

// ── Variants ──
adminRouter.post(
  '/products/:id/variants',
  validate(idParam, 'params'),
  validate(variantCreate),
  handle(async (req, res) => created(res, await products.addVariant(req, id(req), req.body))),
);
adminRouter.patch(
  '/variants/:id',
  validate(idParam, 'params'),
  validate(variantUpdate),
  handle(async (req, res) => ok(res, await products.updateVariant(req, id(req), req.body))),
);
adminRouter.delete(
  '/variants/:id',
  validate(idParam, 'params'),
  handle(async (req, res) => ok(res, await products.deleteVariant(req, id(req)))),
);

// ── Images ──
adminRouter.post(
  '/products/:id/images',
  validate(idParam, 'params'),
  validate(imageCreate),
  handle(async (req, res) => created(res, await products.addImage(req, id(req), req.body))),
);
adminRouter.patch(
  '/images/:id',
  validate(idParam, 'params'),
  validate(imageUpdate),
  handle(async (req, res) => ok(res, await products.updateImage(req, id(req), req.body))),
);
adminRouter.delete(
  '/images/:id',
  validate(idParam, 'params'),
  handle(async (req, res) => {
    await products.deleteImage(req, id(req));
    ok(res, { deleted: true });
  }),
);

// ── Inventory ──
adminRouter.get(
  '/inventory',
  validate(inventoryListQuery, 'query'),
  handle(async (_req, res) => {
    const { items, meta } = await inventory.listInventory(res.locals.query);
    ok(res, items, meta);
  }),
);
adminRouter.post(
  '/inventory/:id/adjust',
  validate(idParam, 'params'),
  validate(inventoryAdjust),
  handle(async (req, res) => ok(res, await inventory.adjustInventory(req, id(req), req.body))),
);
adminRouter.get(
  '/inventory/:id/movements',
  validate(idParam, 'params'),
  validate(paginationQuery, 'query'),
  handle(async (req, res) => {
    const { items, meta } = await inventory.listMovements(id(req), res.locals.query);
    ok(res, items, meta);
  }),
);

// ── Categories ──
adminRouter.get('/categories', handle(async (_req, res) => ok(res, await taxonomy.listAllCategories())));
adminRouter.post(
  '/categories',
  validate(categoryCreate),
  handle(async (req, res) => created(res, await taxonomy.createCategory(req, req.body))),
);
adminRouter.patch(
  '/categories/:id',
  validate(idParam, 'params'),
  validate(categoryUpdate),
  handle(async (req, res) => ok(res, await taxonomy.updateCategory(req, id(req), req.body))),
);
adminRouter.delete(
  '/categories/:id',
  validate(idParam, 'params'),
  handle(async (req, res) => {
    await taxonomy.deleteCategory(req, id(req));
    ok(res, { deleted: true });
  }),
);

// ── Collections ──
adminRouter.get('/collections', handle(async (_req, res) => ok(res, await taxonomy.listAllCollections())));
adminRouter.post(
  '/collections',
  validate(collectionCreate),
  handle(async (req, res) => created(res, await taxonomy.createCollection(req, req.body))),
);
adminRouter.patch(
  '/collections/:id',
  validate(idParam, 'params'),
  validate(collectionUpdate),
  handle(async (req, res) => ok(res, await taxonomy.updateCollection(req, id(req), req.body))),
);
adminRouter.delete(
  '/collections/:id',
  validate(idParam, 'params'),
  handle(async (req, res) => {
    await taxonomy.deleteCollection(req, id(req));
    ok(res, { deleted: true });
  }),
);

// ── Users & roles (the only privilege-granting path in the API) ──
adminRouter.get(
  '/users',
  validate(userListQuery, 'query'),
  handle(async (_req, res) => {
    const { items, meta } = await users.listUsers(res.locals.query);
    ok(res, items, meta);
  }),
);
adminRouter.patch(
  '/users/:id',
  sensitiveLimiter,
  validate(idParam, 'params'),
  validate(userUpdate),
  handle(async (req, res) => ok(res, await users.updateUser(req, id(req), req.body))),
);

// ── Orders ──
adminRouter.get(
  '/orders',
  validate(adminOrderListQuery, 'query'),
  handle(async (_req, res) => {
    const { items, meta } = await orders.listOrders(res.locals.query);
    ok(res, items, meta);
  }),
);
adminRouter.get('/orders/:id', validate(idParam, 'params'), handle(async (req, res) => ok(res, await orders.getOrder(id(req)))));
adminRouter.patch(
  '/orders/:id/status',
  validate(idParam, 'params'),
  validate(orderStatusBody),
  handle(async (req, res) => ok(res, await orders.updateStatus(req, id(req), req.body.status, req.body.note))),
);
adminRouter.post(
  '/orders/:id/cancel',
  sensitiveLimiter,
  validate(idParam, 'params'),
  validate(orderCancelBody),
  handle(async (req, res) => ok(res, await orders.adminCancel(req, id(req), req.body.reason))),
);
adminRouter.post(
  '/orders/:id/refund',
  sensitiveLimiter,
  validate(idParam, 'params'),
  validate(orderRefundBody),
  handle(async (req, res) => created(res, await orders.adminRefund(req, id(req), req.body))),
);
adminRouter.post(
  '/refunds/:id/retry',
  sensitiveLimiter,
  validate(idParam, 'params'),
  handle(async (req, res) => ok(res, await orders.retryRefund(req, id(req)))),
);

// ── Returns ──
adminRouter.get(
  '/returns',
  validate(returnListQuery, 'query'),
  handle(async (_req, res) => {
    const { items, meta } = await orders.listReturns(res.locals.query);
    ok(res, items, meta);
  }),
);
adminRouter.patch(
  '/returns/:id',
  validate(idParam, 'params'),
  validate(returnActionBody),
  handle(async (req, res) => ok(res, await orders.resolveReturn(req, id(req), req.body))),
);

// ── Coupons ──
adminRouter.get(
  '/coupons',
  validate(couponListQuery, 'query'),
  handle(async (_req, res) => {
    const { items, meta } = await coupons.listCoupons(res.locals.query);
    ok(res, items, meta);
  }),
);
adminRouter.post(
  '/coupons',
  validate(couponCreate),
  handle(async (req, res) => created(res, await coupons.createCoupon(req, req.body))),
);
adminRouter.patch(
  '/coupons/:id',
  validate(idParam, 'params'),
  validate(couponUpdate),
  handle(async (req, res) => ok(res, await coupons.updateCoupon(req, id(req), req.body))),
);
adminRouter.delete(
  '/coupons/:id',
  validate(idParam, 'params'),
  handle(async (req, res) => ok(res, await coupons.deleteCoupon(req, id(req)))),
);

// ── Settings (shipping, payments, returns) ──
adminRouter.get('/settings', handle(async (_req, res) => ok(res, await settings.getSettings())));
adminRouter.put(
  '/settings/:key',
  validate(settingKeyParam, 'params'),
  handle(async (req, res) => {
    const key = req.params.key as settings.SettingKey;
    // Validate against the schema for this specific group; Zod errors become a 400 via the handler below.
    const parsed = settings.settingsSchemas[key].safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest(
        'Validation failed',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    ok(res, await settings.updateSetting(req, key, parsed.data));
  }),
);

// ── Audit log ──
adminRouter.get(
  '/audit-logs',
  validate(paginationQuery.extend({ entityType: z.string().trim().max(60).optional() }), 'query'),
  handle(async (_req, res) => {
    const { items, meta } = await users.listAuditLogs(res.locals.query);
    ok(res, items, meta);
  }),
);
