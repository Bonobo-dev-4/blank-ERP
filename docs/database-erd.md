# Database ERD

**88 tables, 49 enums, 190 foreign keys, 307 indexes, 73 CHECK constraints.**
Postgres 16. Source of truth: `apps/api/prisma/schema.prisma`.

---

## 1. Precision conventions

Never floating point. A ledger that drifts by 1e-16 per movement eventually
reports negative stock.

| Concept | Column type | Example |
|---|---|---|
| Quantity | `NUMERIC(18,4)` | `262.5000` m |
| Rate / unit cost | `NUMERIC(18,6)` | `255.500000` per m |
| Money total | `NUMERIC(18,2)` | `64443.75` |
| Percentage | `NUMERIC(9,4)` | `5.0000` % |
| UOM conversion factor | `NUMERIC(18,8)` | `1.09361330` |

Primary keys are `uuid` throughout. Document numbers (`MOV-00000042`,
`GRN-000007`) are separate human-facing identifiers from gap-free per-organisation
counters, because operations staff quote those to each other.

## 2. Domain map

```
┌─ IDENTITY ──────────────────────────────────────────────────────────────┐
│ Organization  User  Role  Permission  RolePermission  UserRole          │
│ AuditLog  IdempotencyRecord  NumberSequence  SavedView                  │
└─────────────────────────────────────────────────────────────────────────┘

┌─ PRODUCT MASTER ────────────────────────────────────────────────────────┐
│ Product ──┬─> ProductVariant ──┬─> ExternalProductMapping              │
│           │                    ├─> ProductBundleComponent (self-ref)   │
│           │                    └─> ProductSyncIssue                    │
│           └─> Bom                                                       │
└─────────────────────────────────────────────────────────────────────────┘

┌─ RAW MATERIAL + THE LEDGER ─────────────────────────────────────────────┐
│ RawMaterial ──┬─> MaterialLot ──┬─> FabricRoll                          │
│               │                 ├─> MaterialBalance   (projection)      │
│               │                 └─> MaterialMovement  (append-only)     │
│               ├─> UomConversion                                         │
│               └─> MaterialReservation                                   │
│ MaterialLocation (self-ref tree; PHYSICAL…SINK…COUNTERPARTY)            │
│ MaterialIssue ─> MaterialIssueLine ─> MaterialConsumption               │
│ StockCount ─> StockCountLine                                            │
└─────────────────────────────────────────────────────────────────────────┘

┌─ PURCHASING ────────────────────────────────────────────────────────────┐
│ Supplier                                                                │
│ PurchaseRequisition ─> PurchaseRequisitionItem                          │
│ RawMaterialPurchaseOrder ─> RawMaterialPurchaseItem                     │
│ RawMaterialReceipt ─> RawMaterialReceiptLine ─> MaterialLot             │
└─────────────────────────────────────────────────────────────────────────┘

┌─ BOM + MRP ─────────────────────────────────────────────────────────────┐
│ Bom ─> BomVersion ─> BomItem ─┬─> BomItemAlternative                    │
│                               └─> BomItemSizeOverride                   │
│ MrpRun ─> MaterialRequirement ─> MaterialReservation                    │
└─────────────────────────────────────────────────────────────────────────┘

┌─ DEMAND ────────────────────────────────────────────────────────────────┐
│ ShopifyOrder ─> ShopifyOrderLine            (raw, verbatim)             │
│ UnicommercePurchaseOrder ─> …OrderLine      (raw, verbatim)             │
│ FacilityInventorySnapshot                   (timestamped evidence)      │
│ ManufacturingDemand ─┬─> DemandSourceMapping  (N sources → 1 demand)    │
│                      └─> DemandAllocation     (demand → MO)             │
└─────────────────────────────────────────────────────────────────────────┘

┌─ MANUFACTURING ─────────────────────────────────────────────────────────┐
│ ManufacturingOrder ─┬─> ManufacturingOrderItem ─> ProductionBatch       │
│                     ├─> MoBomSnapshotLine   (frozen at release)         │
│                     ├─> MoCostEntry                                     │
│                     ├─> CuttingOrder                                    │
│                     └─> JobWorkOrder ─> JobWorkOrderLine                │
│ ProductionRoute ─> ProductionRouteStep ─> ProductionStage               │
│ ProductionBatch ─┬─> ProductionStageTask ─> ProductionStageMovement     │
│                  └─> ProductionUnit                                     │
└─────────────────────────────────────────────────────────────────────────┘

┌─ BARCODES ──────────────────────────────────────────────────────────────┐
│ BarcodeIdentifier  (1:1 to lot / roll / batch / unit / receipt / inward)│
│ BarcodeScanEvent ─> ProductionStageMovement                             │
└─────────────────────────────────────────────────────────────────────────┘

┌─ QUALITY ───────────────────────────────────────────────────────────────┐
│ QualityInspection ─┬─> QualityDefect                                    │
│                    ├─> ReworkOrder                                      │
│                    └─> QualityInspection (reinspection self-ref)        │
└─────────────────────────────────────────────────────────────────────────┘

┌─ FINISHED GOODS + EXTERNAL SYNC ────────────────────────────────────────┐
│ FinishedGoodsInward ─> FinishedGoodsInwardLine ─> InventoryPushLine     │
│ FinishedGoodsBalance   FinishedGoodsMovement                            │
│ ExternalFacility ─> InventoryPushJob ─> InventoryPushLine               │
│ ExternalInventoryReconciliation                                         │
│ IntegrationConnection ─┬─> IntegrationEvent                             │
│                        └─> SyncLog                                      │
└─────────────────────────────────────────────────────────────────────────┘

┌─ INTELLIGENCE + GOVERNANCE ─────────────────────────────────────────────┐
│ DemandForecast  ReplenishmentSuggestion                                 │
│ AlertRule ─> Notification                                               │
│ ApprovalRule ─> ApprovalRequest                                         │
│ DocumentAttachment                                                      │
└─────────────────────────────────────────────────────────────────────────┘
```

## 3. The ledger tables in detail

### `material_movements` — append-only

The authoritative record. Never updated, never deleted; a correction is a new
reversing row (`reversalOfId`).

| Column | Notes |
|---|---|
| `movementNo` | `MOV-00000042`, unique per org |
| `movementType` | 16-value enum; the state machine |
| `rawMaterialId`, `materialLotId` | Both **NOT NULL** — every movement cites a lot |
| `fabricRollId` | Set for roll-level fabric movements |
| `sourceLocationId`, `destinationLocationId` | Both NOT NULL. Double entry. |
| `enteredQty` / `enteredUom` | As the operator typed it |
| `baseQty` / `baseUom` | Authoritative. Always `> 0`. |
| `unitCost`, `totalCost` | Lot cost at the time |
| `referenceType/Id/LineId/No` | The authorising document |
| `reason`, `remarks`, `operatorUserId` | Who and why |
| `idempotencyKey` | **Unique per org** — a replay is refused by the index |

### `material_balances` — projection

Exactly one row per `(rawMaterialId, materialLotId, locationId)`. Written only
inside the same transaction as the movement that caused the change, under a row
lock. Fully rebuildable from the ledger.

`onHandQty` is **signed**: counter-account rows are legitimately negative, which
is what makes the sum zero.

### `production_stage_tasks` — the production counters

One row per `(productionBatchId, routeStepId)`. All counters cumulative:
`receivedQty`, `completedQty`, `rejectedQty`, `reworkSentQty`,
`reworkReturnedQty`, `forwardedQty`.

### `production_stage_movements` — append-only

The production equivalent of the material ledger. `fromStageTaskId` /
`toStageTaskId` with a `FORWARD` requiring both.

## 4. Unique constraints that enforce business rules

These are not housekeeping; each one is a named requirement.

```sql
-- One canonical SKU per organisation
product_variants         UNIQUE (organizationId, sku)

-- External identity preserved and unambiguous
external_product_mappings UNIQUE (organizationId, provider, identifierKind, externalId)

-- One primary identifier per provider per variant  (partial)
external_product_mappings_one_primary_per_provider
  ON (productVariantId, provider) WHERE isPrimary

-- Exactly one implicit lot per material  (partial)
material_lots_one_general_per_material
  ON (rawMaterialId) WHERE isGeneral

-- One balance row per material / lot / location
material_balances        UNIQUE (rawMaterialId, materialLotId, locationId)

-- A replayed movement is refused
material_movements       UNIQUE (organizationId, idempotencyKey)

-- Exactly one style-level BOM per product  (partial)
boms_one_style_level_per_product
  ON (organizationId, productId) WHERE productVariantId IS NULL

-- Duplicate source-line import impossible
demand_source_mappings   UNIQUE (organizationId, sourceSystem, sourceDocType,
                                 sourceDocId, sourceLineId)

-- The same economic demand from two systems collapses to one row
manufacturing_demand     UNIQUE (organizationId, dedupeFingerprint)

-- Duplicate webhook delivery impossible
integration_events       UNIQUE (organizationId, provider, eventType, externalEventId)

-- External idempotency: one request id per push job
inventory_push_jobs      UNIQUE (organizationId, externalRequestId)

-- One inward line appears at most once per push job
inventory_push_lines     UNIQUE (inventoryPushJobId, finishedInwardLineId)

-- One default facility per provider  (partial)
external_facilities_one_default_per_provider
  ON (organizationId, provider) WHERE isDefault

-- One stage task per batch per route step
production_stage_tasks   UNIQUE (productionBatchId, routeStepId)

-- Request-level idempotency
idempotency_records      UNIQUE (organizationId, scope, key)
```

Note the four **partial** unique indexes. Each expresses a rule a plain `UNIQUE`
cannot, because a NULL never collides in Postgres — "exactly one style-level BOM
per product" would otherwise permit any number of them.

## 5. CHECK constraints

73 of them in `20261021000100_invariant_constraints`. Services check first to
return a useful error; these are the last line of defence.

Grouped by what they protect:

| Area | Constraints | Protects |
|---|---|---|
| Material ledger | 3 | Positive quantity, real movement direction |
| Balances & reservations | 5 | Cannot promise more than exists |
| Issue & consumption | 5 | Cannot consume or return more than issued |
| Fabric rolls | 3 | A roll cannot grow or go negative |
| Purchasing | 7 | Inspection cannot invent quantity; tolerances sane |
| BOM | 5 | Positive consumption, non-negative wastage |
| Manufacturing orders | 9 | Release, completion and inward bounded |
| Demand | 3 | Manufacturing ≤ requested; allocated ≤ manufacturing |
| Production batches | 5 | `inwarded ≤ qcPassed ≤ finished ≤ released ≤ planned` |
| Stage tasks | 4 | Outcomes ≤ received; forwarded ≤ completed |
| Stage movements | 3 | Positive quantity; a FORWARD has both ends |
| Quality & rework | 4 | Verdict split ≤ inspected |
| Finished goods | 6 | `pushedQty ≤ acceptedQty` |
| Inventory push | 4 | Accepted ≤ requested |
| Master data | 7 | Non-negative thresholds, positive factors, no self-referencing bundle |

The chain on `production_batches` is worth reading as one statement:

```sql
pb_released_within_planned     CHECK (releasedQty  <= plannedQty)
pb_finished_within_released    CHECK (finishedQty  <= releasedQty)
pb_qc_passed_within_finished   CHECK (qcPassedQty  <= finishedQty)
pb_inwarded_within_qc_passed   CHECK (inwardedQty  <= qcPassedQty)
```

Together: *a rejected garment cannot become sellable inventory*, guaranteed by
the storage layer rather than by application code remembering to check.

## 6. Indexing

307 indexes. The patterns:

- **Tenant-first composites** — `(organizationId, status, date)` on every list
  screen, because every query is organisation-scoped and then filtered.
- **Ledger traversal** — `(organizationId, rawMaterialId, occurredAt)` for
  movement history; `(referenceType, referenceId)` for "show me everything this
  GRN did".
- **Reservation lookup** — `(rawMaterialId, materialLotId, locationId, status)`,
  matching exactly the key the issue path resolves.
- **Operator productivity** — `(operatorUserId, scannedAt)` on scan events.
- **Sync diagnostics** — `(externalRequestId)` on sync logs, so an uncertain
  posting can be found by the id that was sent.

## 7. Multi-tenancy

Every business table carries `organizationId`, and every unique constraint is
scoped by it. `organizationId` is taken from the **verified JWT**, never from a
request parameter, which makes cross-organisation access unreachable by editing a
URL.

Single-tenant in practice today; the scoping costs nothing now and avoids a
migration later.

## 8. Migrations

```
20261021000000_init                      88 tables, 49 enums, 190 FKs, 307 indexes
20261021000100_invariant_constraints     73 CHECK constraints, 4 partial unique indexes
```

Generated offline with `prisma migrate diff`, so they can be produced and
reviewed without a running database. Verified three ways:

```bash
python3 scripts/verify-constraints.py       # 112 identifier references resolve
node scripts/apply-migrations-check.mjs     # both apply to a real PG engine
pnpm --filter @dnd/api prisma:deploy        # against your own database
```

## 9. Table reference

88 tables with their Prisma models:

| Prisma model | Table | Cols |
|---|---|---|
| AlertRule | `alert_rules` | 15 |
| ApprovalRequest | `approval_requests` | 17 |
| ApprovalRule | `approval_rules` | 12 |
| AuditLog | `audit_logs` | 13 |
| BarcodeIdentifier | `barcode_identifiers` | 25 |
| BarcodeScanEvent | `barcode_scan_events` | 26 |
| Bom | `boms` | 13 |
| BomItem | `bom_items` | 19 |
| BomItemAlternative | `bom_item_alternatives` | 8 |
| BomItemSizeOverride | `bom_item_size_overrides` | 5 |
| BomVersion | `bom_versions` | 24 |
| CuttingOrder | `cutting_orders` | 28 |
| DemandAllocation | `demand_allocations` | 12 |
| DemandForecast | `demand_forecasts` | 16 |
| DemandSourceMapping | `demand_source_mappings` | 15 |
| DocumentAttachment | `document_attachments` | 12 |
| ExternalFacility | `external_facilities` | 25 |
| ExternalInventoryReconciliation | `external_inventory_reconciliations` | 17 |
| ExternalProductMapping | `external_product_mappings` | 13 |
| FabricRoll | `fabric_rolls` | 35 |
| FacilityInventorySnapshot | `facility_inventory_snapshots` | 13 |
| FinishedGoodsBalance | `finished_goods_balances` | 11 |
| FinishedGoodsInward | `finished_goods_inwards` | 20 |
| FinishedGoodsInwardLine | `finished_goods_inward_lines` | 17 |
| FinishedGoodsMovement | `finished_goods_movements` | 18 |
| IdempotencyRecord | `idempotency_records` | 11 |
| IntegrationConnection | `integration_connections` | 18 |
| IntegrationEvent | `integration_events` | 15 |
| InventoryPushJob | `inventory_push_jobs` | 31 |
| InventoryPushLine | `inventory_push_lines` | 16 |
| JobWorkOrder | `job_work_orders` | 26 |
| JobWorkOrderLine | `job_work_order_lines` | 13 |
| JobWorker | `job_workers` | 24 |
| ManufacturingDemand | `manufacturing_demand` | 27 |
| ManufacturingOrder | `manufacturing_orders` | 65 |
| ManufacturingOrderItem | `manufacturing_order_items` | 18 |
| MaterialBalance | `material_balances` | 12 |
| MaterialConsumption | `material_consumption` | 28 |
| MaterialIssue | `material_issues` | 21 |
| MaterialIssueLine | `material_issue_lines` | 19 |
| MaterialLocation | `material_locations` | 30 |
| MaterialLot | `material_lots` | 28 |
| MaterialMovement | `material_movements` | 34 |
| MaterialRequirement | `material_requirements` | 27 |
| MaterialReservation | `material_reservations` | 20 |
| MoBomSnapshotLine | `mo_bom_snapshot_lines` | 18 |
| MoCostEntry | `mo_cost_entries` | 13 |
| MrpRun | `mrp_runs` | 15 |
| Notification | `notifications` | 20 |
| NumberSequence | `number_sequences` | 8 |
| Organization | `organizations` | 27 |
| Permission | `permissions` | 6 |
| Product | `products` | 20 |
| ProductBundleComponent | `product_bundle_components` | 12 |
| ProductSyncIssue | `product_sync_issues` | 13 |
| ProductVariant | `product_variants` | 31 |
| ProductionBatch | `production_batches` | 37 |
| ProductionRoute | `production_routes` | 14 |
| ProductionRouteStep | `production_route_steps` | 13 |
| ProductionStage | `production_stages` | 21 |
| ProductionStageMovement | `production_stage_movements` | 20 |
| ProductionStageTask | `production_stage_tasks` | 33 |
| ProductionUnit | `production_units` | 16 |
| PurchaseRequisition | `purchase_requisitions` | 15 |
| PurchaseRequisitionItem | `purchase_requisition_items` | 16 |
| QualityDefect | `quality_defects` | 12 |
| QualityInspection | `quality_inspections` | 32 |
| RawMaterial | `raw_materials` | 45 |
| RawMaterialPurchaseItem | `raw_material_purchase_items` | 21 |
| RawMaterialPurchaseOrder | `raw_material_purchase_orders` | 29 |
| RawMaterialReceipt | `raw_material_receipts` | 26 |
| RawMaterialReceiptLine | `raw_material_receipt_lines` | 24 |
| ReplenishmentSuggestion | `replenishment_suggestions` | 18 |
| ReworkOrder | `rework_orders` | 20 |
| Role | `roles` | 9 |
| RolePermission | `role_permissions` | 4 |
| SavedView | `saved_views` | 10 |
| ShopifyOrder | `shopify_orders` | 24 |
| ShopifyOrderLine | `shopify_order_lines` | 26 |
| StockCount | `stock_counts` | 14 |
| StockCountLine | `stock_count_lines` | 12 |
| Supplier | `suppliers` | 27 |
| SyncLog | `sync_logs` | 20 |
| UnicommercePurchaseOrder | `unicommerce_purchase_orders` | 20 |
| UnicommercePurchaseOrderLine | `unicommerce_purchase_order_lines` | 19 |
| UomConversion | `uom_conversions` | 11 |
| User | `users` | 13 |
| UserRole | `user_roles` | 4 |
