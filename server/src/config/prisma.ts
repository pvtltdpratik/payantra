import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from './env.js';
import { logger } from './logger.js';

// With DATABASE_SSL the server certificate is verified. For AWS RDS, point DATABASE_SSL_CA_FILE at the bundle from
// https://truststore.pki.rds.amazonaws.com/ (server/certs/global-bundle.pem) so the chain validates.
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  ssl: env.DATABASE_SSL
    ? { rejectUnauthorized: true, ...(env.DATABASE_SSL_CA ? { ca: env.DATABASE_SSL_CA } : {}) }
    : undefined,
});

// The most common first-run failure with RDS, so say it plainly once at start-up instead of leaving it to surface as
// "self-signed certificate in certificate chain" on every query. (NODE_EXTRA_CA_CERTS is the other legitimate way to
// supply the bundle, so stay quiet when it is set.)
if (env.DATABASE_SSL && !env.DATABASE_SSL_CA && !process.env.NODE_EXTRA_CA_CERTS) {
  let host = '';
  try {
    host = new URL(env.DATABASE_URL.replace(/^postgres(ql)?:/, 'http:')).hostname;
  } catch {
    /* an invalid URL is reported elsewhere */
  }
  if (host.endsWith('.rds.amazonaws.com')) {
    logger.warn(
      'DATABASE_SSL is on for an Amazon RDS host but no CA bundle is configured, so the database certificate cannot be verified and every query will fail. Set DATABASE_SSL_CA_FILE=./certs/global-bundle.pem (or DATABASE_SSL_CA, or NODE_EXTRA_CA_CERTS).',
    );
  }
}

export const prisma = new PrismaClient({ adapter });
export { Prisma } from '../generated/prisma/client.js';
