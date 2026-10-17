-- Denormalised effective price (sale price when set, otherwise MRP) so the catalogue can
-- filter and sort by price using one indexed column. Prisma cannot ORDER BY COALESCE().

ALTER TABLE "Product" ADD COLUMN "effectivePrice" INTEGER;

UPDATE "Product" SET "effectivePrice" = COALESCE("salePrice", "basePrice");

ALTER TABLE "Product" ALTER COLUMN "effectivePrice" SET NOT NULL;

-- The database, not just the service, guarantees the two columns can never drift apart.
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_effectivePrice_consistent"
  CHECK ("effectivePrice" = COALESCE("salePrice", "basePrice"));

CREATE INDEX "Product_status_effectivePrice_idx" ON "Product" ("status", "effectivePrice");
