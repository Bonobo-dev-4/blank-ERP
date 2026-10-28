-- CRM order priority and expected dispatch date, with an append-only history.
-- `requiredByDate` was never populated (0 of 2,491 orders, 28 Oct 2026); any
-- value it holds is carried into `expectedDispatchDate` before it is dropped.

-- CreateEnum
CREATE TYPE "OrderPriority" AS ENUM ('VIP', 'HIGH', 'MEDIUM', 'NORMAL');

-- CreateEnum
CREATE TYPE "DispatchDateSource" AS ENUM ('CRM_MANUAL', 'SHOPIFY_METAFIELD', 'SHOPIFY_CUSTOM_ATTRIBUTE', 'SHOPIFY_NOTE', 'UNASSIGNED');

-- AlterTable
ALTER TABLE "shopify_orders" ADD COLUMN     "crmRemarks" TEXT,
ADD COLUMN     "crmRemarksUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "crmRemarksUpdatedById" UUID,
ADD COLUMN     "dispatchDateChangeReason" TEXT,
ADD COLUMN     "dispatchDateLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dispatchDateOriginalValue" TEXT,
ADD COLUMN     "dispatchDateSource" "DispatchDateSource" NOT NULL DEFAULT 'UNASSIGNED',
ADD COLUMN     "dispatchDateUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "dispatchDateUpdatedById" UUID,
ADD COLUMN     "expectedDispatchDate" DATE,
ADD COLUMN     "orderPriority" "OrderPriority" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "priorityReason" TEXT,
ADD COLUMN     "prioritySource" TEXT NOT NULL DEFAULT 'DEFAULT',
ADD COLUMN     "priorityUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "priorityUpdatedById" UUID,
ADD COLUMN     "shopifyDispatchDate" DATE,
ADD COLUMN     "shopifyDispatchIssue" TEXT,
ADD COLUMN     "shopifyDispatchSource" "DispatchDateSource",
ADD COLUMN     "shopifyDispatchText" TEXT;

-- CreateTable
CREATE TABLE "order_crm_changes" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "shopifyOrderId" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT,
    "source" TEXT NOT NULL,
    "reason" TEXT,
    "changedById" UUID,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_crm_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_crm_changes_shopifyOrderId_changedAt_idx" ON "order_crm_changes"("shopifyOrderId", "changedAt");

-- CreateIndex
CREATE INDEX "order_crm_changes_organizationId_changedAt_idx" ON "order_crm_changes"("organizationId", "changedAt");

-- CreateIndex
CREATE INDEX "shopify_orders_organizationId_orderPriority_expectedDispatc_idx" ON "shopify_orders"("organizationId", "orderPriority", "expectedDispatchDate");

-- CreateIndex
CREATE INDEX "shopify_orders_organizationId_expectedDispatchDate_idx" ON "shopify_orders"("organizationId", "expectedDispatchDate");

-- AddForeignKey
ALTER TABLE "order_crm_changes" ADD CONSTRAINT "order_crm_changes_shopifyOrderId_fkey" FOREIGN KEY ("shopifyOrderId") REFERENCES "shopify_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Carry any existing required-by date across as an unlocked date of unknown
-- origin, then retire the column.
UPDATE "shopify_orders"
   SET "expectedDispatchDate" = ("requiredByDate" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date
 WHERE "requiredByDate" IS NOT NULL;
ALTER TABLE "shopify_orders" DROP COLUMN "requiredByDate";

-- The history is the record of what was promised to customers and who
-- changed it. Nothing may rewrite it.
CREATE FUNCTION order_crm_changes_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'order_crm_changes is append-only (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER order_crm_changes_no_update_delete
  BEFORE UPDATE OR DELETE ON "order_crm_changes"
  FOR EACH ROW EXECUTE FUNCTION order_crm_changes_append_only();

