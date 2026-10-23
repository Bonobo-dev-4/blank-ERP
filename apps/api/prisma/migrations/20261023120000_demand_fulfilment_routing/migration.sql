-- An operator's decision to send a dispatchable line to production anyway.
--
-- Additive only: every column is nullable or defaulted, so existing rows stay
-- valid and nothing is rewritten. Routing reads this ahead of stock figures,
-- because someone holding the garment knows something the number does not.

ALTER TABLE "manufacturing_demand" ADD COLUMN "isRejectedForDispatch" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "manufacturing_demand" ADD COLUMN "rejectedReason" TEXT;
ALTER TABLE "manufacturing_demand" ADD COLUMN "rejectedByUserId" UUID;
ALTER TABLE "manufacturing_demand" ADD COLUMN "rejectedAt" TIMESTAMP(3);
ALTER TABLE "manufacturing_demand" ADD COLUMN "routedFacilityCode" TEXT;

CREATE INDEX "manufacturing_demands_org_rejected_idx"
  ON "manufacturing_demand" ("organizationId", "isRejectedForDispatch");
