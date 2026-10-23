-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."UomCode" AS ENUM ('METER', 'YARD', 'PIECE', 'KILOGRAM', 'GRAM', 'ROLL', 'PACKET', 'SET');

-- CreateEnum
CREATE TYPE "public"."MaterialCategory" AS ENUM ('FABRIC', 'LINING', 'BUTTON', 'ZIPPER', 'THREAD', 'LACE', 'LABEL', 'TAG', 'EMBROIDERY_MATERIAL', 'PACKAGING', 'ACCESSORY', 'TRIM', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."RecordStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "public"."ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "public"."ProductionType" AS ENUM ('IN_HOUSE', 'JOB_WORK', 'HYBRID', 'OUTSOURCED');

-- CreateEnum
CREATE TYPE "public"."LocationKind" AS ENUM ('PHYSICAL', 'PRODUCTION_FLOOR', 'JOB_WORKER', 'QUALITY_HOLD', 'BLOCKED', 'IN_TRANSIT', 'SINK', 'COUNTERPARTY');

-- CreateEnum
CREATE TYPE "public"."MovementType" AS ENUM ('OPENING_BALANCE', 'PURCHASE_INWARD', 'QC_RELEASE', 'QC_REJECT', 'SUPPLIER_RETURN', 'ISSUE_TO_PRODUCTION', 'RETURN_FROM_PRODUCTION', 'TRANSFER', 'ISSUE_TO_JOB_WORKER', 'RETURN_FROM_JOB_WORKER', 'CONSUMPTION', 'WASTAGE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'STOCK_COUNT_GAIN', 'STOCK_COUNT_LOSS');

-- CreateEnum
CREATE TYPE "public"."ReservationStatus" AS ENUM ('ACTIVE', 'PARTIALLY_CONSUMED', 'CONSUMED', 'RELEASED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."PurchaseRequisitionStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CONVERTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."PurchaseOrderStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."ReceiptStatus" AS ENUM ('DRAFT', 'PENDING_INSPECTION', 'INSPECTED', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."InspectionResult" AS ENUM ('PASS', 'FAIL', 'REWORK', 'HOLD');

-- CreateEnum
CREATE TYPE "public"."BomStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SUPERSEDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "public"."WastageBasis" AS ENUM ('PERCENT_OF_CONSUMPTION', 'FIXED_PER_UNIT', 'FIXED_PER_ORDER', 'NONE');

-- CreateEnum
CREATE TYPE "public"."MrpRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."SourceSystem" AS ENUM ('MANUAL', 'SHOPIFY', 'UNICOMMERCE');

-- CreateEnum
CREATE TYPE "public"."DemandChannel" AS ENUM ('ONLINE', 'POS', 'CUSTOM', 'BULK_PO', 'REPLENISHMENT', 'MANUAL');

-- CreateEnum
CREATE TYPE "public"."DemandStatus" AS ENUM ('NEW', 'NEEDS_MAPPING', 'PENDING_REVIEW', 'APPROVED_FOR_PRODUCTION', 'PARTIALLY_ALLOCATED', 'FULLY_ALLOCATED', 'NOT_REQUIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."ManufacturingOrderStatus" AS ENUM ('DRAFT', 'PENDING_MATERIAL', 'MATERIAL_RESERVED', 'RELEASED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."Priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "public"."TrackingMode" AS ENUM ('BATCH', 'UNIT');

-- CreateEnum
CREATE TYPE "public"."StageTaskStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "public"."ProductionUnitStatus" AS ENUM ('CREATED', 'IN_PROGRESS', 'REWORK', 'REJECTED', 'QC_PASSED', 'INWARDED');

-- CreateEnum
CREATE TYPE "public"."StageMovementType" AS ENUM ('RELEASE_TO_FIRST_STAGE', 'FORWARD', 'COMPLETE', 'REJECT', 'SEND_TO_REWORK', 'RETURN_FROM_REWORK', 'CANCEL_RELEASE');

-- CreateEnum
CREATE TYPE "public"."BarcodeKind" AS ENUM ('MATERIAL_LOT', 'FABRIC_ROLL', 'PRODUCTION_BATCH', 'PRODUCTION_UNIT', 'GOODS_RECEIPT', 'FG_CARTON');

-- CreateEnum
CREATE TYPE "public"."ScanEventType" AS ENUM ('STAGE_RECEIVE', 'STAGE_COMPLETE', 'STAGE_REJECT', 'REWORK_SEND', 'REWORK_RETURN', 'QC_SCAN', 'FG_INWARD_SCAN', 'MATERIAL_RECEIPT_SCAN', 'FABRIC_ROLL_ISSUE_SCAN', 'FABRIC_ROLL_RETURN_SCAN', 'LOOKUP');

-- CreateEnum
CREATE TYPE "public"."ScanEventStatus" AS ENUM ('ACCEPTED', 'REJECTED_VALIDATION', 'DUPLICATE_IGNORED');

-- CreateEnum
CREATE TYPE "public"."JobWorkerKind" AS ENUM ('INTERNAL_DEPARTMENT', 'EXTERNAL_VENDOR', 'INDIVIDUAL_CONTRACTOR');

-- CreateEnum
CREATE TYPE "public"."JobWorkOrderStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."QcKind" AS ENUM ('INLINE_STAGE', 'FINAL', 'REINSPECTION');

-- CreateEnum
CREATE TYPE "public"."DefectCategory" AS ENUM ('STITCHING', 'EMBROIDERY', 'FABRIC', 'COLOR_VARIATION', 'MEASUREMENT', 'FINISHING', 'DAMAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."ReworkOrderStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'SCRAPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."FinishedGoodsMovementType" AS ENUM ('INWARD', 'TRANSFER', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'EXTERNAL_SYNC_OUT');

-- CreateEnum
CREATE TYPE "public"."SyncStatus" AS ENUM ('NOT_REQUIRED', 'SYNC_PENDING', 'SYNC_QUEUED', 'SYNC_PROCESSING', 'SYNC_SUCCESS', 'SYNC_FAILED', 'RECONCILIATION_REQUIRED', 'RECONCILED');

-- CreateEnum
CREATE TYPE "public"."PushJobStatus" AS ENUM ('DRAFT', 'READY', 'PENDING', 'PROCESSING', 'SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'RECONCILIATION_REQUIRED', 'RECONCILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."PushOperationKind" AS ENUM ('GRN_AGAINST_PURCHASE_ORDER', 'INVENTORY_ADJUSTMENT', 'INVENTORY_OVERRIDE');

-- CreateEnum
CREATE TYPE "public"."IntegrationProvider" AS ENUM ('SHOPIFY', 'UNICOMMERCE');

-- CreateEnum
CREATE TYPE "public"."IntegrationEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'IGNORED_DUPLICATE', 'FAILED', 'DEAD_LETTERED');

-- CreateEnum
CREATE TYPE "public"."IdempotencyStatus" AS ENUM ('IN_FLIGHT', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'CANCEL', 'POST', 'RELEASE', 'SCAN', 'PUSH', 'LOGIN', 'LOGIN_FAILED');

-- CreateEnum
CREATE TYPE "public"."FabricRollStatus" AS ENUM ('RECEIVED', 'QC_PENDING', 'AVAILABLE', 'PARTIALLY_ISSUED', 'ISSUED', 'EXHAUSTED', 'BLOCKED', 'RETURNED_TO_SUPPLIER');

-- CreateEnum
CREATE TYPE "public"."InventoryAvailabilityStatus" AS ENUM ('PENDING_CHECK', 'AVAILABLE', 'PARTIALLY_AVAILABLE', 'OUT_OF_STOCK', 'ALLOCATION_PENDING', 'ALLOCATION_CONFIRMED', 'INVENTORY_CHECK_FAILED');

-- CreateEnum
CREATE TYPE "public"."ExternalOrderStatus" AS ENUM ('OPEN', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED', 'CLOSED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "public"."ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "public"."NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "public"."NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SUPPRESSED_DUPLICATE', 'READ');

-- CreateEnum
CREATE TYPE "public"."ForecastMethod" AS ENUM ('MOVING_AVERAGE', 'WEIGHTED_VELOCITY', 'SEASONAL_INDEX', 'MANUAL_OVERRIDE');

-- CreateEnum
CREATE TYPE "public"."BundleComponentRole" AS ENUM ('PRIMARY', 'COMPONENT', 'ACCESSORY');

-- CreateTable
CREATE TABLE "public"."organizations" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "public"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "employeeCode" TEXT,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "pinHash" TEXT,
    "status" "public"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."roles" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."permissions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "elevated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."role_permissions" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "public"."user_roles" (
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "public"."audit_logs" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "actorUserId" UUID,
    "actorLabel" TEXT,
    "action" "public"."AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "diff" JSONB,
    "context" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."idempotency_records" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" "public"."IdempotencyStatus" NOT NULL DEFAULT 'IN_FLIGHT',
    "responseBody" JSONB,
    "entityType" TEXT,
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."number_sequences" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "padding" INTEGER NOT NULL DEFAULT 6,
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."products" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "styleCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "collection" TEXT,
    "category" TEXT,
    "sizeSet" TEXT,
    "fabricDescription" TEXT,
    "productionType" "public"."ProductionType" NOT NULL DEFAULT 'IN_HOUSE',
    "standardManufacturingDays" INTEGER,
    "defaultRouteId" UUID,
    "status" "public"."ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "imageUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."product_variants" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT,
    "color" TEXT,
    "size" TEXT,
    "sizeSortOrder" INTEGER NOT NULL DEFAULT 0,
    "fabric" TEXT,
    "imageUrl" TEXT,
    "sizeSet" TEXT,
    "isBundle" BOOLEAN NOT NULL DEFAULT false,
    "status" "public"."ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "activeBomVersionId" UUID,
    "mrpUnitWeight" DECIMAL(18,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."external_product_mappings" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "productVariantId" UUID NOT NULL,
    "provider" "public"."IntegrationProvider" NOT NULL,
    "identifierKind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalSku" TEXT,
    "rawPayload" JSONB,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_product_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."product_sync_issues" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "provider" "public"."IntegrationProvider" NOT NULL,
    "issueType" TEXT NOT NULL,
    "externalSku" TEXT,
    "externalId" TEXT,
    "productVariantId" UUID,
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_sync_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."uom_conversions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "rawMaterialId" UUID,
    "fromUom" "public"."UomCode" NOT NULL,
    "toUom" "public"."UomCode" NOT NULL,
    "factor" DECIMAL(18,8) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uom_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."raw_materials" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "materialCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "public"."MaterialCategory" NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "colorCode" TEXT,
    "fabricComposition" TEXT,
    "width" DECIMAL(10,2),
    "widthUom" TEXT,
    "gsm" INTEGER,
    "baseUom" "public"."UomCode" NOT NULL,
    "purchaseUom" "public"."UomCode",
    "defaultSupplierId" UUID,
    "purchaseRate" DECIMAL(18,6),
    "averageCost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "minimumStock" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reorderLevel" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reorderQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 0,
    "defaultLocationId" UUID,
    "lotTracked" BOOLEAN NOT NULL DEFAULT true,
    "shadeTracked" BOOLEAN NOT NULL DEFAULT false,
    "status" "public"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "raw_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."material_lots" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "rawMaterialId" UUID NOT NULL,
    "lotCode" TEXT NOT NULL,
    "supplierLotRef" TEXT,
    "shade" TEXT,
    "width" DECIMAL(10,2),
    "gsm" INTEGER,
    "unitCost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3),
    "expiryAt" TIMESTAMP(3),
    "supplierId" UUID,
    "receiptLineId" UUID,
    "isGeneral" BOOLEAN NOT NULL DEFAULT false,
    "status" "public"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."material_locations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "public"."LocationKind" NOT NULL,
    "storageLevel" TEXT,
    "parentId" UUID,
    "jobWorkerId" UUID,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "blocksIssue" BOOLEAN NOT NULL DEFAULT false,
    "status" "public"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."material_balances" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "rawMaterialId" UUID NOT NULL,
    "materialLotId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "onHandQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reservedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."material_movements" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "movementNo" TEXT NOT NULL,
    "movementType" "public"."MovementType" NOT NULL,
    "rawMaterialId" UUID NOT NULL,
    "materialLotId" UUID NOT NULL,
    "fabricRollId" UUID,
    "sourceLocationId" UUID NOT NULL,
    "destinationLocationId" UUID NOT NULL,
    "enteredQty" DECIMAL(18,4) NOT NULL,
    "enteredUom" "public"."UomCode" NOT NULL,
    "baseQty" DECIMAL(18,4) NOT NULL,
    "baseUom" "public"."UomCode" NOT NULL,
    "unitCost" DECIMAL(18,6),
    "totalCost" DECIMAL(18,2),
    "referenceType" TEXT,
    "referenceId" UUID,
    "referenceLineId" UUID,
    "referenceNo" TEXT,
    "reason" TEXT,
    "remarks" TEXT,
    "operatorUserId" UUID,
    "reversalOfId" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."material_reservations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "rawMaterialId" UUID NOT NULL,
    "materialLotId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "manufacturingOrderId" UUID NOT NULL,
    "materialRequirementId" UUID,
    "reservedQty" DECIMAL(18,4) NOT NULL,
    "issuedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "releasedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "public"."ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "reservedByUserId" UUID,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."stock_counts" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "countNo" TEXT NOT NULL,
    "locationId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "countedAt" TIMESTAMP(3),
    "countedByUserId" UUID,
    "postedAt" TIMESTAMP(3),
    "postedByUserId" UUID,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."stock_count_lines" (
    "id" UUID NOT NULL,
    "stockCountId" UUID NOT NULL,
    "rawMaterialId" UUID NOT NULL,
    "materialLotId" UUID NOT NULL,
    "systemQty" DECIMAL(18,4) NOT NULL,
    "countedQty" DECIMAL(18,4) NOT NULL,
    "varianceQty" DECIMAL(18,4) NOT NULL,
    "reason" TEXT,
    "movementId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."suppliers" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "supplierCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "gstin" TEXT,
    "paymentTerms" TEXT,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 0,
    "rating" INTEGER,
    "status" "public"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."purchase_requisitions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "requisitionNo" TEXT NOT NULL,
    "status" "public"."PurchaseRequisitionStatus" NOT NULL DEFAULT 'DRAFT',
    "requiredByDate" TIMESTAMP(3),
    "mrpRunId" UUID,
    "raisedByUserId" UUID,
    "approvedByUserId" UUID,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_requisitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."purchase_requisition_items" (
    "id" UUID NOT NULL,
    "purchaseRequisitionId" UUID NOT NULL,
    "rawMaterialId" UUID NOT NULL,
    "requestedQty" DECIMAL(18,4) NOT NULL,
    "uom" "public"."UomCode" NOT NULL,
    "approvedQty" DECIMAL(18,4),
    "orderedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "suggestedSupplierId" UUID,
    "estimatedRate" DECIMAL(18,6),
    "materialRequirementId" UUID,
    "remarks" TEXT,

    CONSTRAINT "purchase_requisition_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."raw_material_purchase_orders" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "poNo" TEXT NOT NULL,
    "supplierId" UUID NOT NULL,
    "status" "public"."PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedDate" TIMESTAMP(3),
    "deliverToLocationId" UUID,
    "overReceiptTolerancePct" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "underReceiptTolerancePct" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "subtotalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "freightAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "paymentTerms" TEXT,
    "raisedByUserId" UUID,
    "approvedByUserId" UUID,
    "approvedAt" TIMESTAMP(3),
    "closedByUserId" UUID,
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "cancelReason" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "raw_material_purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."raw_material_purchase_items" (
    "id" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "rawMaterialId" UUID NOT NULL,
    "orderedQty" DECIMAL(18,4) NOT NULL,
    "uom" "public"."UomCode" NOT NULL,
    "orderedBaseQty" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "discountPct" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "taxPct" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "lineAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "receivedBaseQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "acceptedBaseQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rejectedBaseQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "expectedDate" TIMESTAMP(3),
    "requisitionItemId" UUID,
    "remarks" TEXT,

    CONSTRAINT "raw_material_purchase_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."raw_material_receipts" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "grnNo" TEXT NOT NULL,
    "purchaseOrderId" UUID,
    "supplierId" UUID NOT NULL,
    "status" "public"."ReceiptStatus" NOT NULL DEFAULT 'DRAFT',
    "receiptDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supplierInvoiceNo" TEXT,
    "supplierDcNo" TEXT,
    "vehicleNo" TEXT,
    "targetLocationId" UUID NOT NULL,
    "receivedByUserId" UUID,
    "inspectedByUserId" UUID,
    "inspectedAt" TIMESTAMP(3),
    "postedByUserId" UUID,
    "postedAt" TIMESTAMP(3),
    "freightAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "raw_material_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."raw_material_receipt_lines" (
    "id" UUID NOT NULL,
    "receiptId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "purchaseItemId" UUID,
    "rawMaterialId" UUID NOT NULL,
    "receivedQty" DECIMAL(18,4) NOT NULL,
    "uom" "public"."UomCode" NOT NULL,
    "receivedBaseQty" DECIMAL(18,4) NOT NULL,
    "acceptedBaseQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rejectedBaseQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "inspectionResult" "public"."InspectionResult",
    "rejectionReason" TEXT,
    "rate" DECIMAL(18,6),
    "landedUnitCost" DECIMAL(18,6),
    "supplierLotRef" TEXT,
    "shade" TEXT,
    "width" DECIMAL(10,2),
    "gsm" INTEGER,
    "remarks" TEXT,

    CONSTRAINT "raw_material_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."boms" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bomCode" TEXT NOT NULL,
    "name" TEXT,
    "productId" UUID NOT NULL,
    "productVariantId" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."bom_versions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bomId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "public"."BomStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "baseQuantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "plannedUnitCost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "createdByUserId" UUID,
    "approvedByUserId" UUID,
    "approvedAt" TIMESTAMP(3),
    "supersededById" UUID,
    "changeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bom_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."bom_items" (
    "id" UUID NOT NULL,
    "bomVersionId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "rawMaterialId" UUID NOT NULL,
    "consumptionQty" DECIMAL(18,4) NOT NULL,
    "uom" "public"."UomCode" NOT NULL,
    "wastageBasis" "public"."WastageBasis" NOT NULL DEFAULT 'PERCENT_OF_CONSUMPTION',
    "wastageValue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "productionStageId" UUID,
    "unitCost" DECIMAL(18,6),
    "grossQtyPerUnit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineCost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "isCritical" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,

    CONSTRAINT "bom_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."bom_item_alternatives" (
    "id" UUID NOT NULL,
    "bomItemId" UUID NOT NULL,
    "rawMaterialId" UUID NOT NULL,
    "preferenceOrder" INTEGER NOT NULL DEFAULT 1,
    "conversionFactor" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "notes" TEXT,

    CONSTRAINT "bom_item_alternatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."bom_item_size_overrides" (
    "id" UUID NOT NULL,
    "bomItemId" UUID NOT NULL,
    "size" TEXT NOT NULL,
    "consumptionQty" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "bom_item_size_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."mrp_runs" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "runNo" TEXT NOT NULL,
    "status" "public"."MrpRunStatus" NOT NULL DEFAULT 'QUEUED',
    "scope" JSONB NOT NULL DEFAULT '{}',
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "totalShortageValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "shortageLineCount" INTEGER NOT NULL DEFAULT 0,
    "runByUserId" UUID,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mrp_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."material_requirements" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "mrpRunId" UUID,
    "manufacturingOrderId" UUID,
    "manufacturingOrderItemId" UUID,
    "bomVersionId" UUID,
    "rawMaterialId" UUID NOT NULL,
    "productionStageId" UUID,
    "netRequiredQty" DECIMAL(18,4) NOT NULL,
    "wastageQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grossRequiredQty" DECIMAL(18,4) NOT NULL,
    "uom" "public"."UomCode" NOT NULL,
    "availableQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reservedElsewhereQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "openPurchaseQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "expectedArrivalDate" TIMESTAMP(3),
    "shortageQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reservedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "estimatedUnitCost" DECIMAL(18,6),
    "estimatedCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."manufacturing_demand" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "demandNo" TEXT NOT NULL,
    "channel" "public"."DemandChannel" NOT NULL,
    "productVariantId" UUID,
    "externalSku" TEXT,
    "requestedQty" DECIMAL(18,4) NOT NULL,
    "manufacturingQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "allocatedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "cancelledQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "public"."DemandStatus" NOT NULL DEFAULT 'NEW',
    "priority" "public"."Priority" NOT NULL DEFAULT 'NORMAL',
    "requiredByDate" TIMESTAMP(3),
    "destinationFacilityId" UUID,
    "dedupeFingerprint" TEXT NOT NULL,
    "decisionReason" TEXT,
    "approvedByUserId" UUID,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "customization" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturing_demand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."demand_source_mappings" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "manufacturingDemandId" UUID NOT NULL,
    "sourceSystem" "public"."SourceSystem" NOT NULL,
    "sourceDocType" TEXT NOT NULL,
    "sourceDocId" TEXT NOT NULL,
    "sourceDocNo" TEXT,
    "sourceLineId" TEXT NOT NULL,
    "sourceLineQty" DECIMAL(18,4) NOT NULL,
    "sourceStatus" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "rawPayload" JSONB,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demand_source_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."demand_allocations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "manufacturingDemandId" UUID NOT NULL,
    "manufacturingOrderId" UUID NOT NULL,
    "manufacturingOrderItemId" UUID,
    "allocatedQty" DECIMAL(18,4) NOT NULL,
    "fulfilledQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "demand_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."manufacturing_orders" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "moNo" TEXT NOT NULL,
    "status" "public"."ManufacturingOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" "public"."Priority" NOT NULL DEFAULT 'NORMAL',
    "productionType" "public"."ProductionType" NOT NULL DEFAULT 'IN_HOUSE',
    "productId" UUID NOT NULL,
    "productVariantId" UUID,
    "primarySourceSystem" "public"."SourceSystem" NOT NULL DEFAULT 'MANUAL',
    "primarySourceDocNo" TEXT,
    "orderedQty" DECIMAL(18,4) NOT NULL,
    "releasedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "completedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rejectedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "inwardedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "cancelledQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "bomVersionId" UUID,
    "routeId" UUID,
    "plannedStartDate" TIMESTAMP(3),
    "plannedEndDate" TIMESTAMP(3),
    "actualStartDate" TIMESTAMP(3),
    "actualEndDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "destinationFacilityId" UUID,
    "manufacturingLocationId" UUID,
    "supervisorUserId" UUID,
    "plannedMaterialCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "plannedConversionCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "plannedTotalCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "actualMaterialCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "actualConversionCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "actualTotalCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "shortageOverrideByUserId" UUID,
    "shortageOverrideReason" TEXT,
    "releasedByUserId" UUID,
    "releasedAt" TIMESTAMP(3),
    "closedByUserId" UUID,
    "closedAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "parentMoId" UUID,
    "remarks" TEXT,
    "idempotencyKey" TEXT,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturing_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."manufacturing_order_items" (
    "id" UUID NOT NULL,
    "manufacturingOrderId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productVariantId" UUID NOT NULL,
    "size" TEXT,
    "color" TEXT,
    "orderedQty" DECIMAL(18,4) NOT NULL,
    "releasedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "completedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rejectedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "inwardedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "cancelledQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "bomVersionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturing_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."mo_bom_snapshot_lines" (
    "id" UUID NOT NULL,
    "manufacturingOrderId" UUID NOT NULL,
    "bomVersionId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "rawMaterialId" UUID NOT NULL,
    "materialCode" TEXT NOT NULL,
    "materialName" TEXT NOT NULL,
    "consumptionQtyPerUnit" DECIMAL(18,4) NOT NULL,
    "wastageQtyPerUnit" DECIMAL(18,4) NOT NULL,
    "grossQtyPerUnit" DECIMAL(18,4) NOT NULL,
    "uom" "public"."UomCode" NOT NULL,
    "unitCost" DECIMAL(18,6) NOT NULL,
    "plannedQty" DECIMAL(18,4) NOT NULL,
    "plannedCost" DECIMAL(18,2) NOT NULL,
    "productionStageCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mo_bom_snapshot_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."production_stages" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequenceHint" INTEGER NOT NULL DEFAULT 0,
    "defaultLocationId" UUID,
    "consumesMaterial" BOOLEAN NOT NULL DEFAULT false,
    "allowsJobWork" BOOLEAN NOT NULL DEFAULT false,
    "requiresQc" BOOLEAN NOT NULL DEFAULT false,
    "serialisesUnits" BOOLEAN NOT NULL DEFAULT false,
    "isTerminal" BOOLEAN NOT NULL DEFAULT false,
    "status" "public"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."production_routes" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" "public"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."production_route_steps" (
    "id" UUID NOT NULL,
    "routeId" UUID NOT NULL,
    "productionStageId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "standardMinutes" DECIMAL(18,4),
    "slaHours" DECIMAL(18,2),
    "defaultJobWorkerId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_route_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."production_batches" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "manufacturingOrderId" UUID NOT NULL,
    "manufacturingOrderItemId" UUID NOT NULL,
    "batchNo" TEXT NOT NULL,
    "routeId" UUID NOT NULL,
    "trackingMode" "public"."TrackingMode" NOT NULL DEFAULT 'BATCH',
    "plannedQty" DECIMAL(18,4) NOT NULL,
    "releasedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "finishedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rejectedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "qcPassedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "inwardedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "parentBatchId" UUID,
    "splitReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."production_units" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "productionBatchId" UUID NOT NULL,
    "serialNo" TEXT NOT NULL,
    "currentRouteStepId" UUID,
    "status" "public"."ProductionUnitStatus" NOT NULL DEFAULT 'CREATED',
    "qcResult" "public"."InspectionResult",
    "rejectedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."production_stage_tasks" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "productionBatchId" UUID NOT NULL,
    "routeStepId" UUID NOT NULL,
    "productionStageId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "plannedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "receivedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "completedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rejectedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reworkSentQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reworkReturnedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "forwardedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "public"."StageTaskStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "assignedJobWorkerId" UUID,
    "assignedUserId" UUID,
    "plannedStartAt" TIMESTAMP(3),
    "plannedEndAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "remarks" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_stage_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."production_stage_movements" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "productionBatchId" UUID NOT NULL,
    "productionUnitId" UUID,
    "movementType" "public"."StageMovementType" NOT NULL,
    "fromStageTaskId" UUID,
    "toStageTaskId" UUID,
    "qty" DECIMAL(18,4) NOT NULL,
    "barcodeScanEventId" UUID,
    "operatorUserId" UUID,
    "reason" TEXT,
    "remarks" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_stage_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."barcode_identifiers" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "public"."BarcodeKind" NOT NULL,
    "productionBatchId" UUID,
    "productionUnitId" UUID,
    "materialLotId" UUID,
    "fabricRollId" UUID,
    "receiptId" UUID,
    "finishedInwardId" UUID,
    "labelData" JSONB,
    "printCount" INTEGER NOT NULL DEFAULT 0,
    "lastPrintedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "barcode_identifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."barcode_scan_events" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "scannedCode" TEXT NOT NULL,
    "barcodeIdentifierId" UUID,
    "eventType" "public"."ScanEventType" NOT NULL,
    "status" "public"."ScanEventStatus" NOT NULL DEFAULT 'ACCEPTED',
    "productionBatchId" UUID,
    "productionUnitId" UUID,
    "fromStageId" UUID,
    "toStageId" UUID,
    "receivedQty" DECIMAL(18,4),
    "completedQty" DECIMAL(18,4),
    "rejectedQty" DECIMAL(18,4),
    "reworkQty" DECIMAL(18,4),
    "operatorUserId" UUID,
    "deviceId" TEXT,
    "sessionId" TEXT,
    "validationMessage" TEXT,
    "remarks" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "barcode_scan_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."material_issues" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "issueNo" TEXT NOT NULL,
    "manufacturingOrderId" UUID,
    "stageTaskId" UUID,
    "jobWorkOrderId" UUID,
    "sourceLocationId" UUID NOT NULL,
    "destinationLocationId" UUID NOT NULL,
    "issueType" TEXT NOT NULL DEFAULT 'PRODUCTION',
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "issuedByUserId" UUID,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remarks" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."material_issue_lines" (
    "id" UUID NOT NULL,
    "materialIssueId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "rawMaterialId" UUID NOT NULL,
    "materialLotId" UUID NOT NULL,
    "fabricRollId" UUID,
    "issuedBaseQty" DECIMAL(18,4) NOT NULL,
    "returnedBaseQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "consumedBaseQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "uom" "public"."UomCode" NOT NULL,
    "unitCost" DECIMAL(18,6),
    "movementId" UUID,
    "reservationId" UUID,
    "remarks" TEXT,

    CONSTRAINT "material_issue_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."material_consumption" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "manufacturingOrderId" UUID NOT NULL,
    "productionBatchId" UUID,
    "stageTaskId" UUID,
    "materialIssueLineId" UUID,
    "rawMaterialId" UUID NOT NULL,
    "materialLotId" UUID NOT NULL,
    "fabricRollId" UUID,
    "consumedBaseQty" DECIMAL(18,4) NOT NULL,
    "wastageBaseQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "uom" "public"."UomCode" NOT NULL,
    "unitCost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "movementId" UUID,
    "wastageMovementId" UUID,
    "postedByUserId" UUID,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT,
    "remarks" TEXT,

    CONSTRAINT "material_consumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."cutting_orders" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "cuttingOrderNo" TEXT NOT NULL,
    "manufacturingOrderId" UUID NOT NULL,
    "productionBatchId" UUID,
    "fabricMaterialId" UUID,
    "fabricLotId" UUID,
    "fabricRollId" UUID,
    "sizeBreakdown" JSONB NOT NULL DEFAULT '[]',
    "fabricIssuedBaseQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "fabricUsedBaseQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "fabricWastageBaseQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "fabricReturnedBaseQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "plannedPieces" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "actualPiecesCut" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rejectedPieces" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "consumptionPostedAt" TIMESTAMP(3),
    "operatorUserId" UUID,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cutting_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."job_workers" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "public"."JobWorkerKind" NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "gstin" TEXT,
    "defaultRate" DECIMAL(18,6),
    "capacityPerDay" DECIMAL(18,4),
    "stockLocationId" UUID,
    "rating" INTEGER,
    "status" "public"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."job_work_orders" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "jobWorkOrderNo" TEXT NOT NULL,
    "manufacturingOrderId" UUID NOT NULL,
    "jobWorkerId" UUID NOT NULL,
    "productionStageId" UUID NOT NULL,
    "status" "public"."JobWorkOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "assignedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "issuedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "receivedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "completedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rejectedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reworkQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "ratePerPiece" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "totalCharge" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "issueDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "completionDate" TIMESTAMP(3),
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."job_work_order_lines" (
    "id" UUID NOT NULL,
    "jobWorkOrderId" UUID NOT NULL,
    "productionBatchId" UUID NOT NULL,
    "assignedQty" DECIMAL(18,4) NOT NULL,
    "receivedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "completedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rejectedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reworkQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "ratePerPiece" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "lineCharge" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_work_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."quality_inspections" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "inspectionNo" TEXT NOT NULL,
    "kind" "public"."QcKind" NOT NULL,
    "manufacturingOrderId" UUID NOT NULL,
    "productionBatchId" UUID,
    "productionUnitId" UUID,
    "stageTaskId" UUID,
    "productionStageId" UUID,
    "inspectedQty" DECIMAL(18,4) NOT NULL,
    "passedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "failedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reworkQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "holdQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "result" "public"."InspectionResult" NOT NULL,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "photoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reinspectionOfId" UUID,
    "inspectorUserId" UUID,
    "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remarks" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."quality_defects" (
    "id" UUID NOT NULL,
    "qualityInspectionId" UUID NOT NULL,
    "category" "public"."DefectCategory" NOT NULL,
    "defectCode" TEXT,
    "description" TEXT,
    "qty" DECIMAL(18,4) NOT NULL,
    "severity" TEXT,
    "photoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attributedStageId" UUID,
    "attributedJobWorkerId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_defects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."rework_orders" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "reworkOrderNo" TEXT NOT NULL,
    "qualityInspectionId" UUID,
    "productionBatchId" UUID NOT NULL,
    "targetStageId" UUID,
    "assignedJobWorkerId" UUID,
    "assignedUserId" UUID,
    "qty" DECIMAL(18,4) NOT NULL,
    "completedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "scrappedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "public"."ReworkOrderStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rework_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."finished_goods_balances" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "productVariantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "onHandQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "pendingSyncQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "syncedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finished_goods_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."finished_goods_movements" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "movementNo" TEXT NOT NULL,
    "movementType" "public"."FinishedGoodsMovementType" NOT NULL,
    "productVariantId" UUID NOT NULL,
    "sourceLocationId" UUID,
    "destinationLocationId" UUID,
    "qty" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,6),
    "referenceType" TEXT,
    "referenceId" UUID,
    "referenceNo" TEXT,
    "operatorUserId" UUID,
    "reason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finished_goods_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."finished_goods_inwards" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "inwardNo" TEXT NOT NULL,
    "manufacturingOrderId" UUID NOT NULL,
    "manufacturingLocationId" UUID NOT NULL,
    "destinationFacilityId" UUID,
    "inwardDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "syncStatus" "public"."SyncStatus" NOT NULL DEFAULT 'SYNC_PENDING',
    "inwardByUserId" UUID,
    "postedAt" TIMESTAMP(3),
    "remarks" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finished_goods_inwards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."finished_goods_inward_lines" (
    "id" UUID NOT NULL,
    "finishedInwardId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productVariantId" UUID NOT NULL,
    "productionBatchId" UUID,
    "acceptedQty" DECIMAL(18,4) NOT NULL,
    "rejectedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unitIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "unitCost" DECIMAL(18,6),
    "pushedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "movementId" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "remarks" TEXT,

    CONSTRAINT "finished_goods_inward_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."external_facilities" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "provider" "public"."IntegrationProvider" NOT NULL,
    "externalCode" TEXT NOT NULL,
    "externalName" TEXT,
    "displayName" TEXT NOT NULL,
    "mirrorLocationId" UUID,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isPushEnabled" BOOLEAN NOT NULL DEFAULT false,
    "address" JSONB,
    "rawPayload" JSONB,
    "status" "public"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_facilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."inventory_push_jobs" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "pushJobNo" TEXT NOT NULL,
    "provider" "public"."IntegrationProvider" NOT NULL DEFAULT 'UNICOMMERCE',
    "operationKind" "public"."PushOperationKind" NOT NULL,
    "externalFacilityId" UUID NOT NULL,
    "status" "public"."PushJobStatus" NOT NULL DEFAULT 'DRAFT',
    "externalRequestId" TEXT NOT NULL,
    "externalReference" TEXT,
    "totalQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "successQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "failedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "facilityChangeApprovedByUserId" UUID,
    "previewedByUserId" UUID,
    "approvedByUserId" UUID,
    "approvedAt" TIMESTAMP(3),
    "queuedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_push_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."inventory_push_lines" (
    "id" UUID NOT NULL,
    "inventoryPushJobId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "finishedInwardLineId" UUID NOT NULL,
    "productVariantId" UUID NOT NULL,
    "externalSku" TEXT,
    "qty" DECIMAL(18,4) NOT NULL,
    "acceptedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "public"."SyncStatus" NOT NULL DEFAULT 'SYNC_PENDING',
    "externalLineRef" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_push_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."external_inventory_reconciliations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "provider" "public"."IntegrationProvider" NOT NULL,
    "externalFacilityId" UUID NOT NULL,
    "productVariantId" UUID,
    "inventoryPushJobId" UUID,
    "erpQty" DECIMAL(18,4) NOT NULL,
    "externalQty" DECIMAL(18,4) NOT NULL,
    "varianceQty" DECIMAL(18,4) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolution" TEXT,
    "resolvedByUserId" UUID,
    "resolvedAt" TIMESTAMP(3),
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_inventory_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."integration_connections" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "provider" "public"."IntegrationProvider" NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "credentialRef" TEXT,
    "apiVersion" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "allowExternalWrites" BOOLEAN NOT NULL DEFAULT false,
    "healthStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "lastHealthCheckAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "rateLimitState" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."integration_events" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "integrationConnectionId" UUID,
    "provider" "public"."IntegrationProvider" NOT NULL,
    "eventType" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "externalResourceId" TEXT,
    "payload" JSONB NOT NULL,
    "headers" JSONB,
    "status" "public"."IntegrationEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "processedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sync_logs" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "integrationConnectionId" UUID,
    "provider" "public"."IntegrationProvider" NOT NULL,
    "operation" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'OUTBOUND',
    "referenceType" TEXT,
    "referenceId" UUID,
    "externalRequestId" TEXT,
    "httpStatus" INTEGER,
    "businessSuccess" BOOLEAN,
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "attemptNo" INTEGER NOT NULL DEFAULT 1,
    "outcomeUncertain" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."mo_cost_entries" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "manufacturingOrderId" UUID NOT NULL,
    "costCategory" TEXT NOT NULL,
    "isPlanned" BOOLEAN NOT NULL,
    "qty" DECIMAL(18,4),
    "unitRate" DECIMAL(18,6),
    "amount" DECIMAL(18,2) NOT NULL,
    "referenceType" TEXT,
    "referenceId" UUID,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mo_cost_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."fabric_rolls" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "rollNo" TEXT NOT NULL,
    "rawMaterialId" UUID NOT NULL,
    "materialLotId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "supplierId" UUID,
    "receiptLineId" UUID,
    "shade" TEXT,
    "color" TEXT,
    "width" DECIMAL(10,2),
    "widthUom" TEXT,
    "gsm" INTEGER,
    "originalLength" DECIMAL(18,4) NOT NULL,
    "currentLength" DECIMAL(18,4) NOT NULL,
    "reservedLength" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lengthUom" "public"."UomCode" NOT NULL DEFAULT 'METER',
    "purchaseRate" DECIMAL(18,6),
    "qcStatus" "public"."InspectionResult",
    "status" "public"."FabricRollStatus" NOT NULL DEFAULT 'RECEIVED',
    "defectNotes" TEXT,
    "receivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fabric_rolls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."product_bundle_components" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bundleVariantId" UUID NOT NULL,
    "componentVariantId" UUID NOT NULL,
    "qtyPerBundle" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "role" "public"."BundleComponentRole" NOT NULL DEFAULT 'COMPONENT',
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "requiresManufacturing" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_bundle_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."shopify_orders" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "orderName" TEXT,
    "channel" "public"."DemandChannel" NOT NULL,
    "posLocationId" TEXT,
    "posLocationName" TEXT,
    "orderedAt" TIMESTAMP(3) NOT NULL,
    "financialStatus" TEXT,
    "fulfillmentStatus" TEXT,
    "status" "public"."ExternalOrderStatus" NOT NULL DEFAULT 'OPEN',
    "currency" TEXT,
    "totalAmount" DECIMAL(18,2),
    "requiredByDate" TIMESTAMP(3),
    "customerRef" TEXT,
    "note" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cancelledAt" TIMESTAMP(3),
    "rawPayload" JSONB,
    "externalUpdatedAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopify_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."shopify_order_lines" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "shopifyOrderId" UUID NOT NULL,
    "externalLineId" TEXT NOT NULL,
    "productVariantId" UUID,
    "externalSku" TEXT,
    "externalVariantId" TEXT,
    "title" TEXT,
    "size" TEXT,
    "color" TEXT,
    "orderedQty" DECIMAL(18,4) NOT NULL,
    "cancelledQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "fulfilledQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "refundedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "availabilityStatus" "public"."InventoryAvailabilityStatus" NOT NULL DEFAULT 'PENDING_CHECK',
    "availableQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "allocatedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "manufacturingQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "availabilityCheckedAt" TIMESTAMP(3),
    "availabilityError" TEXT,
    "customization" JSONB,
    "priority" "public"."Priority" NOT NULL DEFAULT 'NORMAL',
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopify_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."unicommerce_purchase_orders" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "poDate" TIMESTAMP(3) NOT NULL,
    "supplierName" TEXT,
    "supplierCode" TEXT,
    "destinationFacilityId" UUID,
    "externalFacilityCode" TEXT,
    "status" "public"."ExternalOrderStatus" NOT NULL DEFAULT 'OPEN',
    "expectedDeliveryDate" TIMESTAMP(3),
    "totalQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "receivedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "pendingQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "externalVersion" TEXT,
    "rawPayload" JSONB,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unicommerce_purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."unicommerce_purchase_order_lines" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "unicommercePoId" UUID NOT NULL,
    "externalLineId" TEXT NOT NULL,
    "productVariantId" UUID,
    "externalSku" TEXT,
    "itemName" TEXT,
    "size" TEXT,
    "color" TEXT,
    "orderedQty" DECIMAL(18,4) NOT NULL,
    "receivedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "pendingQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "cancelledQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "manufacturingQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "expectedDeliveryDate" TIMESTAMP(3),
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unicommerce_purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."facility_inventory_snapshots" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "externalFacilityId" UUID NOT NULL,
    "productVariantId" UUID,
    "externalSku" TEXT,
    "availableQty" DECIMAL(18,4) NOT NULL,
    "reservedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "inTransitQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "snapshotAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawPayload" JSONB,

    CONSTRAINT "facility_inventory_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."demand_forecasts" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "productVariantId" UUID NOT NULL,
    "externalFacilityId" UUID,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "method" "public"."ForecastMethod" NOT NULL DEFAULT 'WEIGHTED_VELOCITY',
    "salesVelocity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lookbackDays" INTEGER NOT NULL DEFAULT 56,
    "seasonalIndex" DECIMAL(9,4) NOT NULL DEFAULT 1,
    "forecastQty" DECIMAL(18,4) NOT NULL,
    "confidence" DECIMAL(9,4),
    "inputs" JSONB NOT NULL DEFAULT '{}',
    "generatedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demand_forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."replenishment_suggestions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "productVariantId" UUID NOT NULL,
    "externalFacilityId" UUID,
    "demandForecastId" UUID,
    "availableQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "incomingQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 0,
    "leadTimeDemandQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "safetyStockQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "suggestedQty" DECIMAL(18,4) NOT NULL,
    "rationale" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "actionedByUserId" UUID,
    "actionedAt" TIMESTAMP(3),
    "manufacturingOrderId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "replenishment_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."alert_rules" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "severity" "public"."AlertSeverity" NOT NULL DEFAULT 'WARNING',
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "channels" "public"."NotificationChannel"[],
    "recipientRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recipientUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 1440,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "alertRuleId" UUID,
    "channel" "public"."NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "severity" "public"."AlertSeverity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "recipientUserId" UUID,
    "recipientAddress" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "actionUrl" TEXT,
    "status" "public"."NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."approval_rules" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "approverRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minApprovals" INTEGER NOT NULL DEFAULT 1,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."approval_requests" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "approvalRuleId" UUID,
    "subjectType" TEXT NOT NULL,
    "subjectId" UUID NOT NULL,
    "subjectRef" TEXT,
    "requestPayload" JSONB NOT NULL DEFAULT '{}',
    "reason" TEXT,
    "status" "public"."ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" UUID,
    "decidedByUserId" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_attachments" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "category" TEXT,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksumSha256" TEXT,
    "uploadedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."saved_views" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "ownerUserId" UUID,
    "resource" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definition" JSONB NOT NULL DEFAULT '{}',
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_code_key" ON "public"."organizations"("code");

-- CreateIndex
CREATE INDEX "users_organizationId_status_idx" ON "public"."users"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "users_organizationId_email_key" ON "public"."users"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "users_organizationId_employeeCode_key" ON "public"."users"("organizationId", "employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organizationId_code_key" ON "public"."roles"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "public"."permissions"("code");

-- CreateIndex
CREATE INDEX "permissions_module_idx" ON "public"."permissions"("module");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_entityType_entityId_idx" ON "public"."audit_logs"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "public"."audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "public"."audit_logs"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "idempotency_records_createdAt_idx" ON "public"."idempotency_records"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_organizationId_scope_key_key" ON "public"."idempotency_records"("organizationId", "scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "number_sequences_organizationId_scope_key" ON "public"."number_sequences"("organizationId", "scope");

-- CreateIndex
CREATE INDEX "products_organizationId_status_idx" ON "public"."products"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "products_organizationId_styleCode_key" ON "public"."products"("organizationId", "styleCode");

-- CreateIndex
CREATE INDEX "product_variants_organizationId_status_idx" ON "public"."product_variants"("organizationId", "status");

-- CreateIndex
CREATE INDEX "product_variants_productId_idx" ON "public"."product_variants"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_organizationId_sku_key" ON "public"."product_variants"("organizationId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_organizationId_barcode_key" ON "public"."product_variants"("organizationId", "barcode");

-- CreateIndex
CREATE INDEX "external_product_mappings_organizationId_provider_externalS_idx" ON "public"."external_product_mappings"("organizationId", "provider", "externalSku");

-- CreateIndex
CREATE INDEX "external_product_mappings_productVariantId_idx" ON "public"."external_product_mappings"("productVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "external_product_mappings_organizationId_provider_identifie_key" ON "public"."external_product_mappings"("organizationId", "provider", "identifierKind", "externalId");

-- CreateIndex
CREATE INDEX "product_sync_issues_organizationId_provider_resolvedAt_idx" ON "public"."product_sync_issues"("organizationId", "provider", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "uom_conversions_organizationId_rawMaterialId_fromUom_toUom_key" ON "public"."uom_conversions"("organizationId", "rawMaterialId", "fromUom", "toUom");

-- CreateIndex
CREATE INDEX "raw_materials_organizationId_category_status_idx" ON "public"."raw_materials"("organizationId", "category", "status");

-- CreateIndex
CREATE INDEX "raw_materials_organizationId_name_idx" ON "public"."raw_materials"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "raw_materials_organizationId_materialCode_key" ON "public"."raw_materials"("organizationId", "materialCode");

-- CreateIndex
CREATE INDEX "material_lots_rawMaterialId_receivedAt_idx" ON "public"."material_lots"("rawMaterialId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "material_lots_organizationId_rawMaterialId_lotCode_key" ON "public"."material_lots"("organizationId", "rawMaterialId", "lotCode");

-- CreateIndex
CREATE INDEX "material_locations_organizationId_kind_status_idx" ON "public"."material_locations"("organizationId", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "material_locations_organizationId_code_key" ON "public"."material_locations"("organizationId", "code");

-- CreateIndex
CREATE INDEX "material_balances_organizationId_rawMaterialId_idx" ON "public"."material_balances"("organizationId", "rawMaterialId");

-- CreateIndex
CREATE INDEX "material_balances_locationId_idx" ON "public"."material_balances"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "material_balances_rawMaterialId_materialLotId_locationId_key" ON "public"."material_balances"("rawMaterialId", "materialLotId", "locationId");

-- CreateIndex
CREATE INDEX "material_movements_organizationId_rawMaterialId_occurredAt_idx" ON "public"."material_movements"("organizationId", "rawMaterialId", "occurredAt");

-- CreateIndex
CREATE INDEX "material_movements_organizationId_movementType_occurredAt_idx" ON "public"."material_movements"("organizationId", "movementType", "occurredAt");

-- CreateIndex
CREATE INDEX "material_movements_referenceType_referenceId_idx" ON "public"."material_movements"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "material_movements_materialLotId_idx" ON "public"."material_movements"("materialLotId");

-- CreateIndex
CREATE INDEX "material_movements_fabricRollId_idx" ON "public"."material_movements"("fabricRollId");

-- CreateIndex
CREATE UNIQUE INDEX "material_movements_organizationId_movementNo_key" ON "public"."material_movements"("organizationId", "movementNo");

-- CreateIndex
CREATE UNIQUE INDEX "material_movements_organizationId_idempotencyKey_key" ON "public"."material_movements"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "material_reservations_manufacturingOrderId_status_idx" ON "public"."material_reservations"("manufacturingOrderId", "status");

-- CreateIndex
CREATE INDEX "material_reservations_rawMaterialId_materialLotId_locationI_idx" ON "public"."material_reservations"("rawMaterialId", "materialLotId", "locationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "material_reservations_organizationId_idempotencyKey_key" ON "public"."material_reservations"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "stock_counts_organizationId_status_idx" ON "public"."stock_counts"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_organizationId_countNo_key" ON "public"."stock_counts"("organizationId", "countNo");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_lines_stockCountId_rawMaterialId_materialLotId_key" ON "public"."stock_count_lines"("stockCountId", "rawMaterialId", "materialLotId");

-- CreateIndex
CREATE INDEX "suppliers_organizationId_status_idx" ON "public"."suppliers"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_organizationId_supplierCode_key" ON "public"."suppliers"("organizationId", "supplierCode");

-- CreateIndex
CREATE INDEX "purchase_requisitions_organizationId_status_idx" ON "public"."purchase_requisitions"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requisitions_organizationId_requisitionNo_key" ON "public"."purchase_requisitions"("organizationId", "requisitionNo");

-- CreateIndex
CREATE INDEX "purchase_requisition_items_purchaseRequisitionId_idx" ON "public"."purchase_requisition_items"("purchaseRequisitionId");

-- CreateIndex
CREATE INDEX "raw_material_purchase_orders_organizationId_status_expected_idx" ON "public"."raw_material_purchase_orders"("organizationId", "status", "expectedDate");

-- CreateIndex
CREATE INDEX "raw_material_purchase_orders_supplierId_idx" ON "public"."raw_material_purchase_orders"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "raw_material_purchase_orders_organizationId_poNo_key" ON "public"."raw_material_purchase_orders"("organizationId", "poNo");

-- CreateIndex
CREATE INDEX "raw_material_purchase_items_rawMaterialId_idx" ON "public"."raw_material_purchase_items"("rawMaterialId");

-- CreateIndex
CREATE UNIQUE INDEX "raw_material_purchase_items_purchaseOrderId_lineNo_key" ON "public"."raw_material_purchase_items"("purchaseOrderId", "lineNo");

-- CreateIndex
CREATE INDEX "raw_material_receipts_organizationId_status_receiptDate_idx" ON "public"."raw_material_receipts"("organizationId", "status", "receiptDate");

-- CreateIndex
CREATE INDEX "raw_material_receipts_purchaseOrderId_idx" ON "public"."raw_material_receipts"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "raw_material_receipts_organizationId_grnNo_key" ON "public"."raw_material_receipts"("organizationId", "grnNo");

-- CreateIndex
CREATE UNIQUE INDEX "raw_material_receipts_organizationId_idempotencyKey_key" ON "public"."raw_material_receipts"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "raw_material_receipt_lines_rawMaterialId_idx" ON "public"."raw_material_receipt_lines"("rawMaterialId");

-- CreateIndex
CREATE UNIQUE INDEX "raw_material_receipt_lines_receiptId_lineNo_key" ON "public"."raw_material_receipt_lines"("receiptId", "lineNo");

-- CreateIndex
CREATE INDEX "boms_productId_idx" ON "public"."boms"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "boms_organizationId_bomCode_key" ON "public"."boms"("organizationId", "bomCode");

-- CreateIndex
CREATE UNIQUE INDEX "boms_organizationId_productId_productVariantId_key" ON "public"."boms"("organizationId", "productId", "productVariantId");

-- CreateIndex
CREATE INDEX "bom_versions_organizationId_status_idx" ON "public"."bom_versions"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bom_versions_bomId_version_key" ON "public"."bom_versions"("bomId", "version");

-- CreateIndex
CREATE INDEX "bom_items_rawMaterialId_idx" ON "public"."bom_items"("rawMaterialId");

-- CreateIndex
CREATE UNIQUE INDEX "bom_items_bomVersionId_lineNo_key" ON "public"."bom_items"("bomVersionId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "bom_item_alternatives_bomItemId_rawMaterialId_key" ON "public"."bom_item_alternatives"("bomItemId", "rawMaterialId");

-- CreateIndex
CREATE UNIQUE INDEX "bom_item_size_overrides_bomItemId_size_key" ON "public"."bom_item_size_overrides"("bomItemId", "size");

-- CreateIndex
CREATE INDEX "mrp_runs_organizationId_status_createdAt_idx" ON "public"."mrp_runs"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "mrp_runs_organizationId_runNo_key" ON "public"."mrp_runs"("organizationId", "runNo");

-- CreateIndex
CREATE INDEX "material_requirements_mrpRunId_idx" ON "public"."material_requirements"("mrpRunId");

-- CreateIndex
CREATE INDEX "material_requirements_manufacturingOrderId_idx" ON "public"."material_requirements"("manufacturingOrderId");

-- CreateIndex
CREATE INDEX "material_requirements_organizationId_rawMaterialId_idx" ON "public"."material_requirements"("organizationId", "rawMaterialId");

-- CreateIndex
CREATE INDEX "manufacturing_demand_organizationId_status_requiredByDate_idx" ON "public"."manufacturing_demand"("organizationId", "status", "requiredByDate");

-- CreateIndex
CREATE INDEX "manufacturing_demand_productVariantId_idx" ON "public"."manufacturing_demand"("productVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_demand_organizationId_demandNo_key" ON "public"."manufacturing_demand"("organizationId", "demandNo");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_demand_organizationId_dedupeFingerprint_key" ON "public"."manufacturing_demand"("organizationId", "dedupeFingerprint");

-- CreateIndex
CREATE INDEX "demand_source_mappings_manufacturingDemandId_idx" ON "public"."demand_source_mappings"("manufacturingDemandId");

-- CreateIndex
CREATE INDEX "demand_source_mappings_organizationId_sourceDocNo_idx" ON "public"."demand_source_mappings"("organizationId", "sourceDocNo");

-- CreateIndex
CREATE UNIQUE INDEX "demand_source_mappings_organizationId_sourceSystem_sourceDo_key" ON "public"."demand_source_mappings"("organizationId", "sourceSystem", "sourceDocType", "sourceDocId", "sourceLineId");

-- CreateIndex
CREATE INDEX "demand_allocations_manufacturingOrderId_idx" ON "public"."demand_allocations"("manufacturingOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "demand_allocations_manufacturingDemandId_manufacturingOrder_key" ON "public"."demand_allocations"("manufacturingDemandId", "manufacturingOrderId", "manufacturingOrderItemId");

-- CreateIndex
CREATE INDEX "manufacturing_orders_organizationId_status_dueDate_idx" ON "public"."manufacturing_orders"("organizationId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "manufacturing_orders_organizationId_productId_idx" ON "public"."manufacturing_orders"("organizationId", "productId");

-- CreateIndex
CREATE INDEX "manufacturing_orders_productVariantId_idx" ON "public"."manufacturing_orders"("productVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_orders_organizationId_moNo_key" ON "public"."manufacturing_orders"("organizationId", "moNo");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_orders_organizationId_idempotencyKey_key" ON "public"."manufacturing_orders"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "manufacturing_order_items_productVariantId_idx" ON "public"."manufacturing_order_items"("productVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_order_items_manufacturingOrderId_lineNo_key" ON "public"."manufacturing_order_items"("manufacturingOrderId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_order_items_manufacturingOrderId_productVaria_key" ON "public"."manufacturing_order_items"("manufacturingOrderId", "productVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "mo_bom_snapshot_lines_manufacturingOrderId_lineNo_key" ON "public"."mo_bom_snapshot_lines"("manufacturingOrderId", "lineNo");

-- CreateIndex
CREATE INDEX "production_stages_organizationId_status_idx" ON "public"."production_stages"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "production_stages_organizationId_code_key" ON "public"."production_stages"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "production_routes_organizationId_code_key" ON "public"."production_routes"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "production_route_steps_routeId_sequence_key" ON "public"."production_route_steps"("routeId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "production_route_steps_routeId_productionStageId_key" ON "public"."production_route_steps"("routeId", "productionStageId");

-- CreateIndex
CREATE INDEX "production_batches_manufacturingOrderId_status_idx" ON "public"."production_batches"("manufacturingOrderId", "status");

-- CreateIndex
CREATE INDEX "production_batches_manufacturingOrderItemId_idx" ON "public"."production_batches"("manufacturingOrderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "production_batches_organizationId_batchNo_key" ON "public"."production_batches"("organizationId", "batchNo");

-- CreateIndex
CREATE INDEX "production_units_productionBatchId_status_idx" ON "public"."production_units"("productionBatchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "production_units_organizationId_serialNo_key" ON "public"."production_units"("organizationId", "serialNo");

-- CreateIndex
CREATE INDEX "production_stage_tasks_organizationId_productionStageId_sta_idx" ON "public"."production_stage_tasks"("organizationId", "productionStageId", "status");

-- CreateIndex
CREATE INDEX "production_stage_tasks_assignedJobWorkerId_status_idx" ON "public"."production_stage_tasks"("assignedJobWorkerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "production_stage_tasks_productionBatchId_routeStepId_key" ON "public"."production_stage_tasks"("productionBatchId", "routeStepId");

-- CreateIndex
CREATE INDEX "production_stage_movements_productionBatchId_occurredAt_idx" ON "public"."production_stage_movements"("productionBatchId", "occurredAt");

-- CreateIndex
CREATE INDEX "production_stage_movements_organizationId_movementType_occu_idx" ON "public"."production_stage_movements"("organizationId", "movementType", "occurredAt");

-- CreateIndex
CREATE INDEX "production_stage_movements_productionUnitId_idx" ON "public"."production_stage_movements"("productionUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "production_stage_movements_organizationId_idempotencyKey_key" ON "public"."production_stage_movements"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "barcode_identifiers_productionBatchId_key" ON "public"."barcode_identifiers"("productionBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "barcode_identifiers_productionUnitId_key" ON "public"."barcode_identifiers"("productionUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "barcode_identifiers_materialLotId_key" ON "public"."barcode_identifiers"("materialLotId");

-- CreateIndex
CREATE UNIQUE INDEX "barcode_identifiers_fabricRollId_key" ON "public"."barcode_identifiers"("fabricRollId");

-- CreateIndex
CREATE UNIQUE INDEX "barcode_identifiers_receiptId_key" ON "public"."barcode_identifiers"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "barcode_identifiers_finishedInwardId_key" ON "public"."barcode_identifiers"("finishedInwardId");

-- CreateIndex
CREATE INDEX "barcode_identifiers_organizationId_kind_isActive_idx" ON "public"."barcode_identifiers"("organizationId", "kind", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "barcode_identifiers_organizationId_code_key" ON "public"."barcode_identifiers"("organizationId", "code");

-- CreateIndex
CREATE INDEX "barcode_scan_events_organizationId_scannedAt_idx" ON "public"."barcode_scan_events"("organizationId", "scannedAt");

-- CreateIndex
CREATE INDEX "barcode_scan_events_operatorUserId_scannedAt_idx" ON "public"."barcode_scan_events"("operatorUserId", "scannedAt");

-- CreateIndex
CREATE INDEX "barcode_scan_events_productionBatchId_scannedAt_idx" ON "public"."barcode_scan_events"("productionBatchId", "scannedAt");

-- CreateIndex
CREATE UNIQUE INDEX "barcode_scan_events_organizationId_idempotencyKey_key" ON "public"."barcode_scan_events"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "material_issues_manufacturingOrderId_idx" ON "public"."material_issues"("manufacturingOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "material_issues_organizationId_issueNo_key" ON "public"."material_issues"("organizationId", "issueNo");

-- CreateIndex
CREATE UNIQUE INDEX "material_issues_organizationId_idempotencyKey_key" ON "public"."material_issues"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "material_issue_lines_rawMaterialId_materialLotId_idx" ON "public"."material_issue_lines"("rawMaterialId", "materialLotId");

-- CreateIndex
CREATE UNIQUE INDEX "material_issue_lines_materialIssueId_lineNo_key" ON "public"."material_issue_lines"("materialIssueId", "lineNo");

-- CreateIndex
CREATE INDEX "material_consumption_manufacturingOrderId_idx" ON "public"."material_consumption"("manufacturingOrderId");

-- CreateIndex
CREATE INDEX "material_consumption_rawMaterialId_materialLotId_idx" ON "public"."material_consumption"("rawMaterialId", "materialLotId");

-- CreateIndex
CREATE UNIQUE INDEX "material_consumption_organizationId_idempotencyKey_key" ON "public"."material_consumption"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "cutting_orders_manufacturingOrderId_status_idx" ON "public"."cutting_orders"("manufacturingOrderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cutting_orders_organizationId_cuttingOrderNo_key" ON "public"."cutting_orders"("organizationId", "cuttingOrderNo");

-- CreateIndex
CREATE INDEX "job_workers_organizationId_kind_status_idx" ON "public"."job_workers"("organizationId", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "job_workers_organizationId_code_key" ON "public"."job_workers"("organizationId", "code");

-- CreateIndex
CREATE INDEX "job_work_orders_jobWorkerId_status_idx" ON "public"."job_work_orders"("jobWorkerId", "status");

-- CreateIndex
CREATE INDEX "job_work_orders_manufacturingOrderId_idx" ON "public"."job_work_orders"("manufacturingOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "job_work_orders_organizationId_jobWorkOrderNo_key" ON "public"."job_work_orders"("organizationId", "jobWorkOrderNo");

-- CreateIndex
CREATE UNIQUE INDEX "job_work_order_lines_jobWorkOrderId_productionBatchId_key" ON "public"."job_work_order_lines"("jobWorkOrderId", "productionBatchId");

-- CreateIndex
CREATE INDEX "quality_inspections_manufacturingOrderId_kind_idx" ON "public"."quality_inspections"("manufacturingOrderId", "kind");

-- CreateIndex
CREATE INDEX "quality_inspections_productionBatchId_idx" ON "public"."quality_inspections"("productionBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "quality_inspections_organizationId_inspectionNo_key" ON "public"."quality_inspections"("organizationId", "inspectionNo");

-- CreateIndex
CREATE UNIQUE INDEX "quality_inspections_organizationId_idempotencyKey_key" ON "public"."quality_inspections"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "quality_defects_qualityInspectionId_idx" ON "public"."quality_defects"("qualityInspectionId");

-- CreateIndex
CREATE INDEX "quality_defects_category_idx" ON "public"."quality_defects"("category");

-- CreateIndex
CREATE INDEX "rework_orders_productionBatchId_status_idx" ON "public"."rework_orders"("productionBatchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rework_orders_organizationId_reworkOrderNo_key" ON "public"."rework_orders"("organizationId", "reworkOrderNo");

-- CreateIndex
CREATE INDEX "finished_goods_balances_organizationId_productVariantId_idx" ON "public"."finished_goods_balances"("organizationId", "productVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "finished_goods_balances_productVariantId_locationId_key" ON "public"."finished_goods_balances"("productVariantId", "locationId");

-- CreateIndex
CREATE INDEX "finished_goods_movements_organizationId_productVariantId_oc_idx" ON "public"."finished_goods_movements"("organizationId", "productVariantId", "occurredAt");

-- CreateIndex
CREATE INDEX "finished_goods_movements_referenceType_referenceId_idx" ON "public"."finished_goods_movements"("referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "finished_goods_movements_organizationId_movementNo_key" ON "public"."finished_goods_movements"("organizationId", "movementNo");

-- CreateIndex
CREATE UNIQUE INDEX "finished_goods_movements_organizationId_idempotencyKey_key" ON "public"."finished_goods_movements"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "finished_goods_inwards_organizationId_syncStatus_idx" ON "public"."finished_goods_inwards"("organizationId", "syncStatus");

-- CreateIndex
CREATE INDEX "finished_goods_inwards_manufacturingOrderId_idx" ON "public"."finished_goods_inwards"("manufacturingOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "finished_goods_inwards_organizationId_inwardNo_key" ON "public"."finished_goods_inwards"("organizationId", "inwardNo");

-- CreateIndex
CREATE UNIQUE INDEX "finished_goods_inwards_organizationId_idempotencyKey_key" ON "public"."finished_goods_inwards"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "finished_goods_inward_lines_productVariantId_idx" ON "public"."finished_goods_inward_lines"("productVariantId");

-- CreateIndex
CREATE INDEX "finished_goods_inward_lines_productionBatchId_idx" ON "public"."finished_goods_inward_lines"("productionBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "finished_goods_inward_lines_finishedInwardId_lineNo_key" ON "public"."finished_goods_inward_lines"("finishedInwardId", "lineNo");

-- CreateIndex
CREATE INDEX "external_facilities_organizationId_provider_status_idx" ON "public"."external_facilities"("organizationId", "provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "external_facilities_organizationId_provider_externalCode_key" ON "public"."external_facilities"("organizationId", "provider", "externalCode");

-- CreateIndex
CREATE INDEX "inventory_push_jobs_organizationId_status_createdAt_idx" ON "public"."inventory_push_jobs"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_push_jobs_organizationId_pushJobNo_key" ON "public"."inventory_push_jobs"("organizationId", "pushJobNo");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_push_jobs_organizationId_externalRequestId_key" ON "public"."inventory_push_jobs"("organizationId", "externalRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_push_jobs_organizationId_idempotencyKey_key" ON "public"."inventory_push_jobs"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "inventory_push_lines_finishedInwardLineId_idx" ON "public"."inventory_push_lines"("finishedInwardLineId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_push_lines_inventoryPushJobId_lineNo_key" ON "public"."inventory_push_lines"("inventoryPushJobId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_push_lines_inventoryPushJobId_finishedInwardLineI_key" ON "public"."inventory_push_lines"("inventoryPushJobId", "finishedInwardLineId");

-- CreateIndex
CREATE INDEX "external_inventory_reconciliations_organizationId_externalF_idx" ON "public"."external_inventory_reconciliations"("organizationId", "externalFacilityId", "observedAt");

-- CreateIndex
CREATE INDEX "external_inventory_reconciliations_inventoryPushJobId_idx" ON "public"."external_inventory_reconciliations"("inventoryPushJobId");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_organizationId_provider_name_key" ON "public"."integration_connections"("organizationId", "provider", "name");

-- CreateIndex
CREATE INDEX "integration_events_organizationId_status_receivedAt_idx" ON "public"."integration_events"("organizationId", "status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "integration_events_organizationId_provider_eventType_extern_key" ON "public"."integration_events"("organizationId", "provider", "eventType", "externalEventId");

-- CreateIndex
CREATE INDEX "sync_logs_organizationId_provider_operation_createdAt_idx" ON "public"."sync_logs"("organizationId", "provider", "operation", "createdAt");

-- CreateIndex
CREATE INDEX "sync_logs_referenceType_referenceId_idx" ON "public"."sync_logs"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "sync_logs_externalRequestId_idx" ON "public"."sync_logs"("externalRequestId");

-- CreateIndex
CREATE INDEX "mo_cost_entries_manufacturingOrderId_costCategory_isPlanned_idx" ON "public"."mo_cost_entries"("manufacturingOrderId", "costCategory", "isPlanned");

-- CreateIndex
CREATE INDEX "fabric_rolls_organizationId_rawMaterialId_status_idx" ON "public"."fabric_rolls"("organizationId", "rawMaterialId", "status");

-- CreateIndex
CREATE INDEX "fabric_rolls_materialLotId_idx" ON "public"."fabric_rolls"("materialLotId");

-- CreateIndex
CREATE INDEX "fabric_rolls_locationId_idx" ON "public"."fabric_rolls"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "fabric_rolls_organizationId_rollNo_key" ON "public"."fabric_rolls"("organizationId", "rollNo");

-- CreateIndex
CREATE INDEX "product_bundle_components_componentVariantId_idx" ON "public"."product_bundle_components"("componentVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "product_bundle_components_bundleVariantId_componentVariantI_key" ON "public"."product_bundle_components"("bundleVariantId", "componentVariantId");

-- CreateIndex
CREATE INDEX "shopify_orders_organizationId_channel_orderedAt_idx" ON "public"."shopify_orders"("organizationId", "channel", "orderedAt");

-- CreateIndex
CREATE INDEX "shopify_orders_organizationId_status_idx" ON "public"."shopify_orders"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_orders_organizationId_externalId_key" ON "public"."shopify_orders"("organizationId", "externalId");

-- CreateIndex
CREATE INDEX "shopify_order_lines_shopifyOrderId_idx" ON "public"."shopify_order_lines"("shopifyOrderId");

-- CreateIndex
CREATE INDEX "shopify_order_lines_organizationId_availabilityStatus_idx" ON "public"."shopify_order_lines"("organizationId", "availabilityStatus");

-- CreateIndex
CREATE INDEX "shopify_order_lines_productVariantId_idx" ON "public"."shopify_order_lines"("productVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_order_lines_organizationId_externalLineId_key" ON "public"."shopify_order_lines"("organizationId", "externalLineId");

-- CreateIndex
CREATE INDEX "unicommerce_purchase_orders_organizationId_status_expectedD_idx" ON "public"."unicommerce_purchase_orders"("organizationId", "status", "expectedDeliveryDate");

-- CreateIndex
CREATE UNIQUE INDEX "unicommerce_purchase_orders_organizationId_externalId_key" ON "public"."unicommerce_purchase_orders"("organizationId", "externalId");

-- CreateIndex
CREATE INDEX "unicommerce_purchase_order_lines_unicommercePoId_idx" ON "public"."unicommerce_purchase_order_lines"("unicommercePoId");

-- CreateIndex
CREATE INDEX "unicommerce_purchase_order_lines_productVariantId_idx" ON "public"."unicommerce_purchase_order_lines"("productVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "unicommerce_purchase_order_lines_organizationId_externalLin_key" ON "public"."unicommerce_purchase_order_lines"("organizationId", "externalLineId");

-- CreateIndex
CREATE INDEX "facility_inventory_snapshots_organizationId_externalFacilit_idx" ON "public"."facility_inventory_snapshots"("organizationId", "externalFacilityId", "productVariantId", "snapshotAt");

-- CreateIndex
CREATE INDEX "facility_inventory_snapshots_organizationId_externalSku_sna_idx" ON "public"."facility_inventory_snapshots"("organizationId", "externalSku", "snapshotAt");

-- CreateIndex
CREATE INDEX "demand_forecasts_organizationId_periodStart_idx" ON "public"."demand_forecasts"("organizationId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "demand_forecasts_organizationId_productVariantId_externalFa_key" ON "public"."demand_forecasts"("organizationId", "productVariantId", "externalFacilityId", "periodStart", "method");

-- CreateIndex
CREATE INDEX "replenishment_suggestions_organizationId_status_createdAt_idx" ON "public"."replenishment_suggestions"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "replenishment_suggestions_productVariantId_idx" ON "public"."replenishment_suggestions"("productVariantId");

-- CreateIndex
CREATE INDEX "alert_rules_organizationId_alertType_isEnabled_idx" ON "public"."alert_rules"("organizationId", "alertType", "isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "alert_rules_organizationId_code_key" ON "public"."alert_rules"("organizationId", "code");

-- CreateIndex
CREATE INDEX "notifications_organizationId_recipientUserId_status_idx" ON "public"."notifications"("organizationId", "recipientUserId", "status");

-- CreateIndex
CREATE INDEX "notifications_organizationId_createdAt_idx" ON "public"."notifications"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_organizationId_dedupeKey_key" ON "public"."notifications"("organizationId", "dedupeKey");

-- CreateIndex
CREATE INDEX "approval_rules_organizationId_subjectType_isEnabled_idx" ON "public"."approval_rules"("organizationId", "subjectType", "isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "approval_rules_organizationId_code_key" ON "public"."approval_rules"("organizationId", "code");

-- CreateIndex
CREATE INDEX "approval_requests_organizationId_status_subjectType_idx" ON "public"."approval_requests"("organizationId", "status", "subjectType");

-- CreateIndex
CREATE INDEX "approval_requests_subjectType_subjectId_idx" ON "public"."approval_requests"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "document_attachments_organizationId_entityType_entityId_idx" ON "public"."document_attachments"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "saved_views_organizationId_resource_idx" ON "public"."saved_views"("organizationId", "resource");

-- CreateIndex
CREATE UNIQUE INDEX "saved_views_organizationId_ownerUserId_resource_name_key" ON "public"."saved_views"("organizationId", "ownerUserId", "resource", "name");

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."roles" ADD CONSTRAINT "roles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "public"."permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."number_sequences" ADD CONSTRAINT "number_sequences_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."products" ADD CONSTRAINT "products_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."products" ADD CONSTRAINT "products_defaultRouteId_fkey" FOREIGN KEY ("defaultRouteId") REFERENCES "public"."production_routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."product_variants" ADD CONSTRAINT "product_variants_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."product_variants" ADD CONSTRAINT "product_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."product_variants" ADD CONSTRAINT "product_variants_activeBomVersionId_fkey" FOREIGN KEY ("activeBomVersionId") REFERENCES "public"."bom_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."external_product_mappings" ADD CONSTRAINT "external_product_mappings_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "public"."product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."product_sync_issues" ADD CONSTRAINT "product_sync_issues_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "public"."product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."uom_conversions" ADD CONSTRAINT "uom_conversions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."uom_conversions" ADD CONSTRAINT "uom_conversions_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "public"."raw_materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."raw_materials" ADD CONSTRAINT "raw_materials_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."raw_materials" ADD CONSTRAINT "raw_materials_defaultSupplierId_fkey" FOREIGN KEY ("defaultSupplierId") REFERENCES "public"."suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."raw_materials" ADD CONSTRAINT "raw_materials_defaultLocationId_fkey" FOREIGN KEY ("defaultLocationId") REFERENCES "public"."material_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_lots" ADD CONSTRAINT "material_lots_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "public"."raw_materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_lots" ADD CONSTRAINT "material_lots_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "public"."suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_lots" ADD CONSTRAINT "material_lots_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "public"."raw_material_receipt_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_locations" ADD CONSTRAINT "material_locations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_locations" ADD CONSTRAINT "material_locations_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."material_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_locations" ADD CONSTRAINT "material_locations_jobWorkerId_fkey" FOREIGN KEY ("jobWorkerId") REFERENCES "public"."job_workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_balances" ADD CONSTRAINT "material_balances_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "public"."raw_materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_balances" ADD CONSTRAINT "material_balances_materialLotId_fkey" FOREIGN KEY ("materialLotId") REFERENCES "public"."material_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_balances" ADD CONSTRAINT "material_balances_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "public"."material_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_movements" ADD CONSTRAINT "material_movements_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "public"."raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_movements" ADD CONSTRAINT "material_movements_materialLotId_fkey" FOREIGN KEY ("materialLotId") REFERENCES "public"."material_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_movements" ADD CONSTRAINT "material_movements_fabricRollId_fkey" FOREIGN KEY ("fabricRollId") REFERENCES "public"."fabric_rolls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_movements" ADD CONSTRAINT "material_movements_sourceLocationId_fkey" FOREIGN KEY ("sourceLocationId") REFERENCES "public"."material_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_movements" ADD CONSTRAINT "material_movements_destinationLocationId_fkey" FOREIGN KEY ("destinationLocationId") REFERENCES "public"."material_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_movements" ADD CONSTRAINT "material_movements_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "public"."material_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_reservations" ADD CONSTRAINT "material_reservations_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "public"."raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_reservations" ADD CONSTRAINT "material_reservations_materialLotId_fkey" FOREIGN KEY ("materialLotId") REFERENCES "public"."material_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_reservations" ADD CONSTRAINT "material_reservations_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "public"."material_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_reservations" ADD CONSTRAINT "material_reservations_manufacturingOrderId_fkey" FOREIGN KEY ("manufacturingOrderId") REFERENCES "public"."manufacturing_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_reservations" ADD CONSTRAINT "material_reservations_materialRequirementId_fkey" FOREIGN KEY ("materialRequirementId") REFERENCES "public"."material_requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_counts" ADD CONSTRAINT "stock_counts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "public"."material_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_count_lines" ADD CONSTRAINT "stock_count_lines_stockCountId_fkey" FOREIGN KEY ("stockCountId") REFERENCES "public"."stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_count_lines" ADD CONSTRAINT "stock_count_lines_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "public"."raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."suppliers" ADD CONSTRAINT "suppliers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_mrpRunId_fkey" FOREIGN KEY ("mrpRunId") REFERENCES "public"."mrp_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_requisition_items" ADD CONSTRAINT "purchase_requisition_items_purchaseRequisitionId_fkey" FOREIGN KEY ("purchaseRequisitionId") REFERENCES "public"."purchase_requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_requisition_items" ADD CONSTRAINT "purchase_requisition_items_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "public"."raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_requisition_items" ADD CONSTRAINT "purchase_requisition_items_suggestedSupplierId_fkey" FOREIGN KEY ("suggestedSupplierId") REFERENCES "public"."suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_requisition_items" ADD CONSTRAINT "purchase_requisition_items_materialRequirementId_fkey" FOREIGN KEY ("materialRequirementId") REFERENCES "public"."material_requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."raw_material_purchase_orders" ADD CONSTRAINT "raw_material_purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "public"."suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."raw_material_purchase_items" ADD CONSTRAINT "raw_material_purchase_items_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."raw_material_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."raw_material_purchase_items" ADD CONSTRAINT "raw_material_purchase_items_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "public"."raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."raw_material_purchase_items" ADD CONSTRAINT "raw_material_purchase_items_requisitionItemId_fkey" FOREIGN KEY ("requisitionItemId") REFERENCES "public"."purchase_requisition_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."raw_material_receipts" ADD CONSTRAINT "raw_material_receipts_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."raw_material_purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."raw_material_receipts" ADD CONSTRAINT "raw_material_receipts_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "public"."suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."raw_material_receipts" ADD CONSTRAINT "raw_material_receipts_targetLocationId_fkey" FOREIGN KEY ("targetLocationId") REFERENCES "public"."material_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."raw_material_receipt_lines" ADD CONSTRAINT "raw_material_receipt_lines_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "public"."raw_material_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."raw_material_receipt_lines" ADD CONSTRAINT "raw_material_receipt_lines_purchaseItemId_fkey" FOREIGN KEY ("purchaseItemId") REFERENCES "public"."raw_material_purchase_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."raw_material_receipt_lines" ADD CONSTRAINT "raw_material_receipt_lines_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "public"."raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."boms" ADD CONSTRAINT "boms_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."boms" ADD CONSTRAINT "boms_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."boms" ADD CONSTRAINT "boms_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "public"."product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."bom_versions" ADD CONSTRAINT "bom_versions_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "public"."boms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."bom_versions" ADD CONSTRAINT "bom_versions_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "public"."bom_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."bom_items" ADD CONSTRAINT "bom_items_bomVersionId_fkey" FOREIGN KEY ("bomVersionId") REFERENCES "public"."bom_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."bom_items" ADD CONSTRAINT "bom_items_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "public"."raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."bom_items" ADD CONSTRAINT "bom_items_productionStageId_fkey" FOREIGN KEY ("productionStageId") REFERENCES "public"."production_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."bom_item_alternatives" ADD CONSTRAINT "bom_item_alternatives_bomItemId_fkey" FOREIGN KEY ("bomItemId") REFERENCES "public"."bom_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."bom_item_alternatives" ADD CONSTRAINT "bom_item_alternatives_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "public"."raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."bom_item_size_overrides" ADD CONSTRAINT "bom_item_size_overrides_bomItemId_fkey" FOREIGN KEY ("bomItemId") REFERENCES "public"."bom_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_requirements" ADD CONSTRAINT "material_requirements_mrpRunId_fkey" FOREIGN KEY ("mrpRunId") REFERENCES "public"."mrp_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_requirements" ADD CONSTRAINT "material_requirements_manufacturingOrderId_fkey" FOREIGN KEY ("manufacturingOrderId") REFERENCES "public"."manufacturing_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_requirements" ADD CONSTRAINT "material_requirements_bomVersionId_fkey" FOREIGN KEY ("bomVersionId") REFERENCES "public"."bom_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_requirements" ADD CONSTRAINT "material_requirements_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "public"."raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."manufacturing_demand" ADD CONSTRAINT "manufacturing_demand_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."manufacturing_demand" ADD CONSTRAINT "manufacturing_demand_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "public"."product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."manufacturing_demand" ADD CONSTRAINT "manufacturing_demand_destinationFacilityId_fkey" FOREIGN KEY ("destinationFacilityId") REFERENCES "public"."external_facilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."demand_source_mappings" ADD CONSTRAINT "demand_source_mappings_manufacturingDemandId_fkey" FOREIGN KEY ("manufacturingDemandId") REFERENCES "public"."manufacturing_demand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."demand_allocations" ADD CONSTRAINT "demand_allocations_manufacturingDemandId_fkey" FOREIGN KEY ("manufacturingDemandId") REFERENCES "public"."manufacturing_demand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."demand_allocations" ADD CONSTRAINT "demand_allocations_manufacturingOrderId_fkey" FOREIGN KEY ("manufacturingOrderId") REFERENCES "public"."manufacturing_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."demand_allocations" ADD CONSTRAINT "demand_allocations_manufacturingOrderItemId_fkey" FOREIGN KEY ("manufacturingOrderItemId") REFERENCES "public"."manufacturing_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "public"."product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_bomVersionId_fkey" FOREIGN KEY ("bomVersionId") REFERENCES "public"."bom_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "public"."production_routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_destinationFacilityId_fkey" FOREIGN KEY ("destinationFacilityId") REFERENCES "public"."external_facilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_parentMoId_fkey" FOREIGN KEY ("parentMoId") REFERENCES "public"."manufacturing_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."manufacturing_order_items" ADD CONSTRAINT "manufacturing_order_items_manufacturingOrderId_fkey" FOREIGN KEY ("manufacturingOrderId") REFERENCES "public"."manufacturing_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."mo_bom_snapshot_lines" ADD CONSTRAINT "mo_bom_snapshot_lines_manufacturingOrderId_fkey" FOREIGN KEY ("manufacturingOrderId") REFERENCES "public"."manufacturing_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."mo_bom_snapshot_lines" ADD CONSTRAINT "mo_bom_snapshot_lines_bomVersionId_fkey" FOREIGN KEY ("bomVersionId") REFERENCES "public"."bom_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."production_stages" ADD CONSTRAINT "production_stages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."production_stages" ADD CONSTRAINT "production_stages_defaultLocationId_fkey" FOREIGN KEY ("defaultLocationId") REFERENCES "public"."material_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."production_routes" ADD CONSTRAINT "production_routes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."production_route_steps" ADD CONSTRAINT "production_route_steps_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "public"."production_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."production_route_steps" ADD CONSTRAINT "production_route_steps_productionStageId_fkey" FOREIGN KEY ("productionStageId") REFERENCES "public"."production_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."production_route_steps" ADD CONSTRAINT "production_route_steps_defaultJobWorkerId_fkey" FOREIGN KEY ("defaultJobWorkerId") REFERENCES "public"."job_workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."production_batches" ADD CONSTRAINT "production_batches_manufacturingOrderId_fkey" FOREIGN KEY ("manufacturingOrderId") REFERENCES "public"."manufacturing_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."production_batches" ADD CONSTRAINT "production_batches_manufacturingOrderItemId_fkey" FOREIGN KEY ("manufacturingOrderItemId") REFERENCES "public"."manufacturing_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."production_batches" ADD CONSTRAINT "production_batches_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "public"."production_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."production_batches" ADD CONSTRAINT "production_batches_parentBatchId_fkey" FOREIGN KEY ("parentBatchId") REFERENCES "public"."production_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."production_units" ADD CONSTRAINT "production_units_productionBatchId_fkey" FOREIGN KEY ("productionBatchId") REFERENCES "public"."production_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."production_stage_tasks" ADD CONSTRAINT "production_stage_tasks_productionBatchId_fkey" FOREIGN KEY ("productionBatchId") REFERENCES "public"."production_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."production_stage_tasks" ADD CONSTRAINT "production_stage_tasks_routeStepId_fkey" FOREIGN KEY ("routeStepId") REFERENCES "public"."production_route_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."production_stage_tasks" ADD CONSTRAINT "production_stage_tasks_productionStageId_fkey" FOREIGN KEY ("productionStageId") REFERENCES "public"."production_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."production_stage_tasks" ADD CONSTRAINT "production_stage_tasks_assignedJobWorkerId_fkey" FOREIGN KEY ("assignedJobWorkerId") REFERENCES "public"."job_workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."production_stage_movements" ADD CONSTRAINT "production_stage_movements_productionBatchId_fkey" FOREIGN KEY ("productionBatchId") REFERENCES "public"."production_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."production_stage_movements" ADD CONSTRAINT "production_stage_movements_productionUnitId_fkey" FOREIGN KEY ("productionUnitId") REFERENCES "public"."production_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."production_stage_movements" ADD CONSTRAINT "production_stage_movements_fromStageTaskId_fkey" FOREIGN KEY ("fromStageTaskId") REFERENCES "public"."production_stage_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."production_stage_movements" ADD CONSTRAINT "production_stage_movements_toStageTaskId_fkey" FOREIGN KEY ("toStageTaskId") REFERENCES "public"."production_stage_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."production_stage_movements" ADD CONSTRAINT "production_stage_movements_barcodeScanEventId_fkey" FOREIGN KEY ("barcodeScanEventId") REFERENCES "public"."barcode_scan_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."barcode_identifiers" ADD CONSTRAINT "barcode_identifiers_productionBatchId_fkey" FOREIGN KEY ("productionBatchId") REFERENCES "public"."production_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."barcode_identifiers" ADD CONSTRAINT "barcode_identifiers_productionUnitId_fkey" FOREIGN KEY ("productionUnitId") REFERENCES "public"."production_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."barcode_identifiers" ADD CONSTRAINT "barcode_identifiers_materialLotId_fkey" FOREIGN KEY ("materialLotId") REFERENCES "public"."material_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."barcode_identifiers" ADD CONSTRAINT "barcode_identifiers_fabricRollId_fkey" FOREIGN KEY ("fabricRollId") REFERENCES "public"."fabric_rolls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."barcode_identifiers" ADD CONSTRAINT "barcode_identifiers_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "public"."raw_material_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."barcode_identifiers" ADD CONSTRAINT "barcode_identifiers_finishedInwardId_fkey" FOREIGN KEY ("finishedInwardId") REFERENCES "public"."finished_goods_inwards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."barcode_scan_events" ADD CONSTRAINT "barcode_scan_events_barcodeIdentifierId_fkey" FOREIGN KEY ("barcodeIdentifierId") REFERENCES "public"."barcode_identifiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."barcode_scan_events" ADD CONSTRAINT "barcode_scan_events_productionBatchId_fkey" FOREIGN KEY ("productionBatchId") REFERENCES "public"."production_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."barcode_scan_events" ADD CONSTRAINT "barcode_scan_events_productionUnitId_fkey" FOREIGN KEY ("productionUnitId") REFERENCES "public"."production_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_issues" ADD CONSTRAINT "material_issues_manufacturingOrderId_fkey" FOREIGN KEY ("manufacturingOrderId") REFERENCES "public"."manufacturing_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_issues" ADD CONSTRAINT "material_issues_stageTaskId_fkey" FOREIGN KEY ("stageTaskId") REFERENCES "public"."production_stage_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_issues" ADD CONSTRAINT "material_issues_jobWorkOrderId_fkey" FOREIGN KEY ("jobWorkOrderId") REFERENCES "public"."job_work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_issues" ADD CONSTRAINT "material_issues_sourceLocationId_fkey" FOREIGN KEY ("sourceLocationId") REFERENCES "public"."material_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_issues" ADD CONSTRAINT "material_issues_destinationLocationId_fkey" FOREIGN KEY ("destinationLocationId") REFERENCES "public"."material_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_issue_lines" ADD CONSTRAINT "material_issue_lines_materialIssueId_fkey" FOREIGN KEY ("materialIssueId") REFERENCES "public"."material_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_issue_lines" ADD CONSTRAINT "material_issue_lines_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "public"."raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_issue_lines" ADD CONSTRAINT "material_issue_lines_materialLotId_fkey" FOREIGN KEY ("materialLotId") REFERENCES "public"."material_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_issue_lines" ADD CONSTRAINT "material_issue_lines_fabricRollId_fkey" FOREIGN KEY ("fabricRollId") REFERENCES "public"."fabric_rolls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_consumption" ADD CONSTRAINT "material_consumption_manufacturingOrderId_fkey" FOREIGN KEY ("manufacturingOrderId") REFERENCES "public"."manufacturing_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_consumption" ADD CONSTRAINT "material_consumption_productionBatchId_fkey" FOREIGN KEY ("productionBatchId") REFERENCES "public"."production_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_consumption" ADD CONSTRAINT "material_consumption_stageTaskId_fkey" FOREIGN KEY ("stageTaskId") REFERENCES "public"."production_stage_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_consumption" ADD CONSTRAINT "material_consumption_materialIssueLineId_fkey" FOREIGN KEY ("materialIssueLineId") REFERENCES "public"."material_issue_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_consumption" ADD CONSTRAINT "material_consumption_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "public"."raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_consumption" ADD CONSTRAINT "material_consumption_materialLotId_fkey" FOREIGN KEY ("materialLotId") REFERENCES "public"."material_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_consumption" ADD CONSTRAINT "material_consumption_fabricRollId_fkey" FOREIGN KEY ("fabricRollId") REFERENCES "public"."fabric_rolls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_consumption" ADD CONSTRAINT "material_consumption_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "public"."material_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cutting_orders" ADD CONSTRAINT "cutting_orders_manufacturingOrderId_fkey" FOREIGN KEY ("manufacturingOrderId") REFERENCES "public"."manufacturing_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cutting_orders" ADD CONSTRAINT "cutting_orders_productionBatchId_fkey" FOREIGN KEY ("productionBatchId") REFERENCES "public"."production_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cutting_orders" ADD CONSTRAINT "cutting_orders_fabricLotId_fkey" FOREIGN KEY ("fabricLotId") REFERENCES "public"."material_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cutting_orders" ADD CONSTRAINT "cutting_orders_fabricRollId_fkey" FOREIGN KEY ("fabricRollId") REFERENCES "public"."fabric_rolls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."job_workers" ADD CONSTRAINT "job_workers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."job_work_orders" ADD CONSTRAINT "job_work_orders_manufacturingOrderId_fkey" FOREIGN KEY ("manufacturingOrderId") REFERENCES "public"."manufacturing_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."job_work_orders" ADD CONSTRAINT "job_work_orders_jobWorkerId_fkey" FOREIGN KEY ("jobWorkerId") REFERENCES "public"."job_workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."job_work_orders" ADD CONSTRAINT "job_work_orders_productionStageId_fkey" FOREIGN KEY ("productionStageId") REFERENCES "public"."production_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."job_work_order_lines" ADD CONSTRAINT "job_work_order_lines_jobWorkOrderId_fkey" FOREIGN KEY ("jobWorkOrderId") REFERENCES "public"."job_work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."job_work_order_lines" ADD CONSTRAINT "job_work_order_lines_productionBatchId_fkey" FOREIGN KEY ("productionBatchId") REFERENCES "public"."production_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."quality_inspections" ADD CONSTRAINT "quality_inspections_manufacturingOrderId_fkey" FOREIGN KEY ("manufacturingOrderId") REFERENCES "public"."manufacturing_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."quality_inspections" ADD CONSTRAINT "quality_inspections_productionBatchId_fkey" FOREIGN KEY ("productionBatchId") REFERENCES "public"."production_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."quality_inspections" ADD CONSTRAINT "quality_inspections_productionUnitId_fkey" FOREIGN KEY ("productionUnitId") REFERENCES "public"."production_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."quality_inspections" ADD CONSTRAINT "quality_inspections_stageTaskId_fkey" FOREIGN KEY ("stageTaskId") REFERENCES "public"."production_stage_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."quality_inspections" ADD CONSTRAINT "quality_inspections_productionStageId_fkey" FOREIGN KEY ("productionStageId") REFERENCES "public"."production_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."quality_inspections" ADD CONSTRAINT "quality_inspections_reinspectionOfId_fkey" FOREIGN KEY ("reinspectionOfId") REFERENCES "public"."quality_inspections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."quality_defects" ADD CONSTRAINT "quality_defects_qualityInspectionId_fkey" FOREIGN KEY ("qualityInspectionId") REFERENCES "public"."quality_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."rework_orders" ADD CONSTRAINT "rework_orders_qualityInspectionId_fkey" FOREIGN KEY ("qualityInspectionId") REFERENCES "public"."quality_inspections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."rework_orders" ADD CONSTRAINT "rework_orders_productionBatchId_fkey" FOREIGN KEY ("productionBatchId") REFERENCES "public"."production_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."rework_orders" ADD CONSTRAINT "rework_orders_assignedJobWorkerId_fkey" FOREIGN KEY ("assignedJobWorkerId") REFERENCES "public"."job_workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."finished_goods_balances" ADD CONSTRAINT "finished_goods_balances_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "public"."product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."finished_goods_balances" ADD CONSTRAINT "finished_goods_balances_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "public"."material_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."finished_goods_movements" ADD CONSTRAINT "finished_goods_movements_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "public"."product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."finished_goods_inwards" ADD CONSTRAINT "finished_goods_inwards_manufacturingOrderId_fkey" FOREIGN KEY ("manufacturingOrderId") REFERENCES "public"."manufacturing_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."finished_goods_inwards" ADD CONSTRAINT "finished_goods_inwards_manufacturingLocationId_fkey" FOREIGN KEY ("manufacturingLocationId") REFERENCES "public"."material_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."finished_goods_inwards" ADD CONSTRAINT "finished_goods_inwards_destinationFacilityId_fkey" FOREIGN KEY ("destinationFacilityId") REFERENCES "public"."external_facilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."finished_goods_inward_lines" ADD CONSTRAINT "finished_goods_inward_lines_finishedInwardId_fkey" FOREIGN KEY ("finishedInwardId") REFERENCES "public"."finished_goods_inwards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."finished_goods_inward_lines" ADD CONSTRAINT "finished_goods_inward_lines_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "public"."product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."finished_goods_inward_lines" ADD CONSTRAINT "finished_goods_inward_lines_productionBatchId_fkey" FOREIGN KEY ("productionBatchId") REFERENCES "public"."production_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."external_facilities" ADD CONSTRAINT "external_facilities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_push_jobs" ADD CONSTRAINT "inventory_push_jobs_externalFacilityId_fkey" FOREIGN KEY ("externalFacilityId") REFERENCES "public"."external_facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_push_lines" ADD CONSTRAINT "inventory_push_lines_inventoryPushJobId_fkey" FOREIGN KEY ("inventoryPushJobId") REFERENCES "public"."inventory_push_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_push_lines" ADD CONSTRAINT "inventory_push_lines_finishedInwardLineId_fkey" FOREIGN KEY ("finishedInwardLineId") REFERENCES "public"."finished_goods_inward_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."external_inventory_reconciliations" ADD CONSTRAINT "external_inventory_reconciliations_externalFacilityId_fkey" FOREIGN KEY ("externalFacilityId") REFERENCES "public"."external_facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."external_inventory_reconciliations" ADD CONSTRAINT "external_inventory_reconciliations_inventoryPushJobId_fkey" FOREIGN KEY ("inventoryPushJobId") REFERENCES "public"."inventory_push_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."integration_connections" ADD CONSTRAINT "integration_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."integration_events" ADD CONSTRAINT "integration_events_integrationConnectionId_fkey" FOREIGN KEY ("integrationConnectionId") REFERENCES "public"."integration_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sync_logs" ADD CONSTRAINT "sync_logs_integrationConnectionId_fkey" FOREIGN KEY ("integrationConnectionId") REFERENCES "public"."integration_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."mo_cost_entries" ADD CONSTRAINT "mo_cost_entries_manufacturingOrderId_fkey" FOREIGN KEY ("manufacturingOrderId") REFERENCES "public"."manufacturing_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."fabric_rolls" ADD CONSTRAINT "fabric_rolls_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "public"."raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."fabric_rolls" ADD CONSTRAINT "fabric_rolls_materialLotId_fkey" FOREIGN KEY ("materialLotId") REFERENCES "public"."material_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."fabric_rolls" ADD CONSTRAINT "fabric_rolls_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "public"."material_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."fabric_rolls" ADD CONSTRAINT "fabric_rolls_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "public"."suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."fabric_rolls" ADD CONSTRAINT "fabric_rolls_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "public"."raw_material_receipt_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."product_bundle_components" ADD CONSTRAINT "product_bundle_components_bundleVariantId_fkey" FOREIGN KEY ("bundleVariantId") REFERENCES "public"."product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."product_bundle_components" ADD CONSTRAINT "product_bundle_components_componentVariantId_fkey" FOREIGN KEY ("componentVariantId") REFERENCES "public"."product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."shopify_order_lines" ADD CONSTRAINT "shopify_order_lines_shopifyOrderId_fkey" FOREIGN KEY ("shopifyOrderId") REFERENCES "public"."shopify_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."unicommerce_purchase_orders" ADD CONSTRAINT "unicommerce_purchase_orders_destinationFacilityId_fkey" FOREIGN KEY ("destinationFacilityId") REFERENCES "public"."external_facilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."unicommerce_purchase_order_lines" ADD CONSTRAINT "unicommerce_purchase_order_lines_unicommercePoId_fkey" FOREIGN KEY ("unicommercePoId") REFERENCES "public"."unicommerce_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."facility_inventory_snapshots" ADD CONSTRAINT "facility_inventory_snapshots_externalFacilityId_fkey" FOREIGN KEY ("externalFacilityId") REFERENCES "public"."external_facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."demand_forecasts" ADD CONSTRAINT "demand_forecasts_externalFacilityId_fkey" FOREIGN KEY ("externalFacilityId") REFERENCES "public"."external_facilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."replenishment_suggestions" ADD CONSTRAINT "replenishment_suggestions_externalFacilityId_fkey" FOREIGN KEY ("externalFacilityId") REFERENCES "public"."external_facilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_alertRuleId_fkey" FOREIGN KEY ("alertRuleId") REFERENCES "public"."alert_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."approval_requests" ADD CONSTRAINT "approval_requests_approvalRuleId_fkey" FOREIGN KEY ("approvalRuleId") REFERENCES "public"."approval_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

