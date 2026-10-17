-- SKUs are normalised to uppercase by the API; this index is the database-level backstop so
-- no code path (scripts, imports, future services) can create "abc-1" alongside "ABC-1".
CREATE UNIQUE INDEX "ProductVariant_sku_upper_key" ON "ProductVariant" (upper("sku"));
