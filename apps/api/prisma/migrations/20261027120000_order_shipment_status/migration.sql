-- What Unicommerce last reported for each imported order.
--
-- Unicommerce fulfils, so its status is the shipping truth; it is matched to
-- our orders by order number, the join both systems share. Additive only:
-- both columns nullable, no row rewritten.

ALTER TABLE "shopify_orders" ADD COLUMN "externalShipmentStatus" TEXT;
ALTER TABLE "shopify_orders" ADD COLUMN "externalStatusSyncedAt" TIMESTAMP(3);
