-- =============================================================================
-- INVARIANT CONSTRAINTS
-- -----------------------------------------------------------------------------
-- These are the business invariants from docs/inventory-accounting.md and
-- docs/production-workflows.md expressed at the storage layer. Service code
-- checks them first (to return a useful error), but these constraints are the
-- last line of defence: a bug, a manual SQL fix or a future code path cannot
-- corrupt stock or production quantities while they exist.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- MATERIAL LEDGER
-- ---------------------------------------------------------------------------

-- Every ledger row moves a strictly positive quantity. Direction is expressed
-- by source/destination, never by a negative number.
ALTER TABLE "material_movements"
  ADD CONSTRAINT "mm_base_qty_positive" CHECK ("baseQty" > 0),
  ADD CONSTRAINT "mm_entered_qty_positive" CHECK ("enteredQty" > 0),
  -- Strict double entry: a movement must actually move somewhere.
  ADD CONSTRAINT "mm_source_ne_destination"
    CHECK ("sourceLocationId" <> "destinationLocationId");

-- Reserved stock can never be negative, and when present can never exceed the
-- quantity physically on hand at that exact (material, lot, location).
-- The "reservedQty = 0" branch allows virtual counter-account rows, whose
-- onHandQty is legitimately negative.
ALTER TABLE "material_balances"
  ADD CONSTRAINT "mb_reserved_non_negative" CHECK ("reservedQty" >= 0),
  ADD CONSTRAINT "mb_reserved_within_on_hand"
    CHECK ("reservedQty" = 0 OR "reservedQty" <= "onHandQty");

ALTER TABLE "material_reservations"
  ADD CONSTRAINT "mr_qty_positive" CHECK ("reservedQty" > 0),
  ADD CONSTRAINT "mr_consumed_within_reserved"
    CHECK ("issuedQty" >= 0 AND "releasedQty" >= 0
           AND "issuedQty" + "releasedQty" <= "reservedQty");

ALTER TABLE "material_issue_lines"
  ADD CONSTRAINT "mil_qty_positive" CHECK ("issuedBaseQty" > 0),
  -- Material returned plus material consumed can never exceed what was issued.
  ADD CONSTRAINT "mil_returned_consumed_within_issued"
    CHECK ("returnedBaseQty" >= 0 AND "consumedBaseQty" >= 0
           AND "returnedBaseQty" + "consumedBaseQty" <= "issuedBaseQty");

ALTER TABLE "material_consumption"
  ADD CONSTRAINT "mc_qty_non_negative"
    CHECK ("consumedBaseQty" >= 0 AND "wastageBaseQty" >= 0),
  ADD CONSTRAINT "mc_qty_not_both_zero"
    CHECK ("consumedBaseQty" + "wastageBaseQty" > 0);

-- ---------------------------------------------------------------------------
-- FABRIC ROLLS
-- ---------------------------------------------------------------------------

ALTER TABLE "fabric_rolls"
  ADD CONSTRAINT "fr_original_length_positive" CHECK ("originalLength" > 0),
  -- A roll can never hold more fabric than it was received with, nor less
  -- than nothing: partial issues and returns both land inside this band.
  ADD CONSTRAINT "fr_current_within_original"
    CHECK ("currentLength" >= 0 AND "currentLength" <= "originalLength"),
  ADD CONSTRAINT "fr_reserved_within_current"
    CHECK ("reservedLength" >= 0 AND "reservedLength" <= "currentLength");

-- ---------------------------------------------------------------------------
-- PURCHASING
-- ---------------------------------------------------------------------------

ALTER TABLE "raw_material_purchase_items"
  ADD CONSTRAINT "rmpi_ordered_positive" CHECK ("orderedQty" > 0 AND "orderedBaseQty" > 0),
  ADD CONSTRAINT "rmpi_received_non_negative" CHECK ("receivedBaseQty" >= 0),
  -- Inspection splits the received quantity; it cannot invent quantity.
  ADD CONSTRAINT "rmpi_inspection_within_received"
    CHECK ("acceptedBaseQty" >= 0 AND "rejectedBaseQty" >= 0
           AND "acceptedBaseQty" + "rejectedBaseQty" <= "receivedBaseQty");

ALTER TABLE "raw_material_receipt_lines"
  ADD CONSTRAINT "rmrl_received_positive" CHECK ("receivedQty" > 0 AND "receivedBaseQty" > 0),
  ADD CONSTRAINT "rmrl_inspection_within_received"
    CHECK ("acceptedBaseQty" >= 0 AND "rejectedBaseQty" >= 0
           AND "acceptedBaseQty" + "rejectedBaseQty" <= "receivedBaseQty");

ALTER TABLE "raw_material_purchase_orders"
  ADD CONSTRAINT "rmpo_tolerance_sane"
    CHECK ("overReceiptTolerancePct" >= 0 AND "overReceiptTolerancePct" <= 100
           AND "underReceiptTolerancePct" >= 0 AND "underReceiptTolerancePct" <= 100);

-- ---------------------------------------------------------------------------
-- BOM
-- ---------------------------------------------------------------------------

ALTER TABLE "bom_items"
  ADD CONSTRAINT "bi_consumption_positive" CHECK ("consumptionQty" > 0),
  ADD CONSTRAINT "bi_wastage_non_negative" CHECK ("wastageValue" >= 0);

ALTER TABLE "bom_item_size_overrides"
  ADD CONSTRAINT "biso_consumption_positive" CHECK ("consumptionQty" > 0);

ALTER TABLE "bom_versions"
  ADD CONSTRAINT "bv_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "bv_base_quantity_positive" CHECK ("baseQuantity" > 0);

-- Exactly one style-level BOM per product. A plain UNIQUE cannot express this
-- because NULL productVariantId never collides in Postgres.
CREATE UNIQUE INDEX "boms_one_style_level_per_product"
  ON "boms" ("organizationId", "productId")
  WHERE "productVariantId" IS NULL;

-- ---------------------------------------------------------------------------
-- MANUFACTURING ORDERS
-- ---------------------------------------------------------------------------

ALTER TABLE "manufacturing_orders"
  ADD CONSTRAINT "mo_ordered_positive" CHECK ("orderedQty" > 0),
  ADD CONSTRAINT "mo_quantities_non_negative"
    CHECK ("releasedQty" >= 0 AND "completedQty" >= 0 AND "rejectedQty" >= 0
           AND "inwardedQty" >= 0 AND "cancelledQty" >= 0),
  -- We control both release and cancellation, so together they are bounded by
  -- the ordered quantity.
  ADD CONSTRAINT "mo_released_plus_cancelled_within_ordered"
    CHECK ("releasedQty" + "cancelledQty" <= "orderedQty"),
  -- Inward can never exceed what production actually completed.
  ADD CONSTRAINT "mo_inwarded_within_completed" CHECK ("inwardedQty" <= "completedQty");

ALTER TABLE "manufacturing_order_items"
  ADD CONSTRAINT "moi_ordered_positive" CHECK ("orderedQty" > 0),
  ADD CONSTRAINT "moi_released_plus_cancelled_within_ordered"
    CHECK ("releasedQty" >= 0 AND "cancelledQty" >= 0
           AND "releasedQty" + "cancelledQty" <= "orderedQty"),
  ADD CONSTRAINT "moi_inwarded_within_completed"
    CHECK ("inwardedQty" >= 0 AND "inwardedQty" <= "completedQty");

ALTER TABLE "demand_allocations"
  ADD CONSTRAINT "da_allocated_positive" CHECK ("allocatedQty" > 0),
  ADD CONSTRAINT "da_fulfilled_within_allocated"
    CHECK ("fulfilledQty" >= 0 AND "fulfilledQty" <= "allocatedQty");

ALTER TABLE "manufacturing_demand"
  ADD CONSTRAINT "md_requested_positive" CHECK ("requestedQty" > 0),
  ADD CONSTRAINT "md_manufacturing_within_requested"
    CHECK ("manufacturingQty" >= 0 AND "manufacturingQty" <= "requestedQty"),
  ADD CONSTRAINT "md_allocated_within_manufacturing"
    CHECK ("allocatedQty" >= 0 AND "allocatedQty" <= "manufacturingQty");

-- ---------------------------------------------------------------------------
-- PRODUCTION STAGE QUANTITY LEDGER
-- This is the constraint set that makes "95 completed of 100, 5 rejected"
-- impossible to corrupt into "100 completed and 5 rejected".
-- ---------------------------------------------------------------------------

ALTER TABLE "production_batches"
  ADD CONSTRAINT "pb_planned_positive" CHECK ("plannedQty" > 0),
  ADD CONSTRAINT "pb_released_within_planned"
    CHECK ("releasedQty" >= 0 AND "releasedQty" <= "plannedQty"),
  ADD CONSTRAINT "pb_finished_within_released"
    CHECK ("finishedQty" >= 0 AND "finishedQty" <= "releasedQty"),
  -- QC can only pass what production finished.
  ADD CONSTRAINT "pb_qc_passed_within_finished"
    CHECK ("qcPassedQty" >= 0 AND "qcPassedQty" <= "finishedQty"),
  -- Finished goods inward can only draw on QC-passed quantity. This is the
  -- storage-level guarantee that a rejected garment cannot become sellable.
  ADD CONSTRAINT "pb_inwarded_within_qc_passed"
    CHECK ("inwardedQty" >= 0 AND "inwardedQty" <= "qcPassedQty");

ALTER TABLE "production_stage_tasks"
  ADD CONSTRAINT "pst_quantities_non_negative"
    CHECK ("plannedQty" >= 0 AND "receivedQty" >= 0 AND "completedQty" >= 0
           AND "rejectedQty" >= 0 AND "reworkSentQty" >= 0
           AND "reworkReturnedQty" >= 0 AND "forwardedQty" >= 0),
  -- Rework counters are cumulative; outstanding rework is sent minus returned,
  -- so a garment reworked twice is still one garment.
  ADD CONSTRAINT "pst_rework_returned_within_sent"
    CHECK ("reworkReturnedQty" <= "reworkSentQty"),
  -- A stage cannot dispose of more garments than it received. Quantity out in
  -- rework still belongs to the stage, so it counts against the received pool.
  ADD CONSTRAINT "pst_outcomes_within_received"
    CHECK ("completedQty" + "rejectedQty" + ("reworkSentQty" - "reworkReturnedQty")
           <= "receivedQty"),
  -- Quantity handed downstream can never exceed quantity completed here. This
  -- is the arithmetic form of "qty cannot advance beyond the accepted quantity
  -- at the preceding stage".
  ADD CONSTRAINT "pst_forwarded_within_completed"
    CHECK ("forwardedQty" <= "completedQty");

ALTER TABLE "production_stage_movements"
  ADD CONSTRAINT "psm_qty_positive" CHECK ("qty" > 0),
  -- A movement must have at least one end; a FORWARD must have both.
  ADD CONSTRAINT "psm_has_an_end"
    CHECK ("fromStageTaskId" IS NOT NULL OR "toStageTaskId" IS NOT NULL),
  ADD CONSTRAINT "psm_forward_has_both_ends"
    CHECK ("movementType" <> 'FORWARD'
           OR ("fromStageTaskId" IS NOT NULL AND "toStageTaskId" IS NOT NULL));

-- ---------------------------------------------------------------------------
-- QUALITY AND REWORK
-- ---------------------------------------------------------------------------

ALTER TABLE "quality_inspections"
  ADD CONSTRAINT "qi_inspected_positive" CHECK ("inspectedQty" > 0),
  -- The verdict split can never exceed the quantity inspected.
  ADD CONSTRAINT "qi_outcomes_within_inspected"
    CHECK ("passedQty" >= 0 AND "failedQty" >= 0 AND "reworkQty" >= 0 AND "holdQty" >= 0
           AND "passedQty" + "failedQty" + "reworkQty" + "holdQty" <= "inspectedQty");

ALTER TABLE "quality_defects"
  ADD CONSTRAINT "qd_qty_positive" CHECK ("qty" > 0);

ALTER TABLE "rework_orders"
  ADD CONSTRAINT "ro_qty_positive" CHECK ("qty" > 0),
  ADD CONSTRAINT "ro_outcomes_within_qty"
    CHECK ("completedQty" >= 0 AND "scrappedQty" >= 0
           AND "completedQty" + "scrappedQty" <= "qty");

-- ---------------------------------------------------------------------------
-- FINISHED GOODS AND EXTERNAL INVENTORY PUSH
-- ---------------------------------------------------------------------------

ALTER TABLE "finished_goods_balances"
  ADD CONSTRAINT "fgb_quantities_non_negative"
    CHECK ("onHandQty" >= 0 AND "pendingSyncQty" >= 0 AND "syncedQty" >= 0),
  ADD CONSTRAINT "fgb_sync_split_within_on_hand"
    CHECK ("pendingSyncQty" + "syncedQty" <= "onHandQty");

ALTER TABLE "finished_goods_movements"
  ADD CONSTRAINT "fgm_qty_positive" CHECK ("qty" > 0);

ALTER TABLE "finished_goods_inward_lines"
  ADD CONSTRAINT "fgil_accepted_positive" CHECK ("acceptedQty" > 0),
  ADD CONSTRAINT "fgil_rejected_non_negative" CHECK ("rejectedQty" >= 0),
  -- The guard against double-crediting external inventory: the quantity
  -- successfully pushed can never exceed the quantity actually inwarded.
  ADD CONSTRAINT "fgil_pushed_within_accepted"
    CHECK ("pushedQty" >= 0 AND "pushedQty" <= "acceptedQty");

ALTER TABLE "inventory_push_jobs"
  ADD CONSTRAINT "ipj_quantities_non_negative"
    CHECK ("totalQty" >= 0 AND "successQty" >= 0 AND "failedQty" >= 0),
  ADD CONSTRAINT "ipj_outcomes_within_total"
    CHECK ("successQty" + "failedQty" <= "totalQty");

ALTER TABLE "inventory_push_lines"
  ADD CONSTRAINT "ipl_qty_positive" CHECK ("qty" > 0),
  ADD CONSTRAINT "ipl_accepted_within_qty"
    CHECK ("acceptedQty" >= 0 AND "acceptedQty" <= "qty");

-- At most one default facility per provider per organisation.
CREATE UNIQUE INDEX "external_facilities_one_default_per_provider"
  ON "external_facilities" ("organizationId", "provider")
  WHERE "isDefault" = true;

-- At most one primary external identifier per (variant, provider).
CREATE UNIQUE INDEX "external_product_mappings_one_primary_per_provider"
  ON "external_product_mappings" ("productVariantId", "provider")
  WHERE "isPrimary" = true;

-- ---------------------------------------------------------------------------
-- MASTER DATA SANITY
-- ---------------------------------------------------------------------------

ALTER TABLE "raw_materials"
  ADD CONSTRAINT "rm_thresholds_non_negative"
    CHECK ("minimumStock" >= 0 AND "reorderLevel" >= 0 AND "reorderQty" >= 0
           AND "leadTimeDays" >= 0 AND "averageCost" >= 0);

ALTER TABLE "uom_conversions"
  ADD CONSTRAINT "uc_factor_positive" CHECK ("factor" > 0),
  ADD CONSTRAINT "uc_from_ne_to" CHECK ("fromUom" <> "toUom");

ALTER TABLE "material_lots"
  ADD CONSTRAINT "ml_unit_cost_non_negative" CHECK ("unitCost" >= 0);

-- At most one implicit GENERAL lot per material (used by non-lot-tracked items).
CREATE UNIQUE INDEX "material_lots_one_general_per_material"
  ON "material_lots" ("rawMaterialId")
  WHERE "isGeneral" = true;

ALTER TABLE "product_bundle_components"
  ADD CONSTRAINT "pbc_qty_positive" CHECK ("qtyPerBundle" > 0),
  -- A bundle cannot contain itself.
  ADD CONSTRAINT "pbc_no_self_reference"
    CHECK ("bundleVariantId" <> "componentVariantId");

ALTER TABLE "production_route_steps"
  ADD CONSTRAINT "prs_sequence_positive" CHECK ("sequence" >= 1);

ALTER TABLE "number_sequences"
  ADD CONSTRAINT "ns_next_value_positive" CHECK ("nextValue" >= 1),
  ADD CONSTRAINT "ns_padding_sane" CHECK ("padding" BETWEEN 1 AND 18);
