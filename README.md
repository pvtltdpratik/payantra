# Payantra

Premium Indian fashion e-commerce: Next.js storefront + Express API + PostgreSQL (AWS RDS) + Supabase Auth + Razorpay.

> **Status: Phase 6 — Hardening.** Phases 1–6 are built and tested: foundation, authentication & catalogue, commerce and payments, the
> three dashboards, the landing page with its motion layer (GSAP, Lenis, ReactBits, a lazy 3D hero with static fallbacks), and now production
> hardening: security tests, fail-fast production configuration, structured redacted logs, health/metrics/error-report hooks, CI/CD and a
> deployment guide ([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)). **Open items:** the Lighthouse ≥ 85 mobile target was reached (about 80) only on a fast
> machine and is not yet confirmed for the final build; see [docs/MOTION.md](docs/MOTION.md). Nothing has yet been run against live AWS, Supabase or
> Razorpay, or on GitHub Actions itself — walk the staging and go-live checklists in the deployment guide.
> See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the plan and ER diagram, [docs/API.md](docs/API.md) for the endpoints,
> [docs/PAYMENTS.md](docs/PAYMENTS.md) for how payments, stock and refunds stay correct (and the Razorpay sandbox checklist),
> [docs/DELIVERY.md](docs/DELIVERY.md) for delivery partners and the delivery code, [docs/REPORTS.md](docs/REPORTS.md) for how every dashboard number is defined,
> and [docs/MOTION.md](docs/MOTION.md) for the landing page, the animation layer and the performance notes.

## What works today

| Area | Capability |
|---|---|
| Storefront | Shop, category, search (with live suggestions), product pages: filters (size/colour/fabric/price/rating/stock), sorting, pagination, image gallery with zoom, variant picker with live availability, size guide, JSON-LD |
| Auth | Email + password, Google OAuth, email verification, forgot/reset password, session refresh, sign-out, account page |
| Roles | `CUSTOMER` / `DELIVERY_PARTNER` / `ADMIN` stored in the database; admin-only role & status management with audit log; last-admin protection |
| Admin | Products (create/edit/archive), variants, images, inventory adjustments with stock ledger, categories, users & roles |
| Shopping | Cart (live availability, quantity limits), wishlist, address book, coupons (percentage/flat, caps, minimums, per-user and total limits), server-side pricing with GST and shipping rules |
| Checkout | Razorpay (UPI/cards/net banking) or Cash on Delivery; stock reserved before payment; idempotent order creation; retry after a failed or abandoned payment; unpaid orders expire and release stock |
| Payments | Server-side order creation, HMAC signature verification, idempotent webhooks, late-payment recovery, automatic refunds of duplicates, partial and full refunds with provider-timeout recovery |
| Orders | Timeline tracking, cancellation, return/replacement requests, reorder, printable invoice, in-app notifications |
| Admin | Products, variants, images, inventory + ledger, categories, users & roles, **orders pipeline, refunds, return queue, coupons, store settings (shipping, COD, reservation window, return window)** |
| Delivery partners | Apply → admin approval → go online → accept/decline → pick up → out for delivery → **deliver with the customer's 6-digit code** (or report a failed attempt, retry, or return to origin); privacy-limited customer details, cash-on-delivery amounts, earnings and 14-day performance. Mobile-first at `/delivery` |
| Admin dashboard | Live overview (net revenue, orders, customers, partners, low stock, pending work, recent transactions, sales chart, change vs the previous period); **reports** for sales, products, inventory, payments & refunds and delivery with **CSV export**; customers; delivery-partner approval and assignment; support inbox; review moderation; banners; newsletter; audit log |
| Customer account | Profile, addresses, orders with live delivery tracking, **reviews** (verified purchases only), **recently viewed**, notifications (header bell), help & support, password change and "sign out other devices", newsletter sign-up |
| Landing page | Hero with a lazy React Three Fiber silk-and-jewellery scene (capable desktops only; static artwork otherwise, with a pause control), GSAP reveals and parallax, Lenis smooth scroll (mouse devices), ReactBits effects; sections for categories, featured/new/best sellers, collections, craftsmanship, seasonal edits, admin-scheduled offers and announcement bar, real customer reviews, brand story, newsletter and a product-photo gallery. Everything reads live data and hides when empty; works with reduced motion, without JavaScript, and on phones without any 3D |
| Policies & contact | Shipping, returns (quoting the live store settings), privacy, terms and contact pages; footer contact details and social links come from `NEXT_PUBLIC_*` variables and are hidden when unset |
| Data | 33-table schema, 6 migrations, DB-level integrity (stock, prices, totals, refunds, uniqueness), seed script with 33 products |
| Hardening (Phase 6) | 600+ server tests, including security suites that sweep **every** route for authentication and role checks, ownership (IDOR), forged/expired/mis-addressed JWTs, injection and script payloads, CORS and headers, webhook abuse; **production configuration is validated at boot** (TLS to the database, exact HTTPS CORS origins, no placeholder secrets); JSON logs with request ids and PII/token/card redaction; `/health`, `/health/ready` (503 while draining) and optional Prometheus `/health/metrics`; optional Sentry-compatible error reports; graceful shutdown; storefront security headers + Content-Security-Policy; GitHub Actions for CI, a weekly dependency audit and a deploy skeleton |

Not built yet: nothing from the original phase plan. Still to do before real customers: the go-live checklist in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (live-account verification, backups drill, alerts).

## Repository layout

| Path | What |
|---|---|
| `client/` | Next.js 16 (App Router, Cache Components) · TypeScript · Tailwind v4 · shadcn/ui · GSAP · Lenis · R3F |
| `server/` | Express 5 · TypeScript (ESM) · Prisma 7 · Zod · Pino |
| `e2e/` | Browser tests: the real API + the real storefront in headless Edge/Chrome, with stand-ins for Supabase and Razorpay |
| `docs/` | Architecture, API reference, payments, delivery, reports, landing page & motion, **deployment** |
| `.github/` | CI (typecheck, lint, tests, drift/verify, build, boot smoke test, header check, dependency audit, optional e2e), weekly audit, deploy skeleton |

## Prerequisites

- Node.js 20+ (developed on 24)
- A **Supabase** project (for sign-in). For local browsing of the catalogue you need nothing else.
- Later, for production: **AWS RDS PostgreSQL** and a **Razorpay** account.

## Quick start — no cloud accounts needed

The repo ships a local Postgres (PGlite, a real Postgres engine in WASM) so you can run the whole stack on your machine.

```bash
# 1. Local database (keep running)
cd server
npm install --include=dev
npm run db:dev                       # → postgresql://postgres:postgres@127.0.0.1:5433/postgres

# 2. In a second terminal: API
cd server
cp .env.example .env                 # then set DATABASE_URL, DATABASE_POOL_MAX=1, SUPABASE_URL (any https URL for now), RAZORPAY_* (any value);
                                     # production also needs DELIVERY_OTP_SECRET (32+ random characters, see .env.example)
npm run seed                         # 33 demo products
npm run dev                          # http://localhost:4000/api/v1/health/ready

# 3. Third terminal: storefront
cd client
npm install --include=dev
cp .env.example .env.local           # set NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run dev                          # http://localhost:3000
```

Browsing the shop needs no Supabase credentials. Signing in, the account page and the admin area need a real Supabase project.

> **`DATABASE_POOL_MAX=1` is required with the PGlite dev database.** PGlite is a single Postgres session shared by every connection,
> so overlapping transactions from a multi-connection pool interleave and fail. Use the default (10) on RDS.

### Becoming an admin

1. Sign in once through the storefront (this creates your profile).
2. `cd server && npm run make-admin -- you@example.com`

After that, admins manage other roles at **/admin/users**; every change is written to the audit log.

## Cloud setup

### Supabase

1. Create a project; copy **Project URL** and the **anon (publishable) key**.
2. *Authentication → Providers*: enable **Email** (keep "Confirm email" on) and **Google**.
3. *Authentication → URL Configuration*: Site URL `http://localhost:3000`; redirect URL `http://localhost:3000/auth/callback`.
4. The API only *verifies* tokens (via the project's JWKS) — **never** put the `service_role` key anywhere in this repo.

### AWS RDS PostgreSQL

1. PostgreSQL 16 instance → create database `payantra` → security group allows `5432` only from the API server (and your IP while developing).
2. Set `DATABASE_URL`, `DATABASE_SSL=true` and `DATABASE_SSL_CA_FILE=./certs/global-bundle.pem` (the [RDS CA bundle](https://truststore.pki.rds.amazonaws.com/) ships in `server/certs/`) so the database certificate can be verified. Without it every query fails with `self-signed certificate in certificate chain`.
3. Apply migrations: `cd server && npx prisma migrate deploy`.

## Commands

| Where | Command | Purpose |
|---|---|---|
| server | `npm run dev` | API with reload |
| server | `npm run db:dev` | Local Postgres (PGlite) on :5433 |
| server | `npm run seed` | Demo catalogue (idempotent; refuses `NODE_ENV=production`) |
| server | `npm run make-admin -- <email>` | Promote an existing user to ADMIN |
| server | `npm test` | 600+ tests (incl. the `security.*` suites) against a real (in-memory) Postgres engine, with a stand-in for Razorpay's API. Its exit code is trustworthy: non-zero when anything fails |
| server | `npm run test:pg` | The same suite against a **private, throwaway PostgreSQL server** with a real 10-connection pool (needs PostgreSQL binaries installed; never touches an existing server) |
| server | `npm run db:verify` | Apply all migrations and assert the DB-level guarantees |
| server | `npm run db:drift` | Fail if `schema.prisma` and the migrations disagree |
| server | `npm run typecheck` / `lint` / `build` / `start` | |
| server | `npm run smoke:boot` | After `build`: boots the compiled server in production mode on a private database, checks fail-fast config, health, metrics, headers, JSON logs and (Linux/macOS) SIGTERM draining |
| server | `npm run audit:prod` | `npm audit` for production dependencies (CI uses `.github/scripts/audit-gate.mjs`, which honours the reviewed allow-list) |
| client | `npm run dev` / `build` / `lint` | |
| e2e | `cd e2e && npm install && npm run e2e` | Full-stack browser run (auth, shopper, admin, catalogue, delivery, experience, home, responsive). Pass spec names to run some (`npm run e2e -- shopper admin`); `E2E_DB=postgres` uses a private real PostgreSQL; `BROWSER_PATH` picks the browser; `E2E_SKIP_BUILD=1` reuses the last storefront build while iterating on specs only |

## Security model (summary)

- Supabase issues JWTs; the API verifies signature, issuer and audience on every request.
- **Roles live in the `Profile` table**, never in the token or a request body. `PATCH /users/me` rejects unknown keys.
- Every admin route sits behind one router-level `requireAuth` + `requireRole('ADMIN')`.
- Money is integer paise; prices are recomputed server-side; `effectivePrice` is CHECK-constrained to `COALESCE(salePrice, basePrice)`.
- Stock cannot go negative or below reserved units (CHECK constraints + atomic conditional updates). Order totals obey `grandTotal = subtotal − discount + shipping` (CHECK).
- The browser never sends a price. Checkout re-prices the cart on the server; payment amounts are compared with the order total before anything is marked paid.
- Razorpay signatures (checkout and webhook) are verified with HMAC-SHA256 in constant time; the webhook is verified against the raw body and de-duplicated by event id.
- Another customer's order, address, wishlist, review or support request is `404`, never `403` (no existence oracle).
- Delivery handover is proven by a six-digit code that is **derived, never stored**; five wrong guesses lock it. Delivery partners see a customer's address and phone only while working that job, never their e-mail or prices.
- Roles are granted server-side by an admin only (partner approval or the Users screen); applying for anything never changes access.
- CSV exports neutralise spreadsheet formulas in customer-supplied text, and are never cached.
- Helmet (with a locked-down CSP on the API), strict CORS allow-list, rate limiting, 100 kB body limit, Zod validation on every input; requests containing NUL characters (which PostgreSQL cannot store) are a `400`, not a `500`.
- **Production refuses to start** with a plain-text database connection (non-local host), a wildcard / non-HTTPS / missing `CORS_ORIGINS`, a placeholder secret, or a stand-in payment endpoint ([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).
- Logs are JSON with a request id on every line; tokens, cookies, signatures, e-mail addresses, JWTs and card numbers are scrubbed, query strings are never logged, and a 500 response carries only a generic message plus the request id.
- The storefront sends `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP, and — on https production builds — HSTS and a Content-Security-Policy allow-listing only Razorpay, Supabase and the API (`client/security-headers.ts`).
- The Next.js proxy redirects unauthenticated visitors early, but is only a convenience — Server Components and the API re-check.

## Troubleshooting

- **`vitest` / `tsc` / `eslint` "not found" after `npm install`** — your shell has `NODE_ENV=production`, so npm skips devDependencies. Use `npm install --include=dev`.
- **`prisma generate` says "No command registered"** — you have the Prisma 8 release candidate. This project pins `prisma@7.10.x` (currently 7.10.1, which also clears the audit findings in 7.10.0) to match `@prisma/client`.
- **API errors/timeouts under load with the dev DB** — set `DATABASE_POOL_MAX=1` (see above).
- **The Pay button stays disabled** — the Razorpay script (`checkout.razorpay.com`) did not load (ad-blocker or offline); the page shows a message after the load fails.
- **Orders stay "Payment pending" after paying** — the webhook is not reaching the API. Check the URL, the secret, and the delivery log in Razorpay's dashboard ([docs/PAYMENTS.md](docs/PAYMENTS.md)). `/payments/verify` normally settles it even without the webhook.
- **Tests hang with no error, or CI is green although tests failed** — a developer's `server/.env` leaked into the run (e.g. `DATABASE_SSL=true` makes every query to the throwaway database hang), or an exit code was lost. The test configs now pin these values; if you add a new env variable that must differ under test, pin it in `server/vitest.config.mts` and `e2e/lib/stack.mjs`.
- **A browser test hangs on a click or wait** — a background tab never runs `requestAnimationFrame`. The helpers in `e2e/lib/browser.mjs` handle this; use them and give each signed-in person their own `isolated` page.
- **Shop shows no filters / products** — check `/api/v1/health/ready` returns `ready` and that `NEXT_PUBLIC_API_URL` was set *when the client was built* (it is inlined at build time).
- **Home page shows "database is unreachable"** — API is up but `DATABASE_URL` is wrong or the RDS security group blocks you.

## Known limitations

- **Product images are referenced by URL**, not uploaded. File upload (S3/Supabase Storage) is planned; set `NEXT_PUBLIC_IMAGE_HOST` to your CDN host so `next/image` can optimise them.
- **Unknown product/category URLs return HTTP 200** with a "not found" page and `noindex`: with partial prerendering the shell streams before the lookup resolves.
- **Not yet run against a live Supabase project or the live Razorpay sandbox.** Both are exercised through stand-ins that speak the same HTTP/JWT
  contracts (`SUPABASE_URL` and `RAZORPAY_API_BASE` are the only seams; no application code is swapped). Walk the checklist in
  [docs/PAYMENTS.md](docs/PAYMENTS.md) and a real Google/email sign-in once before go-live.
- Storefront catalogue pages are cached for about a minute (`cacheLife("minutes")`), so an admin's price or stock change can take that long to *appear*.
  It cannot cause a wrong charge: the cart and checkout always use the server's current price and stock.
- The invoice shows GST per line but has no seller GSTIN/address or CGST/SGST/IGST split yet — add a seller setting before issuing invoices legally.
- Cash on Delivery refunds are handled outside the system (the admin UI says so); only online payments are refunded through Razorpay.
- Collections have an admin API but no admin screen yet.
- Product, category and collection images on the landing page are generated placeholders until real photography is uploaded; the style gallery uses product photos, not a live Instagram feed. The privacy and terms pages are plain-language templates, not legal advice.
- Delivery assignment is manual (an admin chooses the partner); there is no automatic dispatch or live location. Partner payouts are shown as earnings but settled outside Payantra ([docs/DELIVERY.md](docs/DELIVERY.md)).
- Support is a simple inbox with one reply per message — not a full ticketing system. The newsletter stores subscribers; sending campaigns needs an e-mail provider.
- Reports hold up to 1,000 rows on screen and 50,000 in a CSV; narrow the dates for more. Profit and margin are not reported because no product cost is stored.
- Catalogue search is `ILIKE`-based; add `pg_trgm`/full-text indexes when the catalogue grows past a few thousand products.
- **Phase 6 limits** ([docs/DEPLOYMENT.md §17](docs/DEPLOYMENT.md#17-known-gaps)): the deploy workflow, `server/Dockerfile`, AWS settings and the Razorpay Content-Security-Policy allow-list are unexecuted skeletons/best-knowledge; rate limits and metrics are per process (add a WAF rule for a global limit); no CAPTCHA or admin MFA screen; one accepted client audit finding (`braces` via the `shadcn` CLI, no fix published).
- Prisma 7 requires the `@prisma/adapter-pg` driver adapter; the connection URL lives in `prisma.config.ts`.
- The server is native ESM: relative imports carry a `.js` extension, and the Prisma client is generated with `importFileExtension = "js"`.
