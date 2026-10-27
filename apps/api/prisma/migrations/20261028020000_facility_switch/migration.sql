-- Unicommerce facility switch: durable operations, an append-only event
-- history, and a projection of each sale-order item's last-known facility.

-- CreateEnum
CREATE TYPE "FacilitySwitchStatus" AS ENUM ('CREATED', 'PREFLIGHT_CHECKING', 'READY', 'BLOCKED', 'EXECUTING', 'API_ACCEPTED', 'VERIFYING', 'VERIFIED_SUCCESS', 'VERIFIED_FAILURE', 'VERIFICATION_PENDING', 'RECONCILIATION_REQUIRED');

-- AlterTable
ALTER TABLE "shopify_orders" ADD COLUMN     "unicommerceSaleOrderCode" TEXT;

-- CreateTable
CREATE TABLE "facility_switch_operations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "shopifyOrderId" UUID NOT NULL,
    "shopifyOrderLineId" UUID,
    "saleOrderCode" TEXT NOT NULL,
    "saleOrderItemCode" TEXT NOT NULL,
    "sku" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "sourceFacilityCode" TEXT NOT NULL,
    "targetFacilityCode" TEXT NOT NULL,
    "operatorUserId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "FacilitySwitchStatus" NOT NULL DEFAULT 'CREATED',
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "preflightNonce" TEXT NOT NULL,
    "activeLockKey" TEXT,
    "preflightAt" TIMESTAMP(3) NOT NULL,
    "executionStartedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "apiRespondedAt" TIMESTAMP(3),
    "apiSuccessful" BOOLEAN,
    "apiMessage" TEXT,
    "apiErrors" JSONB,
    "apiWarnings" JSONB,
    "verificationCompletedAt" TIMESTAMP(3),
    "verifiedFacilityCode" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "manufacturingDemandId" UUID,
    "reconciliation" JSONB,
    "reconciledAt" TIMESTAMP(3),
    "reconciledByUserId" UUID,
    "reconciliationNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "facility_switch_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facility_switch_events" (
    "id" UUID NOT NULL,
    "operationId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "statusBefore" "FacilitySwitchStatus",
    "statusAfter" "FacilitySwitchStatus",
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" UUID,
    "integrationReference" TEXT,
    "errorCode" TEXT,
    "details" JSONB,

    CONSTRAINT "facility_switch_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unicommerce_order_items" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "saleOrderCode" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "shopifyOrderId" UUID,
    "shopifyOrderLineId" UUID,
    "sku" TEXT,
    "itemName" TEXT,
    "facilityCode" TEXT,
    "facilityName" TEXT,
    "statusCode" TEXT,
    "shippingPackageCode" TEXT,
    "shippingPackageStatus" TEXT,
    "onHold" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unicommerce_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "facility_switch_operations_preflightNonce_key" ON "facility_switch_operations"("preflightNonce");

-- CreateIndex
CREATE UNIQUE INDEX "facility_switch_operations_activeLockKey_key" ON "facility_switch_operations"("activeLockKey");

-- CreateIndex
CREATE INDEX "facility_switch_operations_organizationId_shopifyOrderId_cr_idx" ON "facility_switch_operations"("organizationId", "shopifyOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "facility_switch_operations_organizationId_status_idx" ON "facility_switch_operations"("organizationId", "status");

-- CreateIndex
CREATE INDEX "facility_switch_operations_operatorUserId_createdAt_idx" ON "facility_switch_operations"("operatorUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "facility_switch_operations_organizationId_idempotencyKey_key" ON "facility_switch_operations"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "facility_switch_events_operationId_at_idx" ON "facility_switch_events"("operationId", "at");

-- CreateIndex
CREATE INDEX "unicommerce_order_items_shopifyOrderLineId_idx" ON "unicommerce_order_items"("shopifyOrderLineId");

-- CreateIndex
CREATE INDEX "unicommerce_order_items_shopifyOrderId_idx" ON "unicommerce_order_items"("shopifyOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "unicommerce_order_items_organizationId_saleOrderCode_itemCo_key" ON "unicommerce_order_items"("organizationId", "saleOrderCode", "itemCode");

-- AddForeignKey
ALTER TABLE "facility_switch_operations" ADD CONSTRAINT "facility_switch_operations_shopifyOrderId_fkey" FOREIGN KEY ("shopifyOrderId") REFERENCES "shopify_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_switch_events" ADD CONSTRAINT "facility_switch_events_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "facility_switch_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- The history is evidence of what was sent to Unicommerce and what came back.
-- Nothing may rewrite it, whatever the application does.
CREATE FUNCTION facility_switch_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'facility_switch_events is append-only (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER facility_switch_events_no_update_delete
  BEFORE UPDATE OR DELETE ON "facility_switch_events"
  FOR EACH ROW EXECUTE FUNCTION facility_switch_events_append_only();

-- An operation may change state but never disappear.
CREATE FUNCTION facility_switch_operations_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'facility_switch_operations rows cannot be deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER facility_switch_operations_no_delete
  BEFORE DELETE ON "facility_switch_operations"
  FOR EACH ROW EXECUTE FUNCTION facility_switch_operations_no_delete();
