-- Integrity constraints Prisma's schema language cannot express.
-- These are the last line of defence: even a buggy service cannot corrupt stock or money.

-- ── Inventory: never negative, never reserve more than is on hand ──
ALTER TABLE "Inventory"
  ADD CONSTRAINT "Inventory_onHand_nonneg"   CHECK ("onHand" >= 0),
  ADD CONSTRAINT "Inventory_reserved_nonneg" CHECK ("reserved" >= 0),
  ADD CONSTRAINT "Inventory_reserved_lte_onHand" CHECK ("reserved" <= "onHand");

-- ── Quantities ──
ALTER TABLE "CartItem"
  ADD CONSTRAINT "CartItem_quantity_range" CHECK ("quantity" BETWEEN 1 AND 20);

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "OrderItem_unitPrice_nonneg"  CHECK ("unitPrice" >= 0),
  ADD CONSTRAINT "OrderItem_lineTotal_nonneg"  CHECK ("lineTotal" >= 0);

-- ── Money (integer paise) ──
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_basePrice_nonneg" CHECK ("basePrice" >= 0),
  ADD CONSTRAINT "Product_salePrice_valid"
    CHECK ("salePrice" IS NULL OR ("salePrice" >= 0 AND "salePrice" <= "basePrice")),
  ADD CONSTRAINT "Product_taxRate_range" CHECK ("taxRatePercent" >= 0 AND "taxRatePercent" <= 100);

ALTER TABLE "ProductVariant"
  ADD CONSTRAINT "ProductVariant_priceOverride_nonneg"
    CHECK ("priceOverride" IS NULL OR "priceOverride" >= 0);

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_amounts_nonneg" CHECK (
    "subtotal" >= 0 AND "discountTotal" >= 0 AND "taxTotal" >= 0
    AND "shippingTotal" >= 0 AND "grandTotal" >= 0
  );

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "DeliveryPartner"
  ADD CONSTRAINT "DeliveryPartner_payout_nonneg" CHECK ("perDeliveryPayout" >= 0);

-- ── Coupons ──
ALTER TABLE "Coupon"
  ADD CONSTRAINT "Coupon_value_positive" CHECK ("discountValue" > 0),
  ADD CONSTRAINT "Coupon_percentage_max" CHECK ("discountType" <> 'PERCENTAGE' OR "discountValue" <= 100),
  ADD CONSTRAINT "Coupon_window_valid"   CHECK ("endsAt" > "startsAt"),
  ADD CONSTRAINT "Coupon_usage_within_limit"
    CHECK ("usageLimit" IS NULL OR "usedCount" <= "usageLimit");

-- ── Reviews ──
ALTER TABLE "Review"
  ADD CONSTRAINT "Review_rating_range" CHECK ("rating" BETWEEN 1 AND 5);

-- ── Delivery ──
ALTER TABLE "DeliveryAssignment"
  ADD CONSTRAINT "DeliveryAssignment_otpAttempts_nonneg" CHECK ("otpAttempts" >= 0);

-- ── At most one default address per user ──
CREATE UNIQUE INDEX "Address_one_default_per_user"
  ON "Address" ("userId")
  WHERE "isDefault" = true;

-- ── Case-insensitive uniqueness for emails and coupon codes ──
CREATE UNIQUE INDEX "Profile_email_lower_key" ON "Profile" (lower("email"));
CREATE UNIQUE INDEX "Coupon_code_upper_key"   ON "Coupon"  (upper("code"));
