-- Record WHY an order got its channel, and whether it is bespoke.
--
-- Additive only: both columns are nullable or defaulted, so existing rows stay
-- valid and nothing is rewritten. The live store showed that a garment can be
-- sold in a shop AND made to measure; DemandChannel holds one value, so the
-- losing half of that choice needs somewhere to live.

ALTER TABLE "shopify_orders" ADD COLUMN "channelBasis" TEXT;
ALTER TABLE "shopify_orders" ADD COLUMN "isCustomised" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "shopify_orders_organizationId_isCustomised_orderedAt_idx"
  ON "shopify_orders" ("organizationId", "isCustomised", "orderedAt");
