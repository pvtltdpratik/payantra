import compression from 'compression';
import cors from 'cors';
import express, { type RequestHandler } from 'express';
import * as helmetModule from 'helmet';
import type { HelmetOptions } from 'helmet';
import { corsOrigins, env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { rejectNullBytes } from './middleware/rejectNullBytes.js';
import { metricsMiddleware, requestLogging } from './middleware/requestLogging.js';
import { addressesRouter } from './modules/addresses/addresses.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { cartRouter } from './modules/cart/cart.routes.js';
import { checkoutRouter } from './modules/checkout/checkout.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { ordersRouter } from './modules/orders/orders.routes.js';
import { paymentsRouter, razorpayWebhookRouter } from './modules/payments/payments.routes.js';
import { deliveryRouter } from './modules/delivery/delivery.routes.js';
import { marketingPublicRouter } from './modules/marketing/marketing.routes.js';
import { recentlyViewedRouter } from './modules/recently-viewed/recently-viewed.routes.js';
import { reviewsRouter } from './modules/reviews/reviews.routes.js';
import { publicSettingsRouter } from './modules/settings/settings.routes.js';
import { supportRouter } from './modules/support/support.routes.js';
import { couponsRouter } from './modules/coupons/coupons.routes.js';
import { wishlistRouter } from './modules/wishlist/wishlist.routes.js';
import {
  categoriesRouter,
  collectionsRouter,
  productsRouter,
  searchRouter,
} from './modules/catalogue/catalogue.routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import { usersRouter } from './modules/users/users.routes.js';

/**
 * helmet 8 declares its function as the *default export* of both its ESM and CJS type files. Whether `import helmet
 * from 'helmet'` then types as the function or as the whole module namespace ("This expression is not callable ...
 * typeof import(.../helmet/index) has no call signatures", TS2349) depends on how the compiler classifies this file as
 * ESM or CJS, and a hosting platform's build can classify it differently from `tsc` here. Reading the callable off
 * the namespace works under every classification: the ESM build exposes it as `.default`, and the CJS build is the
 * function itself with `.default` pointing back at it.
 */
type HelmetFn = (options?: Readonly<HelmetOptions>) => RequestHandler;
const helmet: HelmetFn = ((helmetModule as unknown as { default?: unknown }).default ?? helmetModule) as HelmetFn;

export function createApp() {
  const app = express();

  // Behind a load balancer (ALB/Render/etc.) — needed for correct client IPs in rate limiting.
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');

  // First, so that even a request refused by CORS or the rate limiter has an id and an access-log line.
  app.use(requestLogging);
  app.use(metricsMiddleware);
  // This API only ever returns JSON/CSV: nothing in a response should be loadable, framable or scriptable.
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } }));
  // A response carrying someone's data must never be stored by a shared cache. Handlers may override (e.g. the public catalogue).
  app.use((req, res, next) => {
    if (req.headers.authorization) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      // A browser hides every response header except a short safe list from a page on another origin. The CSV
      // exports' file names travel in Content-Disposition, so it must be listed or downloads lose their names.
      // X-Request-Id lets the storefront show a support reference for a failed call.
      exposedHeaders: ['Content-Disposition', 'X-Request-Id'],
    }),
  );
  app.use(compression());
  app.use(globalLimiter);

  // The Razorpay webhook is mounted BEFORE express.json(): its signature covers the exact bytes that
  // were sent, so the route reads the raw body itself (see payments.routes.ts).
  app.use('/api/v1/webhooks/razorpay', razorpayWebhookRouter);

  app.use(express.json({ limit: '100kb' }));
  app.use(rejectNullBytes);

  const v1 = express.Router();
  v1.use('/health', healthRouter);
  v1.use('/users', usersRouter);
  v1.use('/categories', categoriesRouter);
  v1.use('/collections', collectionsRouter);
  v1.use('/products', productsRouter);
  v1.use('/search', searchRouter);
  v1.use('/addresses', addressesRouter);
  v1.use('/wishlist', wishlistRouter);
  v1.use('/cart', cartRouter);
  v1.use('/coupons', couponsRouter);
  v1.use('/checkout', checkoutRouter);
  v1.use('/payments', paymentsRouter);
  v1.use('/orders', ordersRouter);
  v1.use('/delivery', deliveryRouter);
  v1.use('/support', supportRouter);
  v1.use('/reviews', reviewsRouter);
  v1.use('/settings', publicSettingsRouter);
  v1.use('/recently-viewed', recentlyViewedRouter);
  v1.use(marketingPublicRouter); // /banners, /newsletter/subscribe
  v1.use('/notifications', notificationsRouter);
  v1.use('/admin', adminRouter);
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
