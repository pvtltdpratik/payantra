import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7 keeps the connection URL out of schema.prisma.
// DATABASE_URL points at the AWS RDS "payantra" database; migrations use it directly.
// SHADOW_DATABASE_URL is only used by `prisma migrate dev/diff` (see scripts/check-drift.mjs).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
    ...(process.env.SHADOW_DATABASE_URL ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL } : {}),
  },
});
