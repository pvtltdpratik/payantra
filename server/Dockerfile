# Payantra API image.  Build context: server/
#
#   docker build -t payantra-api .                        # the API (default, smallest target)
#   docker build --target migrate -t payantra-migrate .   # one-off job image: `prisma migrate deploy`
#
# NOTE: written for the deploy skeleton in .github/workflows/deploy.yml and NOT yet built or run by the author
# (no Docker on the development machine). Run `docker build` once locally before relying on it.

# ── 1. install everything and compile ──
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Scripts are skipped (the `postinstall` would run `prisma generate` before the schema is copied); generate explicitly below.
RUN npm ci --include=dev --ignore-scripts
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json tsconfig.build.json ./
COPY src ./src
# `prisma generate` reads no database; the URL only has to look like one.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate && npm run build

# ── 2. migration job: needs the prisma CLI (a devDependency), the schema and the migration files ──
FROM build AS migrate
ENV NODE_ENV=production
USER node
# DATABASE_URL (and DATABASE_SSL settings, if the connection needs them) arrive as environment variables at run time.
CMD ["npx", "prisma", "migrate", "deploy"]

# ── 3. runtime: production dependencies + compiled output only ──
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
# The AWS RDS CA bundle (public), so DATABASE_SSL_CA_FILE=./certs/global-bundle.pem works inside the image.
COPY certs ./certs
USER node
EXPOSE 4000
# Liveness only (never touches the database). The load balancer should use /api/v1/health/ready.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# `node` directly, not `npm start`: npm would sit between the orchestrator and the server and swallow SIGTERM, so the
# graceful shutdown in src/server.ts would never run. (ECS: also set "initProcessEnabled": true on the container.)
CMD ["node", "dist/server.js"]
