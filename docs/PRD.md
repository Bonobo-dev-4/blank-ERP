# DASH AND DOT Manufacturing ERP — Product Requirements

**Status:** Phase 1 implemented and tested. Phases 2–6 specified, not built.
**Last updated:** 2026-10-21

---

## 1. What this system is

A manufacturing and inventory control platform for DASH AND DOT, a premium Indian
fashion brand. It connects commercial demand to the factory floor and back again:

```
Shopify order / Unicommerce bulk PO
  → product SKU
  → bill of materials
  → raw material lot / fabric roll
  → manufacturing job
  → barcode-scanned production stages
  → quality control
  → finished goods GRN
  → Unicommerce facility inventory
```

## 2. What this system is not

Shopify remains the commerce platform. Unicommerce remains the external warehouse
and order-operations platform. This ERP **integrates with** them and does not
replace them.

Explicitly out of scope:

| Not built | Owned by |
|---|---|
| Storefront, cart, checkout | Shopify |
| Payment capture, refunds | Shopify |
| Customer records, CRM, marketing | Shopify |
| Retail POS billing | Shopify POS |
| Shipping labels, courier allocation, manifests | Unicommerce |
| Outbound order fulfilment and picking | Unicommerce |
| Finance ledger, GST filing, payroll | Accounting system |

The ERP never captures a payment, never creates a shipment, and never changes a
Shopify fulfilment status. The one place it writes outward is finished goods
inventory into Unicommerce, and that path is gated by an explicit approval.

## 3. Why it exists

The problems this replaces are specific:

1. **Fabric cannot be traced.** A garment that fails QC cannot be tied back to the
   roll it was cut from, so a bad dye lot is discovered a batch at a time.
2. **Stock is a guess.** "Available" conflates material in the rack, material on
   the cutting floor, material in QC hold, and material already promised to
   another order. Planners promise the same 200 m twice.
3. **WIP is a guess.** Cutting says 100, stitching says 85, finishing says 60.
   Nobody can say how many garments exist, so delivery dates are fiction.
4. **Shortages are discovered at the cutting table.** There is no BOM explosion
   against real stock, so a shortage surfaces when a cutter opens the rack.
5. **Demand arrives twice.** The same order reaches the factory through Shopify
   and through Unicommerce and gets made twice.
6. **External inventory drifts.** Finished goods are pushed to Unicommerce by
   hand; a timeout gets retried and the quantity is credited twice.

Every one of these is a *correctness* problem, not a reporting problem. That is
why the architecture is built around an append-only ledger with checkable
invariants rather than around screens.

## 4. Users

| Role | What they do here | Volume |
|---|---|---|
| Production Head | Releases orders, approves exceptions, watches bottlenecks | Daily |
| Production Planner | Runs MRP, plans batches, assigns work | Hourly |
| Purchase Manager | Raises and approves POs, chases suppliers | Daily |
| Raw Material Manager | Receives, inspects, issues, counts stock | Continuous |
| Warehouse Executive | Receives deliveries, issues material, inwards FG | Continuous |
| Stage Supervisors (cutting, embroidery, stitching, finishing) | Record stage completion, assign job workers | Continuous |
| QC Executive | Inspects, raises rework, gives final approval | Continuous |
| Barcode Operator | Scans at a stage. Nothing else. | Continuous |
| Job Worker Coordinator | Issues and receives job work, tracks delays | Daily |
| Finance / Management Viewer | Reads costing and analytics | Weekly |

The **Barcode Operator** role shapes a lot of the design. A shared terminal on a
stitching floor is the least physically secure device in the building, so it
holds the least authority: scan, record stage quantities, look things up. No
adjustments, no approvals, no pushes.

## 5. Functional scope by phase

### Phase 1 — Foundation *(implemented)*

- Authentication: email/password for staff, employee code + PIN for shop floor
- Role-based access with 69 permissions across 15 roles, enforced server-side
- Product master: styles, colour × size SKU matrix, bundles, external SKU mappings
- Raw material master with explicit unit-conversion configuration
- Fabric roll management: per-roll identity, length, shade, width, barcode
- Stock locations: warehouse → room → rack → bin, department floors, virtual accounts
- Append-only material ledger with strict double entry
- Supplier master, purchase requisitions, purchase orders with receipt tolerance
- Goods receipt → QC hold → inspection → release, with per-roll rejection
- Barcode generation and label printing (Code 128 / QR, 70 × 37 mm stock)
- Live inventory alerts, audit log, document numbering

### Phase 2 — Planning

- BOM with style, colour, size and variant levels; versioning and approval
- Size-wise consumption, wastage allowances, alternative materials
- MRP: explosion against real stock, shortage, incoming supply, purchase suggestions
- Material reservations pinned to lot and location
- Manufacturing orders with a frozen BOM and cost snapshot
- Production planning, capacity, batch creation and splitting

### Phase 3 — Shop floor

- Barcode batch and unit serialisation
- Scan station with stage validation and idempotent submission
- Cutting (fabric issue, cut plan, actual consumption, wastage)
- Embroidery, stitching, washing, finishing — internal and job work
- Quality control, defect capture, rework loops, reinspection

### Phase 4 — Demand

- Shopify online, POS and custom order import
- Facility-level stock availability checks with timestamped snapshots
- Only uncovered quantity becomes manufacturing demand
- Unicommerce bulk PO import
- Cross-system demand deduplication

### Phase 5 — Finished goods and external inventory

- Finished goods inward (partial supported), bounded by QC-approved quantity
- Internal GRN, finished goods ledger
- Unicommerce inventory push with preview, approval, retry and reconciliation

### Phase 6 — Intelligence

- Rule-based forecasting and replenishment suggestions
- Configurable alerts across in-app, email and WhatsApp
- Manufacturing costing: planned vs actual, cost per accepted unit
- Production analytics, bottleneck and wastage analysis

## 6. The invariants

These are the product requirements that matter most, because violating any of
them silently corrupts data that people make decisions on. Each is enforced in
three places: pure domain logic, service transactions, and database constraints.

| # | Invariant | Where enforced |
|---|---|---|
| 1 | No stock balance changes without a ledger movement | `LedgerService` is the only writer |
| 2 | Signed balances for a material sum to exactly zero | `assertLedgerBalanced`, strict double entry |
| 3 | Material cannot be deducted twice as it moves through stages | ISSUE transfers, CONSUMPTION retires — separate operations |
| 4 | Consumption cannot exceed what was issued to that department | `mil_returned_consumed_within_issued` |
| 5 | A roll cannot hold more than it was received with | `fr_current_within_original` |
| 6 | Roll lengths reconcile against the ledger | `reconcileRollLengths` |
| 7 | Received stock is not issuable until inspected | `PURCHASE_INWARD` may only credit QUALITY_HOLD |
| 8 | Accepted + rejected = received, exactly | `assertInspectionSplit` |
| 9 | A PO is not closed by a short delivery | `assessPoClosure`, manual close requires a reason |
| 10 | A released order keeps its BOM version and cost snapshot | `MoBomSnapshotLine`, written once |
| 11 | Quantity cannot advance past the previous stage's accepted quantity | `pst_forwarded_within_completed` |
| 12 | Stage outcomes cannot exceed what the stage received | `pst_outcomes_within_received` |
| 13 | Quantities are never summed across stages | `computeBatchProgress` reads route endpoints |
| 14 | A garment reworked twice is still one garment | Cumulative sent/returned counters |
| 15 | QC verdict must account for every garment inspected | `planQcVerdict` |
| 16 | Rejected garments cannot become sellable | Only `passedQty` is sellable; `pb_inwarded_within_qc_passed` |
| 17 | Inward cannot exceed QC-approved-not-yet-inwarded | `eligibleInwardQty` |
| 18 | External inventory cannot be credited twice | `fgil_pushed_within_accepted`, external request id |
| 19 | HTTP 200 is not success | `classifyPushOutcome` reads the business response |
| 20 | A timeout is not a failure | → `RECONCILIATION_REQUIRED`, no blind retry |
| 21 | The same demand from two systems is one demand | `demandFingerprint`, unique index |
| 22 | A replayed request is a no-op | `IdempotencyRecord` + unique keys on ledger rows |
| 23 | Every stock and production operation is auditable | `AuditLog` written in the same transaction |

## 7. Non-functional requirements

**Correctness over everything.** Decimal arithmetic throughout; floating point is
never used for a quantity or a cost. A JSON number is an IEEE-754 double, so
quantities cross the wire as decimal strings.

**Concurrency.** Two supervisors forwarding the same batch, two storekeepers
issuing the same fabric: balance rows are locked before they are read, in a
deterministic order.

**Shop-floor reality.** Barcode terminals on factory wifi retry. Every mutation
that touches stock or production quantity requires a client-supplied idempotency
key.

**Honest UI.** No dummy buttons. 42 planned routes render as disabled sidebar
items with their phase, and the dashboard reports `available: false` for modules
that do not exist rather than showing a zero that reads as a measurement.

**Failure recovery.** An uncertain external posting is a first-class state, not
an error to be retried.

## 8. Acceptance criteria status

Against the 20 criteria in the specification:

| # | Criterion | Status |
|---|---|---|
| 1 | Raw materials can be received and scanned | **Done** |
| 2 | Fabric rolls tracked individually | **Done** |
| 3 | BOMs calculate requirements correctly | Domain logic done & tested; UI phase 2 |
| 4 | Demand imported from Shopify and Unicommerce | Phase 4 |
| 5 | Each Shopify line shows facility-level availability | Domain logic done & tested; connector phase 4 |
| 6 | Only uncovered quantities generate demand | Domain logic done & tested; phase 4 |
| 7 | Each manufacturing job has a unique traceable reference | Schema + numbering done; UI phase 2 |
| 8 | Batches and units have unique barcodes | Code generation done & tested; phase 3 |
| 9 | Scans update stage records accurately | Domain logic done & tested; phase 3 |
| 10 | Stage quantities reconcile | Domain logic done & tested; phase 3 |
| 11 | Rejected units cannot become sellable | Domain + DB constraint done |
| 12 | Partial finished goods inward supported | Domain logic done & tested; phase 5 |
| 13 | FG receipts link back to source lines | Schema done; phase 5 |
| 14 | Approved inward posts to the correct facility | Domain logic done & tested; phase 5 |
| 15 | Duplicate external credits prevented | Domain + DB constraint done |
| 16 | Reports show actual database values | **Done** for built modules |
| 17 | Approval rules enforced | PO and requisition approvals **done**; matrix seeded |
| 18 | API failures safely recoverable | Domain logic done & tested; phase 5 |
| 19 | Every stock operation auditable | **Done** |
| 20 | Automated tests cover critical workflows | **Done** — 255 domain, 26 contract, 31 end-to-end |

## 9. Deliberate deviations from the specification

| Deviation | Reason |
|---|---|
| Product Master and SKU Mappings added under Administration | The V3 sidebar has no entry for them, but they are referenced by Orders, BOM and Production. Unreachable master data is worse than an extra menu item. |
| `PRODUCTION_FLOOR` location kind added | The spec lists "Issued to Production" as a distinct stock status. Modelling department floors as ordinary physical locations made issued material count as available — found by an end-to-end test. |
| Per-roll rejection required at inspection | "10 m rejected" cannot be applied without knowing which roll. Guessing would make roll lengths disagree with the ledger. |
| Average cost derived from lot costs, not accumulated | An incremental running average is diluted by stock sitting in QC hold at a cost of zero. |
| Every movement cites a lot, including untracked materials | A single implicit `GENERAL` lot per material keeps the ledger shape uniform and makes lot-level costing possible everywhere. |
| No seeded stock or production records | The spec forbids mock production transactions, and seeded stock would make every dashboard figure a fiction. |

See [decisions.md](decisions.md) for the full reasoning on each.
