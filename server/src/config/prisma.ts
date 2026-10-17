import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from './env.js';

// With DATABASE_SSL the server certificate is verified. For AWS RDS, set DATABASE_SSL_CA to the
// contents of the regional bundle from https://truststore.pki.rds.amazonaws.com/ so the chain validates.
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  ssl: env.DATABASE_SSL
    ? { rejectUnauthorized: true, ...(env.DATABASE_SSL_CA ? { ca: env.DATABASE_SSL_CA } : {}) }
    : undefined,
});

export const prisma = new PrismaClient({ adapter });
export { Prisma } from '../generated/prisma/client.js';
