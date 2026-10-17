-- Phase 4: delivery partners, delivery verification, support replies, reporting.

-- ── Delivery assignments ──
ALTER TABLE "DeliveryAssignment"
  ADD COLUMN "assignedById" UUID,
  ADD COLUMN "otpEpoch"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "otpExpiresAt" TIMESTAMP(3),
  ADD COLUMN "payoutAmount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "DeliveryAssignment"
  ADD CONSTRAINT "DeliveryAssignment_payoutAmount_nonneg" CHECK ("payoutAmount" >= 0),
  ADD CONSTRAINT "DeliveryAssignment_otpEpoch_nonneg" CHECK ("otpEpoch" >= 0);

-- ── Partner applications ──
ALTER TABLE "DeliveryPartner" ADD COLUMN "applicationNote" TEXT;

-- ── Support replies ──
ALTER TABLE "SupportRequest"
  ADD COLUMN "repliedById" UUID,
  ADD COLUMN "repliedAt"   TIMESTAMP(3);

-- ── Reports ──
-- Revenue reports bucket and filter on the moment an order was paid.
CREATE INDEX "Order_paidAt_idx" ON "Order" ("paidAt");
