-- Phase 3: checkout, payments, refunds and returns.

-- ── Orders ──
ALTER TABLE "Order"
  ADD COLUMN "couponCode"   TEXT,
  ADD COLUMN "paidAt"       TIMESTAMP(3),
  ADD COLUMN "cancelReason" TEXT;

-- The payable amount is derived, never free-form: the database refuses an order whose
-- total does not equal subtotal - discount + shipping (prices are tax-inclusive).
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_grandTotal_consistent"
  CHECK ("grandTotal" = "subtotal" - "discountTotal" + "shippingTotal");

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_discount_not_above_subtotal" CHECK ("discountTotal" <= "subtotal");

-- The expiry sweeper only ever scans unpaid, reserved orders; keep that scan tiny.
CREATE INDEX "Order_unpaid_expiry_idx"
  ON "Order" ("stockExpiresAt")
  WHERE "paymentStatus" = 'PENDING' AND "stockExpiresAt" IS NOT NULL;

-- ── Payments ──
ALTER TABLE "Payment" ADD COLUMN "refundedAmount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_refundedAmount_range" CHECK ("refundedAmount" >= 0 AND "refundedAmount" <= "amount");

-- ── Refunds ──
ALTER TABLE "Refund"
  ADD COLUMN "source"         TEXT NOT NULL DEFAULT 'ADMIN',
  ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Refund_idempotencyKey_key" ON "Refund" ("idempotencyKey");

-- ── Returns ──
ALTER TABLE "ReturnRequest"
  ADD COLUMN "refundAmount"  INTEGER,
  ADD COLUMN "resolvedById"  UUID,
  ADD COLUMN "resolvedAt"    TIMESTAMP(3);

ALTER TABLE "ReturnRequest"
  ADD CONSTRAINT "ReturnRequest_refundAmount_nonneg" CHECK ("refundAmount" IS NULL OR "refundAmount" >= 0);
