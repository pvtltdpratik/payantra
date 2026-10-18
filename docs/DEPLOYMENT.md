# Deploying Payantra

How to run Payantra for real: **AWS RDS** for the database, a container host for the API (this guide uses **ECS Fargate behind an ALB**),
the storefront on **Vercel** (any Node host works), **Supabase** for sign-in and **Razorpay** for money.

> **Read this first — what has and has not been verified.**
> Everything in the *repository* behind this guide is tested: the security suites, production-config validation, logging, metrics,
> shutdown and the built server's boot (`npm run smoke:boot`) all run in CI against a real Postgres engine (PGlite). **Nothing here has
> been run against a real AWS account, a real Supabase project, a live Razorpay account or GitHub Actions itself.** The cloud steps below
> are the author's best knowledge of those products, written as a checklist to confirm on a **staging** environment first. The `Dockerfile`
> and `.github/workflows/deploy.yml` are skeletons that have not been executed. Where a step carries real risk it says *verify on staging*.

Contents: [Topology](#1-topology) · [Environments](#2-environments) · [AWS RDS](#3-aws-rds-postgresql) · [Supabase](#4-supabase) ·
[Razorpay](#5-razorpay-live-mode) · [Env reference](#6-environment-variable-reference) · [API hosting](#7-hosting-the-api) ·
[Storefront](#8-hosting-the-storefront) · [Migrations & rollback](#9-migrations-and-rollback) · [Seeding policy](#10-seeding-policy) ·
[Backups](#11-backups-and-recovery) · [Monitoring](#12-monitoring-and-alerts) · [CI/CD](#13-cicd) · [Security notes](#14-security-configuration-summary) ·
[Go-live checklist](#15-go-live-checklist) · [Incident quick reference](#16-incident-quick-reference) · [Known gaps](#17-known-gaps)

---

## 1. Topology

```
                      ┌────────────── Vercel (or any Node host) ──────────────┐
 Browser ── HTTPS ──► │  Next.js storefront  www.example.in                   │
    │                 └───────────────────────────────────────────────────────┘
    │  Authorization: Bearer <Supabase JWT>  (CORS: only the storefront origin)
    ├────────────────► ALB (TLS) ─► ECS Fargate: Express API  api.example.in ──► RDS PostgreSQL (private subnets, TLS)
    │                                    │  ▲                                  └─► Secrets Manager (injected as env at start)
    ├── sign-in ─────► Supabase Auth ◄───┘  │ verifies JWTs via JWKS
    └── Checkout.js ─► Razorpay ── webhook (HMAC, raw body) ─────────────────────┘
```

Rules the design relies on (all enforced in code, so deployment must not undermine them):

- The API is the **only** thing that reads or writes the database. The browser talks to Supabase for sign-in only.
- **Roles live in the database.** Nothing in a token grants access. Promoting someone is an admin action (or `make-admin` for the first one).
- **A payment is believed only after a signature check.** The webhook route needs the **raw** request body: do not put a proxy in front
  of the API that rewrites or re-encodes bodies (some WAF "normalisation" modes do).
- Run **two or more API tasks** in different availability zones. They are stateless; the expiry sweeper and all order/payment changes are
  safe to run concurrently (each order is locked in its own transaction).
- Rate-limit counters are **per process** (in memory). With N tasks the effective limit is N× the configured one; put an AWS WAF rate rule
  in front for a hard global ceiling (see [Security notes](#14-security-configuration-summary)).

## 2. Environments

Keep **staging** and **production** fully separate: their own AWS resources, **their own Supabase project** (so test users and redirect URLs
never mix), and Razorpay **test** keys on staging / **live** keys on production. Both run with `NODE_ENV=production` so staging proves
the production configuration rules. Use a GitHub *Environment* for each (Settings → Environments); give `production` required reviewers.

| | staging | production |
|---|---|---|
| Razorpay | `rzp_test_…` keys, test webhook | `rzp_live_…` keys, live webhook |
| Supabase | separate project | separate project |
| RDS | small, single-AZ is fine | Multi-AZ, deletion protection, 14–35 day backups |
| Demo catalogue | may be seeded (see [Seeding policy](#10-seeding-policy)) | **never** |
| `CSP_MODE` | `enforce` (so problems show up here first) | `enforce` |

## 3. AWS RDS PostgreSQL

1. **Create the instance** — PostgreSQL 16 or newer, database name `payantra`. Production: Multi-AZ, storage encrypted (KMS), *deletion
   protection on*, automated backups ≥ 14 days, *Enhanced monitoring* and *Performance Insights* on. Not publicly accessible.
2. **Network** — put it in private subnets. Its security group allows `5432` **only** from the API tasks' security group and from the
   migration task's (they can be the same group). Add a bastion / SSM Session Manager path for emergencies rather than opening the port.
3. **Force TLS** — in the parameter group set `rds.force_ssl = 1`. The API refuses to start in production with `DATABASE_SSL=false` against a
   non-loopback host, and uses `rejectUnauthorized: true`, so it also needs the RDS CA bundle. The global bundle ships in the repo
   (`server/certs/global-bundle.pem`, from [AWS's truststore](https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem);
   refresh it from there when AWS rotates CAs) and the Docker image includes it: set `DATABASE_SSL_CA_FILE=./certs/global-bundle.pem`.
   Alternatively paste the PEM into `DATABASE_SSL_CA` (newlines as `\n`). Without either, every query fails with
   `self-signed certificate in certificate chain`; the API logs a warning at start-up when it sees an RDS host without a bundle.
4. **Two database users** (recommended; the code does not require it):
   - `payantra_migrate` — owns the schema, used **only** by the migration task. Needs DDL.
   - `payantra_app` — `SELECT, INSERT, UPDATE, DELETE` on the tables and `USAGE` on sequences/types; no DDL. Used by the API.
   After the first migration run: `GRANT USAGE ON SCHEMA public TO payantra_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO payantra_app;`
   and `ALTER DEFAULT PRIVILEGES FOR ROLE payantra_migrate IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO payantra_app;`
   *(Verify on staging that checkout, refunds and the reports still work under the restricted role.)*
5. **Connection strings** — URL-encode special characters in passwords.
   - Runtime `DATABASE_URL`: `postgresql://payantra_app:…@<endpoint>:5432/payantra` — **no `sslmode` in the URL.** The API passes its own TLS
     settings (`DATABASE_SSL`, `DATABASE_SSL_CA_FILE`/`DATABASE_SSL_CA`) and `pg` would let a URL `sslmode` override them, losing the CA.
   - Migration `DATABASE_URL` (a *different* secret used only by the migration task): the same, with `?sslmode=require`
     (the Prisma schema engine reads TLS settings from the URL). *Verify on staging that `prisma migrate deploy` connects; if your RDS
     policy needs full verification, check Prisma's current docs for `sslcert`/`sslrootcert` parameters.*
6. **Connection budget** — each API task opens up to `DATABASE_POOL_MAX` connections (default 10). Keep
   `tasks × DATABASE_POOL_MAX + migration (1–2) + admin tools < max_connections` (RDS sets this from instance memory;
   `SHOW max_connections;`). Rolling deploys briefly run old and new tasks together — leave headroom (2× during a rollout). If you need many more
   tasks, put **RDS Proxy** in front (use transaction pooling-safe settings; the code uses advisory locks *inside transactions* only, which is compatible —
   *verify on staging*).
7. **Time zone** — leave the instance in UTC. Reports compute India calendar days themselves ([REPORTS.md](REPORTS.md)).

## 4. Supabase

Create **one project per environment**; region close to your users (Mumbai for India).

1. **Keys** — copy *Project URL* and the *anon (publishable) key* into the storefront build. The API needs only the URL (`SUPABASE_URL`).
   **Never** put the `service_role` / secret key anywhere in this repo, in GitHub, or in the storefront.
2. **JWT signing** — use the project's **asymmetric signing keys** (the API verifies tokens against `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`).
   Only a legacy project that still signs with a shared HS256 secret needs `SUPABASE_JWT_SECRET` (32+ chars). The API checks the *issuer*
   (`<SUPABASE_URL>/auth/v1`) and *audience* (`authenticated`), so a token from another project is refused.
3. **Authentication → Providers** — enable **Email** with *Confirm email* **on**, and **Google** (create an OAuth client in Google Cloud; its
   authorised redirect URI is the one Supabase shows for the provider). Review the password policy and enable *leaked password protection* if your plan has it.
4. **Authentication → URL Configuration** — *Site URL* = `https://www.example.in`. *Redirect URLs* = exactly `https://www.example.in/auth/callback`
   (and your staging URL **in the staging project only**). Remove `localhost` entries from the production project.
5. **Custom SMTP** — Supabase's built-in mail sender is for development only (tiny quota, restricted recipients). Configure your own provider
   (SES, Resend, …) under *Authentication → SMTP*, set the sender to your domain with SPF/DKIM, and customise the confirmation / reset templates.
6. **Abuse protection** — review *Authentication → Rate Limits*. The storefront does not implement a CAPTCHA; if you see sign-up abuse, enable
   Supabase's CAPTCHA protection **and** add the widget to the sign-up form (not built).
7. **Admins** — the first admin signs in once, then you run `make-admin` (see [Seeding policy](#10-seeding-policy)). Use a strong unique password;
   Supabase MFA exists but the storefront has no MFA enrolment screen yet, so protect admin mailboxes with MFA at the e-mail provider.
8. **Backups** — Supabase holds the identities; the database holds profiles keyed by the same ids. Enable the project's backups (paid plans) —
   see [Backups](#11-backups-and-recovery).

## 5. Razorpay live mode

Do staging with **test** keys first ([PAYMENTS.md](PAYMENTS.md) has the full sandbox walk-through). For live:

1. **Activate the account** — complete KYC / business verification, bank account for settlements, and the *website details* Razorpay asks for
   (live Checkout is allowed only for approved domains; the privacy, terms, shipping and returns pages are already part of the storefront).
2. **Payment methods** — enable the ones you want (UPI, cards, netbanking, wallets) under *Account & Settings → Payment Methods*.
3. **Keys** — *Account & Settings → API Keys → Generate Live Key*. `rzp_live_…` id → `RAZORPAY_KEY_ID` (server) and `NEXT_PUBLIC_RAZORPAY_KEY_ID`
   (storefront build); the secret → `RAZORPAY_KEY_SECRET` (server only; shown once). The API refuses to boot if the id is neither `rzp_test_` nor `rzp_live_`,
   or if the secret / webhook secret looks like a placeholder.
4. **Webhook** — *Account & Settings → Webhooks → Add*:
   - URL `https://api.example.in/api/v1/webhooks/razorpay`
   - Secret: a new random string (≥ 16 chars; `openssl rand -hex 24`) → `RAZORPAY_WEBHOOK_SECRET`. It is **not** the API secret.
   - Events: `payment.captured`, `payment.authorized`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`.
   - Create the **live** webhook separately from the test one (they have different secrets).
5. **Order of operations for the switch** — put the live values in Secrets Manager → deploy the API → build/deploy the storefront with the
   live publishable key → place a small real order → confirm *Paid* on the order page, the webhook showing `200` in the Razorpay dashboard, the settlement in
   the dashboard, then **refund it** from Admin → Orders and confirm the refund flips to *Refunded* when `refund.processed` arrives.
6. **Content-Security-Policy** — the storefront allows `https://*.razorpay.com` for script, frame and connect. If Checkout does not open on staging,
   open the browser console: a CSP violation names the blocked URL. Set `CSP_MODE=report-only` (rebuild) to diagnose without blocking, then widen the policy in
   `client/security-headers.ts`.
7. **Rotating secrets** — generate the new webhook secret, update it in Secrets Manager **and** the Razorpay dashboard together; during the gap deliveries
   fail the signature check with `400` and Razorpay retries, so do it at a quiet time and watch the dashboard's delivery log afterwards. Re-generating API keys
   invalidates the old ones immediately.

## 6. Environment variable reference

### API (`server/`) — validated at boot by `src/config/env.ts`

Production adds the rules in the *Production rule* column; a violation stops the process with a message naming the variable (`npm run smoke:boot` demonstrates it).
Loopback hosts (`localhost`, `127.0.0.1`) are exempt from the transport rules so local production-mode runs (the e2e harness) keep working.

| Variable | Required | Default | Production rule / notes |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `production` on every deployed environment |
| `PORT` | no | `4000` | |
| `LOG_LEVEL` | no | `info` | `fatal`…`trace`, `silent` |
| `CORS_ORIGINS` | prod: **yes** | dev: `http://localhost:3000` | Exact origins, comma-separated, **https**, no `*`, no path / trailing slash |
| `DATABASE_URL` | **yes** | — | `postgresql://…`; no `sslmode` (see [RDS](#3-aws-rds-postgresql)) |
| `DATABASE_SSL` | no | `false` | Must be `true` unless the database host is loopback |
| `DATABASE_SSL_CA_FILE` | no | — | Path to the RDS CA bundle PEM, relative to `server/` (`./certs/global-bundle.pem`, shipped in the repo and the image). Needed for certificate verification; a missing or non-PEM file stops the boot |
| `DATABASE_SSL_CA` | no | — | The same bundle pasted inline (`\n` for newlines). Set this **or** `DATABASE_SSL_CA_FILE`, not both |
| `DATABASE_POOL_MAX` | no | `10` | 1–100. Use `1` only with the PGlite dev database |
| `SUPABASE_URL` | **yes** | — | https |
| `SUPABASE_JWT_SECRET` | no | — | Legacy HS256 projects only; ≥ 32 chars if set |
| `RAZORPAY_KEY_ID` | **yes** | — | `rzp_test_…` or `rzp_live_…` |
| `RAZORPAY_KEY_SECRET` | **yes** | — | Not a placeholder |
| `RAZORPAY_WEBHOOK_SECRET` | **yes** | — | ≥ 16 chars, not a placeholder |
| `RAZORPAY_API_BASE` | no | `https://api.razorpay.com/v1` | **Must stay default** in production (test stand-ins only) |
| `DELIVERY_OTP_SECRET` | prod: **yes** | dev fixed value | ≥ 32 random chars, identical on every task. Changing it invalidates delivery codes in flight |
| `RATE_LIMIT_MAX` | no | `300` | per IP per minute, **per task** |
| `RATE_LIMIT_SENSITIVE_MAX` | no | `30` | per IP per 15 min, per task (checkout, coupons, refunds, role changes…) |
| `ORDER_EXPIRY_SWEEP_SECONDS` | no | `60` | `0` disables the sweeper — never disable it in production (stock would stay reserved) |
| `TRUST_PROXY_HOPS` | no | `1` | Proxies in front of the API: ALB = 1, CloudFront + ALB = 2. Wrong values make every client look like the proxy (rate limits misfire) or let clients spoof their IP |
| `SHUTDOWN_DRAIN_SECONDS` | no | `5` | After SIGTERM: keep serving while `/health/ready` is 503 |
| `SHUTDOWN_TIMEOUT_SECONDS` | no | `25` | Total time allowed to finish in-flight requests before exiting |
| `RELEASE` | no | — | Git SHA; shown by `/health`, on every log line and error report. The deploy workflow sets it |
| `SENTRY_DSN` | no | — | Optional error reporting (see [Monitoring](#12-monitoring-and-alerts)) |
| `METRICS_TOKEN` | no | — | ≥ 24 chars. Enables `GET /api/v1/health/metrics` for `Authorization: Bearer <token>`; unset = the endpoint does not exist |

Generate secrets with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
**Where they live:** AWS Secrets Manager (or SSM Parameter Store), referenced from the ECS task definition's `secrets` — not in GitHub, not in the image.

### Storefront (`client/`) — `NEXT_PUBLIC_*` and `CSP_*` are read at **build** time

Changing any of these needs a rebuild/redeploy of the storefront.

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | **yes** | Includes `/api/v1`, e.g. `https://api.example.in/api/v1`. Also feeds the CSP `connect-src` |
| `NEXT_PUBLIC_SITE_URL` | **yes** | `https://www.example.in`. **A production build with an `https` URL gets the Content-Security-Policy and HSTS**; with plain `http` neither is sent |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **yes** | Public by design. Never the service-role key |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | **yes** | Publishable key id (`rzp_live_…` in production) |
| `NEXT_PUBLIC_IMAGE_HOST` | no | CDN hostname for product photos (enables `next/image` optimisation; added to CSP `img-src`) |
| `NEXT_PUBLIC_SUPPORT_EMAIL` / `_PHONE` / `_HOURS`, `NEXT_PUBLIC_SOCIAL_*` | no | Footer / contact page; hidden when empty |
| `CSP_MODE` | no | `enforce` (default) · `report-only` · `off` |
| `CSP_REPORT_URI` | no | https endpoint that receives CSP violation reports |

### CI/CD (GitHub → Settings → Environments → `staging` / `production`)

| Name | Kind | Meaning |
|---|---|---|
| `AWS_DEPLOY_ROLE_ARN` | secret | IAM role GitHub assumes via OIDC (no stored access keys). Trust policy limited to this repo and environment |
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | secrets | Only if the storefront is on Vercel |
| `AWS_REGION`, `ECR_REPOSITORY` | variables | |
| `ECS_CLUSTER`, `ECS_API_SERVICE`, `ECS_API_TASK_FAMILY`, `ECS_MIGRATE_TASK_FAMILY` | variables | |
| `ECS_SUBNETS`, `ECS_SECURITY_GROUPS` | variables | Comma-separated ids for the one-off migration task |
| `API_BASE_URL`, `SITE_URL`, `SUPABASE_URL` | variables | Used by the post-deploy smoke test |

## 7. Hosting the API

**Image** — `server/Dockerfile` has three stages: `build`, `migrate` (adds the Prisma CLI for the migration job) and `runtime` (production deps + `dist/`, runs as `node`).
It starts `node dist/server.js` directly so SIGTERM reaches the process. *(Not yet built by the author — run `docker build` locally once.)*

**ECS Fargate service**
- Desired count ≥ 2, spread across AZs; deployment circuit breaker **on with rollback**; minimum healthy 100 %, maximum 200 %.
- Container: port 4000, `initProcessEnabled: true`, `stopTimeout` **30** (must exceed `SHUTDOWN_TIMEOUT_SECONDS`), CPU/memory sized from load tests (start 0.5 vCPU / 1 GB).
- Environment (plain): `NODE_ENV=production`, `PORT=4000`, `LOG_LEVEL=info`, `CORS_ORIGINS`, `SUPABASE_URL`, `DATABASE_SSL=true`, `DATABASE_SSL_CA_FILE=./certs/global-bundle.pem`, `TRUST_PROXY_HOPS`, `DATABASE_POOL_MAX`.
  Secrets (from Secrets Manager): `DATABASE_URL`, `RAZORPAY_*`, `DELIVERY_OTP_SECRET`, `SENTRY_DSN`, `METRICS_TOKEN`.
- Logs: `awslogs` driver to CloudWatch Logs (the API writes one JSON object per line to stdout).

**ALB**
- Listener 443 with an ACM certificate, 80 redirects to 443. Target group health check: **`GET /api/v1/health/ready`**, expect 200, interval 15 s, healthy 2, unhealthy 3.
- *Deregistration delay* **30 s** (default 300 is far longer than a graceful shutdown needs). *Idle timeout* 60 s — the API's keep-alive (65 s) is deliberately longer.
- Optional: attach **AWS WAF** with a rate-based rule (e.g. 2 000 requests / 5 min / IP) and the AWS managed *Common* + *SQLi* rule groups in **count** mode first.
  Leave body inspection of `/api/v1/webhooks/razorpay` off (the signature covers the exact bytes).

**What shutdown does on a deploy** — ECS sends SIGTERM → `/health/ready` immediately returns 503 (the ALB starts draining) → the API keeps serving for
`SHUTDOWN_DRAIN_SECONDS` → stops accepting, closes idle keep-alive sockets, lets in-flight requests finish → closes the database pool → exits 0. If requests are still
running at `SHUTDOWN_TIMEOUT_SECONDS` it exits 1. A crash (`uncaughtException`) is reported, skips the drain and exits 1 so ECS replaces the task.

## 8. Hosting the storefront

- **Vercel**: create the project from `client/`, set the variables above for *Production* and *Preview*, add the domain. Build command `npm run build`.
  *Cache Components* require the Node runtime (the default); do not move pages to the Edge runtime.
- **Self-hosted Node**: `npm ci && npm run build && npm start` behind any TLS-terminating proxy; set `NEXT_PUBLIC_*` in the build environment.
- **Domains & cookies**: serve the storefront and API as `www.example.in` and `api.example.in` (same registrable domain). The API is called from the browser with a bearer token, so CORS must list the storefront origin exactly.
- **Headers** are set by `next.config.ts` → `client/security-headers.ts` (nosniff, frame denial, referrer and permissions policies, COOP, HSTS and a CSP on https production builds). `npm run build` followed by
  `node scripts/check-headers.mjs <url>` verifies a running instance; CI does this on every change and the deploy smoke test does it against the live site.
- The CSP uses `'unsafe-inline'` for scripts/styles because a nonce-based policy would force every page to render per request, defeating Cache Components. It still blocks foreign script hosts,
  `<object>`, `<base>`, framing and unknown network destinations.

## 9. Migrations and rollback

**Applying** — only ever `prisma migrate deploy` (applies pending migration files, never generates or resets anything). Never `migrate dev`, `migrate reset` or `db push` against a shared database.
In CI/CD the `migrate` job runs it as a one-off ECS task in the VPC *before* the new API rolls out; if it fails the API is not updated.
Manually (staging/emergencies), from a bastion or `aws ecs execute-command` shell: `cd server && DATABASE_URL=… npx prisma migrate deploy`.

**Guards that run before you get here** (CI): `npm run db:verify` applies every migration to a fresh Postgres and asserts the database-level guarantees (stock, prices, refunds, uniqueness);
`npm run db:drift` fails if `schema.prisma` and the migration files disagree.

**Writing safe migrations** — during a rollout the *old* API tasks keep running against the *new* schema, and a rollback runs the old code against it again. So:
1. **Expand**: add nullable columns / new tables / new indexes; make the code work with and without them.
2. **Deploy** the code that uses them.
3. **Contract** (a later release): drop the old columns/tables once no running version reads them.
Avoid in one step: renaming or dropping a column, adding `NOT NULL` without a default, or long table rewrites. Create large indexes `CONCURRENTLY` (a separate, hand-written migration; Prisma
runs each migration in a transaction unless told otherwise — test on a copy first).

**Before every production migration** take a manual snapshot (cheap insurance):
`aws rds create-db-snapshot --db-instance-identifier <id> --db-snapshot-identifier pre-<release>-$(date +%Y%m%d%H%M)`.

**Rolling back**
- *Code only* (the usual case): ECS → service → *Update* → pick the previous task-definition revision (the deploy summary prints it), or let the circuit breaker do it. Safe whenever the schema was changed
  expand-style. Then fix forward.
- *A migration that failed half-way*: `prisma migrate deploy` stops at the failing migration and records it as failed. Inspect the error, repair the database by hand to a consistent state, then
  `npx prisma migrate resolve --rolled-back <name>` (or `--applied <name>` if you completed it by hand) and re-run. Prisma has **no automatic down migrations**.
- *Data damaged by a bad release*: point-in-time restore to a **new** instance ([Backups](#11-backups-and-recovery)), compare, then either cut over or copy the rows back. Restoring loses everything written after the restore point — including orders and payments —
  so reconcile against Razorpay's dashboard (the source of truth for money) before reopening.

## 10. Seeding policy

- **Production database: never run the seed.** `npm run seed` loads a 33-product *demo* catalogue with generated placeholder images and refuses to run when `NODE_ENV=production`
  unless `SEED_ALLOW_PRODUCTION=yes` — never set that variable on a production task or shell.
- **Production data** is created in the app: categories, products, variants, images (by URL), stock, coupons and store settings through the admin screens. Store settings have sensible defaults in code (see Admin → Settings) — review shipping, GST, COD and return windows before launch.
- **Staging** may be seeded from a one-off task or a bastion: `SEED_ALLOW_PRODUCTION=yes npm run seed` with the **staging** `DATABASE_URL`. Check the host in the URL twice.
- **First admin**: the person signs in to the live storefront once (this creates their profile), then `cd server && DATABASE_URL=… npm run make-admin -- owner@example.in`
  (run as a one-off ECS task with the `migrate` image or from a bastion). It writes an audit-log entry. Every later role change is done in Admin → Users.
- No test or demo accounts exist in production; never create users by writing to the `Profile` table.

## 11. Backups and recovery

| What | How | Notes |
|---|---|---|
| Orders, payments, catalogue, profiles | RDS automated backups (14–35 days) with **point-in-time recovery**; manual snapshot before each production migration; optional cross-region snapshot copy | Recovery creates a **new** instance — you repoint `DATABASE_URL` |
| User identities & passwords | Supabase project backups (paid plans) | Profiles reference Supabase user ids; losing the Auth project strands accounts |
| Money | Razorpay dashboard | Source of truth for payments/refunds; reconcile after any restore |
| Product images | S3 bucket with versioning (if you host them) | Images are referenced by URL, not stored in the database |
| Secrets | Secrets Manager (versioned) | Keep an offline, access-controlled record of how to recreate each one |

Suggested targets: **RPO** ≤ 5 minutes (PITR), **RTO** ≈ 1 hour. **Drill it:** each quarter restore the latest backup to a scratch instance, point a staging API at it, run `npm run db:verify`-style
spot checks (order counts, a sample order's totals), then delete the instance. An untested backup is a hope, not a backup.

## 12. Monitoring and alerts

### What the API emits

- **Logs** — JSON lines on stdout: `level`, `time`, `service`, `env`, `release`, `msg`, and for requests `req.{id,method,path,userAgent,remoteAddress}`, `res.statusCode`, `responseTime`, plus `userId`/`role` when signed in.
  Health probes are not logged. **Redaction**: `Authorization`/`Cookie`/signature headers are removed; query strings are never logged; and every string is scrubbed for e-mail addresses, JWTs, bearer tokens,
  Razorpay/Supabase keys and card numbers (Luhn-checked), and fields named like `password`, `token`, `secret`, `otp`, `phone`, `email`, `card…` are blanked.
- **Request ids** — every response carries `X-Request-Id` (the ALB's id if it sent a sane one, otherwise generated); a 500 response body repeats it as `error.requestId`. Ask the user for it, then search the logs.
- **Health** — `GET /api/v1/health` (liveness, never touches the database, reports `release`), `GET /api/v1/health/ready` (database check with a 2 s timeout; **503 while draining**).
- **Metrics** — `GET /api/v1/health/metrics` (Prometheus text format) with `Authorization: Bearer $METRICS_TOKEN`: `payantra_http_requests_total` and `payantra_http_request_duration_seconds` by method, **route pattern** and status,
  plus uptime, memory and `payantra_build_info`. Counters are per task; scrape every task (e.g. ADOT collector / Grafana Agent sidecar), or derive the same numbers from the access logs.
- **Error reports** — every unhandled 500 is logged at `level:50` and, if `SENTRY_DSN` is set, also POSTed (scrubbed, no request body/headers, tagged with `request_id` and `release`) to that Sentry-compatible endpoint.
  No SDK is installed; it is a minimal `fetch` of Sentry's envelope API and has been tested against a local stand-in only — *confirm events appear in your Sentry project on staging*.

### CloudWatch Logs Insights — starting queries

```
# everything about one request
fields @timestamp, level, msg, req.path, res.statusCode, err.message | filter req.id = "<request id>" or requestId = "<request id>" | sort @timestamp

# 5xx by route, last hour
filter res.statusCode >= 500 | stats count() as errors by req.path | sort errors desc

# slow requests
filter responseTime > 1500 | stats count() as n, avg(responseTime) as avg_ms by req.path | sort n desc
```

### Alerts to create (CloudWatch alarms → SNS → e-mail / chat / pager)

| Signal | Threshold (starting point) | Why |
|---|---|---|
| ALB `HTTPCode_Target_5XX_Count` / requests | > 2 % for 5 min | Errors reaching customers |
| ALB `UnHealthyHostCount` | ≥ 1 for 5 min | A task failing `/health/ready` (database down?) |
| ALB `TargetResponseTime` p95 | > 2 s for 10 min | Slow checkout |
| Log metric filter `{ $.level = 50 }` | > 5 in 5 min | Unhandled exceptions |
| ECS service running count | < desired for 5 min | Crash loop / failed deploy |
| ECS memory / CPU | > 85 % for 15 min | Capacity |
| RDS `CPUUtilization` | > 80 % for 15 min | |
| RDS `DatabaseConnections` | > 80 % of `max_connections` | Pool budget exhausted ([RDS §3.6](#3-aws-rds-postgresql)) |
| RDS `FreeStorageSpace` | < 20 % | |
| RDS `FreeableMemory`, `ReadLatency`/`WriteLatency` | trend alarms | |
| External uptime check on `https://api.example.in/api/v1/health/ready` and the storefront | 2 consecutive failures | Independent of AWS (UptimeRobot, Better Stack, CloudWatch Synthetics) |
| Razorpay dashboard → webhook failure alerts / e-mail | on | Razorpay disables a webhook that keeps failing |

### Business health checks (run as a scheduled query or Metabase panel; each should normally return 0 rows)

Table names are Prisma's defaults (quoted, capitalised). *Try them on staging first.*

```sql
-- Webhooks that failed or never finished, older than 10 minutes
SELECT "eventId", "eventType", "error", "createdAt" FROM "WebhookEvent"
WHERE ("processedAt" IS NULL OR "error" IS NOT NULL) AND "createdAt" < now() - interval '10 minutes';

-- Online orders still unpaid well after their stock reservation ran out (the sweeper should have cancelled them)
SELECT "orderNumber", "createdAt", "stockExpiresAt" FROM "Order"
WHERE "paymentMethod" = 'RAZORPAY' AND "paymentStatus" = 'PENDING' AND "fulfilmentStatus" <> 'CANCELLED'
  AND "stockExpiresAt" < now() - interval '30 minutes';

-- Refunds that Razorpay rejected, or that have been pending too long
SELECT "id", "paymentId", "amount", "status", "createdAt" FROM "Refund"
WHERE "status" = 'FAILED' OR ("status" = 'PENDING' AND "createdAt" < now() - interval '1 hour');
```

### Runbook pointers

- *Orders stay "Payment pending" after paying* → webhook not arriving: check the Razorpay delivery log, the URL, the secret ([PAYMENTS.md](PAYMENTS.md)); `/payments/verify` normally settles without it.
- *Readiness 503 on all tasks* → database unreachable (security group, credentials, `max_connections`) — see RDS metrics; the API recovers by itself when the database returns.
- *Sudden 429s* → someone is hammering an endpoint, or `TRUST_PROXY_HOPS` is wrong so every visitor shares one IP (check `req.remoteAddress` in logs).

## 13. CI/CD

Workflows live in `.github/workflows/` (secrets only in GitHub *Environments*, never in files):

| File | Runs | What |
|---|---|---|
| `ci.yml` | every PR and push to `main`; reusable by the deploy workflow | **server**: typecheck, lint, tests on PGlite (including the security suites), `db:verify`, `db:drift`, build, `smoke:boot`. **client**: lint, typecheck, production build with *no API running*, security-header check on the built site. **dependency-audit**: fails on unaccepted high/critical advisories in production dependencies. **e2e** (browser suite): pushes to `main`, before deploys, manual runs, and PRs labelled `e2e` |
| `audit.yml` | weekly + manual | Same audit gate, so new advisories surface without a code change |
| `deploy.yml` | tag `vX.Y.Z` → staging; manual dispatch → staging or production | CI → build API + migration images → migration task → ECS rollout → storefront deploy → smoke test. **Skeleton** |

Accepted audit findings go in `.github/audit-allowlist.json` with a reason and an **expiry date** — the gate fails again when it expires.
Branch protection (recommended): require `server`, `client`, `dependency-audit` on `main`; require reviewers on the `production` environment.

Running the same checks locally: `cd server && npm run typecheck && npm run lint && npm test && npm run db:verify && npm run db:drift && npm run build && npm run smoke:boot`;
`cd client && npm run lint && npx tsc --noEmit && npm run build`. (Your shell may have `NODE_ENV=production`, which makes npm skip dev dependencies: use `npm install --include=dev`.)

## 14. Security configuration summary

- **Tests**: `server/src/tests/security.*.test.ts` — authentication of every route, RBAC sweep of every admin/delivery route for every role, suspended accounts, IDOR (404 not 403, identical to a missing id), real-signature JWT forgery cases
  (expired, wrong audience/issuer, `alg:none`, tampering, algorithm confusion), mass assignment, malformed/oversized bodies, NUL bytes, SQL-injection and script payloads, CSV formula injection, CORS, headers, webhook signature/size/shape, production-config validation, log redaction, error reporting, health/metrics, graceful shutdown.
- **API headers**: Helmet defaults + `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `no-store` on any response to a request carrying credentials, `X-Request-Id`.
- **CORS**: exact-origin allow-list; a foreign `Origin` gets no `Access-Control-Allow-Origin`.
- **Rate limits**: 300/min per IP overall, 30 per 15 min on sensitive writes — **per task**. Add WAF rate rules for a global limit. Credential stuffing against sign-in is handled by Supabase's own auth rate limits, not by this API.
- **Dependency audit**: `npm audit` is part of CI. State at the time of writing: server — 0 known vulnerabilities (Prisma updated to 7.10.1 to clear four); client — 1 accepted advisory (`braces`, via the `shadcn` CLI, no patched release exists; see the allow-list entry).
- **Least privilege**: separate migration and runtime database users ([§3](#3-aws-rds-postgresql)); the API never holds a Supabase service-role key; GitHub holds only deploy credentials; AWS access via OIDC.
- **Secrets hygiene**: rotate `RAZORPAY_*` and `DELIVERY_OTP_SECRET` on suspicion of exposure; set a reminder to review quarterly. Never log or paste `.env` files.

## 15. Go-live checklist

**Accounts & infrastructure**
- [ ] RDS created per [§3](#3-aws-rds-postgresql): private, encrypted, Multi-AZ, backups ≥ 14 days, deletion protection, `rds.force_ssl=1`, security groups verified
- [ ] Two database users created and grants verified on staging; connection budget calculated
- [ ] ECS service, ALB (HTTPS, health check `/api/v1/health/ready`, deregistration 30 s), ECR repository, task roles and Secrets Manager entries created
- [ ] DNS + TLS: `www.` and `api.` records, ACM certificate; HTTP→HTTPS redirect
- [ ] Production Supabase project: asymmetric JWT keys, Email (confirmation on) + Google providers, Site URL and redirect URLs correct (no localhost), custom SMTP with SPF/DKIM
- [ ] Razorpay account activated; live keys generated; live webhook created with the six events and its own secret

**Configuration**
- [ ] Every variable in [§6](#6-environment-variable-reference) set; API boots (a bad value stops it at start-up with the variable named)
- [ ] `CORS_ORIGINS` is exactly the storefront origin(s); `TRUST_PROXY_HOPS` matches the real number of proxies
- [ ] Storefront built with production `NEXT_PUBLIC_*` (https site URL, live Razorpay key, production Supabase project)
- [ ] `RAZORPAY_API_BASE` is **unset**; no `rzp_test_` key in production; `SEED_ALLOW_PRODUCTION` is **not** set anywhere

**Verification on staging (same configuration, test keys)**
- [ ] CI green on the release commit, including e2e
- [ ] Migrations applied by the pipeline; `prisma migrate deploy` TLS connection confirmed
- [ ] Sign-up with e-mail confirmation (real inbox) and Google sign-in work end to end
- [ ] Test-mode payment: success, failure, window closed + retry, cancel + refund, partial refund; webhook deliveries show `200`
- [ ] Browser console clean on the checkout page (no CSP violations); `node client/scripts/check-headers.mjs https://staging…` passes
- [ ] Rolling deploy under light traffic loses no requests; killing a task is replaced; readiness flips during shutdown
- [ ] Sentry (if used) receives a deliberate test error; log queries find a request by id; metrics scraped
- [ ] Backup restore drill completed once; alarms in [§12](#12-monitoring-and-alerts) created and a test alert delivered to a human

**Launch**
- [ ] Production data entered: categories, products with images/stock, coupons, store settings (shipping, GST, COD, returns); contact details and policy pages reviewed by the business (the privacy/terms pages are templates, not legal advice)
- [ ] First admin promoted with `make-admin`; additional admins promoted from Admin → Users; admin e-mail accounts protected with MFA
- [ ] Manual RDS snapshot taken
- [ ] Small real order placed and refunded; settlement seen in Razorpay
- [ ] On-call owner and escalation path written down; this document linked from it

**After launch (first week)**
- [ ] Watch 5xx, latency, `WebhookEvent` failures, stuck-order and failed-refund queries daily
- [ ] Review CSP reports / console errors; tighten or widen `client/security-headers.ts` deliberately
- [ ] Re-run the dependency audit; clear or re-date allow-list entries

## 16. Incident quick reference

| Symptom | First look | Likely fix |
|---|---|---|
| Customers see errors on every page | ALB 5xx + target health | Task crash loop → previous task-definition revision |
| Checkout works but orders stay pending | Razorpay → Webhooks → delivery log | Wrong URL/secret; WAF altering the body; API 5xx |
| Pay button disabled / Checkout will not open | Browser console | Ad-blocker, or a CSP violation (try `CSP_MODE=report-only`) |
| Everyone suddenly rate-limited | `req.remoteAddress` in logs | `TRUST_PROXY_HOPS` wrong after a networking change |
| Sign-in fails for everyone | Supabase status, JWKS reachable from the API | Wrong `SUPABASE_URL`; project paused; clock skew on the task |
| New release misbehaves | `release` in `/health`, Sentry | Roll back the service ([§9](#9-migrations-and-rollback)) |
| Database full / out of connections | RDS metrics | Raise storage / lower `DATABASE_POOL_MAX` × tasks / RDS Proxy |

## 17. Known gaps

- Not exercised against live AWS, Supabase, Razorpay or GitHub Actions; the CSP allow-list for Razorpay (`https://*.razorpay.com`) is based on Razorpay's documented hosts, not observed on a live checkout.
- `server/Dockerfile` and `deploy.yml` are unbuilt skeletons; the Sentry reporter was tested against a local stand-in only.
- Rate limits are per process, not global; no CAPTCHA on sign-up; no MFA enrolment in the admin UI; no WAF or DDoS protection is configured by this repository.
- Metrics are in-process counters (reset on restart); there is no tracing.
- `shadcn` (a CLI) is listed as a runtime dependency of the storefront and carries the one accepted audit finding; moving it to `devDependencies` would shrink the production install (left alone because `client/package.json` is being edited for Phase 5).
