# Payantra API reference (Phases 2–3)

Base URL: `/api/v1`. All responses use one envelope:

```jsonc
{ "success": true,  "data": …, "meta": { "page": 1, "pageSize": 24, "total": 33, "totalPages": 2 } }
{ "success": false, "error": { "code": "BAD_REQUEST|UNAUTHORIZED|FORBIDDEN|NOT_FOUND|CONFLICT|UNPROCESSABLE|RATE_LIMITED|NOT_READY|INTERNAL_ERROR", "message": "…", "details": … } }
```

- **Money is integer paise** everywhere (`1499.50 INR` → `149950`).
- **Auth:** `Authorization: Bearer <Supabase access token>`. The role is read from the database, never from the token.
- **Pagination:** `page` (≥1), `pageSize` (1–100). **Rate limit:** `RATE_LIMIT_MAX` (default 300) requests/min/IP globally; `RATE_LIMIT_SENSITIVE_MAX` (default 30) per 15 min on sensitive writes (coupon codes, checkout, payment verification, cancellations, returns, refunds).

## Public

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness — never touches the database |
| GET | `/health/ready` | Readiness — `503` when the database is unreachable |
| GET | `/categories` | Active category tree; parent counts include descendants |
| GET | `/categories/:slug` | Category with breadcrumb and children |
| GET | `/collections` | Active collections inside their date window |
| GET | `/products` | Filtered, sorted, paginated list (below) |
| GET | `/products/facets` | Sizes, colours, fabrics and price range for `q`, `category`, `gender` |
| GET | `/products/:slug` | Detail with variants, capped availability and stock status |
| GET | `/search` | Alias of `/products` |
| GET | `/search/suggestions?q=` | ≥2 characters: up to 6 products and 3 categories |

### `GET /products` query

| Param | Meaning |
|---|---|
| `q` | Case-insensitive match on name, description, fabric, occasion, category name |
| `category` | Category slug; **includes sub-categories**. Unknown slug → empty page, not an error |
| `collection` | Collection slug |
| `gender` | `WOMEN` \| `MEN` \| `UNISEX` (WOMEN/MEN also return UNISEX items) |
| `minPrice`, `maxPrice` | Paise, against the **effective** (sale-aware) price |
| `size`, `colour`, `fabric` | Comma-separated or repeated; case-insensitive. All variant filters must match the **same variant** |
| `inStock=true` | At least one active variant with `onHand > reserved` |
| `minRating` | 1–5 |
| `featured`, `newArrival` | `true` |
| `sort` | `newest` (default) \| `price_asc` \| `price_desc` \| `popularity` \| `rating` |

Only `ACTIVE` products in active categories are ever returned. Raw stock counts are never exposed; variants carry `available` (capped at 10) and `stockStatus` (`IN_STOCK` \| `LOW_STOCK` \| `OUT_OF_STOCK`).

## Authenticated

| Method | Path | Notes |
|---|---|---|
| GET | `/users/me` | Profile and role. First call creates the profile (name/avatar seeded from Google) |
| PATCH | `/users/me` | `fullName`, `phone` (10-digit Indian mobile), `avatarUrl`. Unknown keys such as `role` → `400` |

## Shopping (authenticated, any role)

Every figure — unit prices, discount, shipping, GST, grand total — is computed by the server from the database. Clients send
*what* they want (variant ids, quantities, a coupon code, an address id), never a price.

### Cart

| Method | Path | Notes |
|---|---|---|
| GET | `/cart` | Priced cart: lines with live availability and an `issue` (`UNAVAILABLE`, `OUT_OF_STOCK` or `INSUFFICIENT_STOCK`), `pricing`, `canCheckout` |
| GET | `/cart/summary` | `{count}` — the badge number |
| POST | `/cart/items` | `{variantId, quantity}` — adds (merges with an existing line). `409` when it would exceed available stock |
| PATCH | `/cart/items/:variantId` | `{quantity}` — sets the quantity |
| DELETE | `/cart/items/:variantId` | Removes a line |
| DELETE | `/cart` | Empties the cart (and clears its coupon) |
| PUT | `/cart/coupon` | `{code}` — case-insensitive. Unknown *and* ineligible codes both answer `422` with a reason |
| DELETE | `/cart/coupon` | |

`pricing` = `{subtotal, discountTotal, shippingTotal, taxTotal, grandTotal, couponCode, couponNote, freeShippingRemaining}`, where
`grandTotal = subtotal − discountTotal + shippingTotal` (also a database CHECK constraint). Prices include GST; `taxTotal` is the GST
contained in them. A coupon that stops being valid (expired, limit reached, below its minimum) is dropped with a `couponNote`.

### Wishlist, addresses, coupons

| Method | Path | Notes |
|---|---|---|
| GET | `/wishlist` | Saved products that are still on sale, newest first |
| GET | `/wishlist/ids` | Just the product ids — one request lights every heart on a page |
| POST / DELETE | `/wishlist/:productId` | Idempotent |
| GET / POST | `/addresses` | Max 10 per user. The first address becomes the default |
| PATCH / DELETE | `/addresses/:id` | Setting a default un-defaults the others atomically; deleting the default promotes another. Orders keep their own **snapshot** of the address |
| POST | `/coupons/validate` | `{code}` → `{valid, code, discount, note, grandTotal}`: previews the code against the current cart without attaching it. Rate-limited (it is what a code-guessing script would hammer) |

### Checkout and payment

| Method | Path | Notes |
|---|---|---|
| GET | `/checkout/options` | `{codEnabled, codMaxOrder}` |
| POST | `/checkout` | `{addressId, paymentMethod: "RAZORPAY" or "COD", idempotencyKey}` — see below |
| POST | `/payments/verify` | `{razorpay_order_id, razorpay_payment_id, razorpay_signature}` → `{status: "PAID", "PENDING" or "FAILED", orderId}` |
| POST | `/payments/:orderId/retry` | Re-opens payment for an unpaid order that still holds its stock → `{status, payment}` |
| POST | `/webhooks/razorpay` | Mounted **before** the JSON parser: HMAC-verified against the raw body. See [PAYMENTS.md](PAYMENTS.md) |

`POST /checkout` runs in one transaction: it locks the idempotency key, re-reads the cart, re-prices it, **reserves stock**, creates the
order (`PLACED`) and snapshots the address. For `RAZORPAY` it then creates the Razorpay order and returns
`{order, payment: {keyId, razorpayOrderId, amount, currency, name, description, prefill}}`; for `COD` `payment` is `null`.
**Re-sending the same `idempotencyKey` returns the same order** (never a second one), so a timed-out request is safe to repeat. A definite
failure (`409` stock changed, `422` COD limit) leaves no order behind.

Unpaid online orders hold their stock for `reservationMinutes` (default 15, an admin setting); a background sweeper then cancels them and
releases the stock — after first asking Razorpay whether the customer actually paid.

### Orders

| Method | Path | Notes |
|---|---|---|
| GET | `/orders` | Own orders, newest first |
| GET | `/orders/:id` | Items, totals, address snapshot, **timeline**, refunds, returns, and `actions` (`canCancel`, `canRetryPayment`, `canReturn`, `canViewInvoice`, `returnWindowEndsAt`). Another customer's order is `404`, never `403` |
| POST | `/orders/:id/cancel` | `{reason}` — only before it ships. A captured payment is refunded in full and the stock released |
| POST | `/orders/:id/returns` | `{type: "RETURN" or "REPLACEMENT", reason, details?}` — only after delivery, inside the return window |
| POST | `/orders/:id/reorder` | Puts the still-available items back in the cart; reports what was skipped and why |
| GET | `/orders/:id/invoice` | Invoice data: per-line taxable value, GST rate and GST amount, plus totals. Not yet available for cancelled or unpaid online orders |
| GET | `/notifications` | In-app notifications; `POST /notifications/read-all`, `PATCH /notifications/:id/read` |

Fulfilment status: `PLACED → PAYMENT_CONFIRMED → PROCESSING → PACKED → SHIPPED → OUT_FOR_DELIVERY → DELIVERED`, with the side exits
`CANCELLED` and `RETURN_REQUESTED → RETURNED`. A COD order stays `PLACED` until an admin confirms it. Payment status:
`PENDING`, `AUTHORIZED`, `CAPTURED`, `FAILED`, `PARTIALLY_REFUNDED`, `REFUNDED`.

## Admin (`ADMIN` role; every route)

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/admin/products` | List (`q`, `status`, `categoryId`) / create with images, variants and opening stock in one transaction |
| GET/PATCH/DELETE | `/admin/products/:id` | `DELETE` archives instead when the product is in any order |
| POST | `/admin/products/:id/variants` | Add variant (+ opening stock) |
| PATCH/DELETE | `/admin/variants/:id` | `DELETE` deactivates instead when ordered. Cannot remove the last active variant of a live product |
| POST | `/admin/products/:id/images` | Max 10; first becomes primary |
| PATCH/DELETE | `/admin/images/:id` | Primary handover is automatic; cannot delete the last image of a live product |
| GET | `/admin/inventory` | `q`, `lowStock=true` (available ≤ threshold) |
| POST | `/admin/inventory/:variantId/adjust` | `{mode:"delta"\|"set", quantity, reason}`; refuses to go below reserved units |
| GET | `/admin/inventory/:variantId/movements` | Stock ledger |
| GET/POST/PATCH/DELETE | `/admin/categories[/:id]` | Max two levels; delete blocked while products/children exist |
| GET/POST/PATCH/DELETE | `/admin/collections[/:id]` | |
| GET | `/admin/users` | `q`, `role`, `status` |
| PATCH | `/admin/users/:id` | `{role?, status?}` — cannot change yourself; cannot remove the last active admin; audited |
| GET | `/admin/audit-logs` | `entityType` filter |
| GET | `/admin/orders` | `q` (order no., email, name, phone), `status`, `paymentStatus`, `paymentMethod`, paging |
| GET | `/admin/orders/:id` | Full order + customer + payments + `nextStatuses` (the moves an admin may actually make) |
| PATCH | `/admin/orders/:id/status` | `{status, note?}`. Follows the state machine (forward, plus "shipped" again after a failed delivery attempt); online orders cannot be hand-marked paid; delivering a COD order marks it paid. Notifies the customer |
| POST | `/admin/orders/:id/cancel` | `{reason}` — releases stock; refunds a captured payment in full |
| POST | `/admin/orders/:id/refund` | `{amount?, reason, idempotencyKey?}` — partial or full; pending refunds count against the balance; the key makes retries safe |
| POST | `/admin/refunds/:id/retry` | Re-confirms a refund left `PENDING` by a provider timeout (adopts it if Razorpay already created it — never sends a second) |
| GET / PATCH | `/admin/returns[/:id]` | `{action: "approve", "reject" or "complete", adminNote?, refundAmount?, restock?}` |
| GET / POST / PATCH / DELETE | `/admin/coupons[/:id]` | `DELETE` switches the coupon off instead when orders used it. The code is immutable |
| GET | `/admin/settings` | `{shipping, payments, returns}` |
| PUT | `/admin/settings/:key` | `key` = `shipping` (`flatRate`, `freeThreshold`), `payments` (`codEnabled`, `codMaxOrder`, `reservationMinutes`) or `returns` (`returnWindowDays`, `replacementEnabled`). Strict: unknown keys → `400` |

### Status codes

`400` validation · `401` missing/invalid token · `403` wrong role or suspended · `404` · `409` conflict (duplicate SKU, in-use category, stock below reserved, last admin, cart exceeds stock, order no longer in that state) · `422` business rule (sale > MRP, publishing without images, stock < 0, invalid coupon, COD over the limit, refund above the remaining balance) · `429` rate limited · `503` not ready.
