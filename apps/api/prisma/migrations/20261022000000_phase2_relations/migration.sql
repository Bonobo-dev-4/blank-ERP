-- Phase 2 groundwork.
--
-- ADDITIVE ONLY. No column is dropped, no column changes type, and no row is
-- touched. The two foreign keys close referential-integrity gaps that phase 1
-- left open: both columns already carried an index, but nothing stopped a
-- manufacturing order naming a style or a SKU that does not exist.

-- 1. New audit verbs for the phase 2 operations.
--    Postgres allows ADD VALUE on an enum only outside a transaction block in
--    older versions; 16 permits it inside, and IF NOT EXISTS makes a re-run safe.
ALTER TYPE "public"."AuditAction" ADD VALUE IF NOT EXISTS 'SUBMIT';
ALTER TYPE "public"."AuditAction" ADD VALUE IF NOT EXISTS 'RESERVE';
ALTER TYPE "public"."AuditAction" ADD VALUE IF NOT EXISTS 'HOLD';
ALTER TYPE "public"."AuditAction" ADD VALUE IF NOT EXISTS 'RESUME';
ALTER TYPE "public"."AuditAction" ADD VALUE IF NOT EXISTS 'RUN';

-- 2. A manufacturing order must name a style that exists.
--    RESTRICT, not CASCADE: deleting a style that has been manufactured would
--    erase the production history of garments that physically exist.
ALTER TABLE "public"."manufacturing_orders"
  ADD CONSTRAINT "manufacturing_orders_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "public"."products"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. An order line must name a SKU that exists.
--    Without this a size breakdown could survive the deletion of the SKU it
--    breaks down, and the cutting table would be told to cut nothing.
ALTER TABLE "public"."manufacturing_order_items"
  ADD CONSTRAINT "manufacturing_order_items_productVariantId_fkey"
  FOREIGN KEY ("productVariantId") REFERENCES "public"."product_variants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
