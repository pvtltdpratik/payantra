# Payments, stock and refunds

How an order becomes paid in Payantra, what protects the money, and how to connect a real Razorpay account.

> **Verification status.** All of this logic is covered by automated tests (integration tests against a real Postgres engine and a
> browser suite that drives the real storefront) using a **stand-in for Razorpay's REST API**. It has **not yet been run against the
> live Razorpay sandbox**. Follow [Trying it against the Razorpay sandbox](#trying-it-against-the-razorpay-sandbox) before go-live —
> it is the one integration the stand-in cannot prove.

## The rules

1. **The server decides the amount.** The browser never sends a price. Checkout re-reads the cart, re-prices it and creates the Razorpay
   order for exactly that total.
2. **Stock is reserved before the customer pays**, inside the same database transaction that creates the order
   (`onHand`, `reserved`; *available = onHand − reserved*). Nobody can pay for something that is already gone.
3. **A payment is believed only after its signature checks out** — by `/payments/verify` (the browser's proof) or the webhook (Razorpay's
   proof). Both end in one idempotent function, so they can arrive in any order, twice, or not at all.
4. **Nothing is ever charged twice or lost.** Every step that could be repeated carries an idempotency key or a unique constraint, and
   every ambiguous provider failure is resolved by *asking Razorpay*, not by guessing.

## Life of an online order

```
POST /checkout            lock key → re-price → reserve stock → INSERT order(PLACED) → create Razorpay order
        │                                                        └── provider down? release stock, free the key, 502
        ▼
Razorpay Checkout (browser) ── paid ──► POST /payments/verify  ┐
        │                                                       ├─► settleCapturedPayment()  (idempotent, row-locked)
        └─ webhook payment.captured / order.paid ───────────────┘            │
                                                                             ▼
                                              PAYMENT_CONFIRMED · stock committed · notification · coupon use kept
```

| Situation | What happens |
|---|---|
| Customer closes the payment window | Order stays `PLACED`; stock stays reserved; "Try payment again" re-opens payment for the *same* order |
| Bank declines | Same as above; the failed attempt is recorded |
| Customer never returns | The sweeper (`ORDER_EXPIRY_SWEEP_SECONDS`, default 60) finds orders past `reservationMinutes`, **asks Razorpay** whether any payment landed, and only if none did cancels the order and releases the stock |
| Razorpay can't be reached by the sweeper | The order is **left alone** and retried next sweep — an outage never cancels a paid order |
| Webhook arrives before `/verify` (or twice) | The second application sees `ALREADY_PAID` and does nothing |
| Money arrives *after* the order expired | If the stock is still free the order is **revived** and confirmed; if not, the payment is **refunded automatically** and the customer is told |
| Two different payments for one order | The first wins; the duplicate is refunded |
| Captured amount ≠ order total | Rejected and logged; never marked paid |

## Webhook

- **URL:** `https://<your-api-host>/api/v1/webhooks/razorpay`
- **Signature:** `x-razorpay-signature` = HMAC-SHA256 of the **raw request body** with `RAZORPAY_WEBHOOK_SECRET`, compared in constant time.
  The route is mounted *before* `express.json()` for exactly this reason — re-serialised JSON would not reproduce Razorpay's bytes.
- **Idempotency:** each delivery's `x-razorpay-event-id` is written to a ledger (`WebhookEvent`); a repeat is acknowledged and ignored.
- **Retries:** a *transient* failure (database down, provider timeout) answers `5xx` so Razorpay retries; a *permanent* one (unknown order,
  bad payload) answers `200` so it does not retry forever. A bad signature answers `400`.
- **Events handled:** `payment.captured`, `payment.authorized`, `order.paid`, `payment.failed`, `refund.processed`, `refund.failed`.
  Everything else is acknowledged and ignored.

## Refunds

- Created by: customer cancellation of a paid order (full), an admin from the order page (full or partial), a completed return, a late
  payment that cannot be honoured, or a duplicate payment.
- A refund is **recorded before** Razorpay is called, with an `idempotencyKey`. Refunds still `PENDING` count against the refundable
  balance, so two admins cannot together refund more than was paid.
- If Razorpay times out *after* creating the refund, the next attempt **lists the payment's refunds and adopts the existing one**
  instead of sending another. An admin can press **Retry** on a pending refund at any time.
- `refund.processed` / `refund.failed` webhooks settle the final state. COD orders are refunded outside the system (the admin UI says so).

## Trying it against the Razorpay sandbox

1. Create a Razorpay account and stay in **Test Mode**. *Account & Settings → API Keys → Generate Test Key*.
2. Put the keys in the two env files (the secret only on the server):

   ```ini
   # server/.env
   RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
   RAZORPAY_KEY_SECRET=...
   RAZORPAY_WEBHOOK_SECRET=choose-a-long-random-string
   # client/.env.local
   NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
   ```

   `NEXT_PUBLIC_*` values are inlined **at build time** — rebuild the client after changing them.
3. Expose your API to the internet while testing (e.g. `ngrok http 4000`) and add a webhook in *Account & Settings → Webhooks*:
   URL `https://<tunnel>/api/v1/webhooks/razorpay`, the **same secret** as `RAZORPAY_WEBHOOK_SECRET`, and the events
   `payment.captured`, `payment.authorized`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`.
4. Walk this checklist with Razorpay's [test cards / UPI ids](https://razorpay.com/docs/payments/payments/test-card-details/):

   | Do | Expect |
   |---|---|
   | Pay successfully | Order page: "Paid"; the webhook shows `200` in Razorpay's dashboard |
   | Close the window, then "Try payment again" | Same order number; one order only |
   | Use a failing test card | "Payment not completed"; stock still held; retry works |
   | Cancel a paid order | Refund appears in the dashboard and flips to "Refunded" when `refund.processed` arrives |
   | Partial refund from the admin order page | Order shows "Partly refunded"; the remaining balance is correct |
   | Wait past the reservation window without paying | Order cancelled, stock back on the shelf |

5. **Before go-live:** switch to live keys, re-create the webhook with the live secret, and set `NODE_ENV=production`
   (the mock hooks and the seed script refuse to run there).

## Configuration reference

| Variable | Where | Default | Meaning |
|---|---|---|---|
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | server | — | API credentials (HTTP Basic) |
| `RAZORPAY_WEBHOOK_SECRET` | server | — | Webhook HMAC secret |
| `RAZORPAY_API_BASE` | server | `https://api.razorpay.com/v1` | Override only for the test stand-in |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | client (build time) | — | Publishable key shown to Checkout |
| `ORDER_EXPIRY_SWEEP_SECONDS` | server | `60` | How often unpaid orders are checked (`0` disables the sweeper) |
| Admin → Settings → Payments | database | 15 min, COD off, ₹5,000 | Reservation window, Cash on Delivery, COD limit |
