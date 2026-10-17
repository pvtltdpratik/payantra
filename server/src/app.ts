import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { corsOrigins } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { globalLimiter } from './middleware/rateLimit.js';
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

export function createApp() {
  const app = express();

  // Behind a load balancer (ALB/Render/etc.) — needed for correct client IPs in rate limiting.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      // A browser hides every response header except a short safe list from a page on another origin. The CSV
      // exports' file names travel in Content-Disposition, so it must be listed or downloads lose their names.
      exposedHeaders: ['Content-Disposition'],
    }),
  );
  app.use(compression());
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url?.startsWith('/api/v1/health') ?? false } }));
  app.use(globalLimiter);

  // The Razorpay webhook is mounted BEFORE express.json(): its signature covers the exact bytes that
  // were sent, so the route reads the raw body itself (see payments.routes.ts).
  app.use('/api/v1/webhooks/razorpay', razorpayWebhookRouter);

  app.use(express.json({ limit: '100kb' }));

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
  v1.use('/recently-viewed', recentlyViewedRouter);
  v1.use(marketingPublicRouter); // /banners, /newsletter/subscribe
  v1.use('/notifications', notificationsRouter);
  v1.use('/admin', adminRouter);
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
