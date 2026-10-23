# Implementation Roadmap

**Phases 1, 2 and 3 complete. Phases 4–6 are specified with contracts and
schema in place; phases 4 and 5 are blocked on integration API verification.**

---

## 1. Where things stand

| Phase | Scope | Status |
|---|---|---|
| **1** | Auth, products, raw materials, fabric rolls, locations, stock ledger, POs, GRN | **Complete** |
| **2** | BOM, MRP, reservations, manufacturing orders | **Complete** — see §3 for what was deliberately left |
| **3** | Shop floor: batches, scanning, cutting, QC, rework, job work | **Complete** — all 5 exit criteria met; see §4 |
| 4 | Shopify orders, Unicommerce availability, demand routing, bulk PO, dedup | Domain logic done; **connectors need API verification first** |
| 5 | FG inward, GRN, Unicommerce push, reconciliation | Domain logic done; **needs API verification first** |
| 6 | Forecasting, alerts, costing, analytics, performance | Domain logic done; services and UI outstanding |

### Why so much domain logic already exists

Integration contracts and external identity mappings were built early, as the
specification asks. More usefully, the **arithmetic and invariants for every
phase** were written and tested up front:

- 88 tables cover all six phases
- 73 CHECK constraints protect invariants in modules that do not have screens yet
- 285 domain tests cover BOM explosion, MRP, the manufacturing order lifecycle,
  stage ledgers, QC verdicts, push classification and reconciliation

That ordering was deliberate. The hard part of this system is the quantity
arithmetic, and getting it right in isolation — where it can be exercised
exhaustively in a second — is far cheaper than discovering it is wrong through a
UI three phases later. What remains for phases 2–6 is mostly orchestration:
transactions, controllers and screens around logic that is already proven.

## 2. Phase 1 — complete

### Delivered

| Area | Detail |
|---|---|
| Workspace | pnpm monorepo, 4 projects, Docker Compose, Dockerfiles |
| Database | 88 tables, 49 enums, 190 FKs, 307 indexes, 73 CHECK constraints, 2 migrations |
| Domain | 20 modules, 255 tests |
| Contracts | Zod schemas, 69 permissions, 15 roles, navigation map |
| API | 60+ endpoints across 9 modules, OpenAPI at `/api/docs` |
| Auth | Password + PIN sign-in, global guards, tenant isolation |
| Product master | Styles, SKU matrix generation, bundles, external mappings, mapping-gap dashboard |
| Raw materials | Master, explicit UOM config, lots, hierarchical locations, suppliers |
| Fabric rolls | Per-roll identity, length math, shade control, selection, reconciliation |
| Ledger | Append-only, strict double entry, row locking, idempotency |
| Purchasing | Requisitions, POs with tolerance, GRN → QC hold → inspection → release |
| Barcodes | Minting for lots, rolls and receipts; label PDFs; reissue |
| UI | 25 screens, 42 honest placeholders, dark rail, compact tables |
| Verification | 255 unit + 31 end-to-end tests, 3 offline database checks |

### Not delivered in phase 1

- Stock counting UI (`StockCount` tables exist)
- Document attachments UI (`DocumentAttachment` exists)
- Excel import for products and materials (the API supports bulk; no file UI)
- Product images (object storage configured; no upload UI)

## 3. Phase 2 — complete

| # | Deliverable | Status |
|---|---|---|
| 2.1 | BOM CRUD + versioning service | **Done** — status machine, approval, supersession, clone |
| 2.2 | BOM builder UI | **Done** — line editor with live gross-per-unit, size overrides |
| 2.3 | Excel BOM import | **Not done** — `exceljs` is a dependency; no file UI |
| 2.4 | BOM comparison UI | **Done** — version diff on the BOM detail screen |
| 2.5 | MRP run service | **Done** — persists `MrpRun` + `MaterialRequirement` |
| 2.6 | MRP + shortage UI | **Done** — run detail, shortages, suggestions |
| 2.7 | Purchase suggestions → requisition | **Done** — raised from the run that produced them |
| 2.8 | Reservation service | **Done** — `allocateFromStock()` + `LedgerService.reserve()` |
| 2.9 | Manufacturing order service | **Done** — writes `MoBomSnapshotLine` at release |
| 2.10 | MO list + detail UI | **Done** — readiness, reservations, frozen snapshot |
| 2.11 | Production planning UI | **Not done** — calendar and capacity; the order list filters by priority and due date |
| 2.12 | Batch creation and splitting | **Deferred to phase 3** — batches are a shop-floor object |

### Delivered

| Area | Detail |
|---|---|
| Domain | `manufacturing/order-lifecycle` — status machine, release assessment, authorisation, rollup. 30 tests |
| Schema | +2 foreign keys closing referential gaps, +5 audit verbs (migration `20261022000000_phase2_relations`, additive only) |
| API | `bom`, `mrp`, `manufacturing` modules; 20+ endpoints |
| UI | 7 sidebar screens plus BOM detail, MRP run detail, MO detail and two create pages |
| Verification | 40 end-to-end tests covering all four exit criteria |

### The one thing that must not be got wrong

**2.9.** Releasing an order freezes the BOM version *and* copies its lines into
`MoBomSnapshotLine` in the same transaction. Everything downstream — costing,
wastage analysis, issue limits — reads the snapshot, not the master BOM. Get this
wrong and a BOM edit silently rewrites the history of orders already on the floor.

`ManufacturingService.release` does both inside one `inTransaction`, and the
end-to-end suite asserts it by approving a revised BOM and re-reading the
released order.

### Exit criteria — all met

| Criterion | Where it is asserted |
|---|---|
| A BOM explodes to the specification's figures through the UI | `phase2.e2e-spec.ts` "explodes to the specification figures", verified in the browser |
| An MRP run shows 262.5 required / 180 available / 82.5 short | `phase2.e2e-spec.ts` "reports 262.5 required / 180 available / 82.5 short" |
| An MO released with a shortage requires `manufacturing.release_with_shortage` | `phase2.e2e-spec.ts` "refuses a shortage release from a user without the permission" |
| Editing a BOM after release leaves the released order's snapshot unchanged | `phase2.e2e-spec.ts` "leaves the released order untouched when the BOM is revised" |

### Not delivered in phase 2

- Excel BOM import (2.3)
- Production planning calendar and capacity (2.11)
- Cross-order material allocation view — reserving and viewing reservations
  works per order; there is no single screen showing who holds what
- BOM alternatives are stored and validated but have no substitution UI

## 4. Phase 3 — complete

**Prerequisite: phase 2** (batches come from manufacturing orders). Met.

| # | Deliverable | Status |
|---|---|---|
| 3.1 | Batch barcode minting | **Done** — minted with the batch, in the same transaction |
| 3.2 | Unit serialisation service | **Done** — opt-in per batch; batches stay the default tracked unit |
| 3.3 | Stage transition service | **Done** — wraps all five `plan*` functions with row locks |
| 3.4 | **Scan station UI** | **Done** — resolve-then-record, offline queue, explicit pending state |
| 3.5 | Scan history | **Done** — accepted and refused scans, by operator and device |
| 3.6 | Cutting module | **Done** — cut plan, fabric issue as a transfer, consumption posted exactly once |
| 3.7 | Embroidery / stitching / washing / finishing | **Done** — one stage-queue component, five screens |
| 3.8 | Job work orders | **Done** — issue, receive per batch, charged on good pieces only |
| 3.9 | QC module | **Done** — checklists, defect codes with attribution, verdicts that move the stage ledger |
| 3.10 | Rework | **Done** — tickets bounded by outstanding rework; closing returns or scraps |
| 3.11 | Batch tracking UI | **Done** — route position, counters, movement history |
| 3.12 | Production routes admin | **Done** — stages and ordered route steps, editable |
| 3.13 | **Department and location restriction** | **Done** — by assignment on the work, per decisions.md §28 |

### Delivered

| Area | Detail |
|---|---|
| Domain | No new logic needed; the stage ledger, barcode and QC modules were already complete and tested |
| API | `production` module — batches, splits, stage transitions, rework, scan resolve/record, scan history, stages and routes |
| UI | Scan station, batch tracking, batch detail, scan history, five stage queues from one component |
| Client | `lib/scan-queue.ts` — device-side queue, never optimistic, never silently dropped |
| Verification | 29 end-to-end tests covering all five exit criteria |

### The two risks the roadmap named

**3.4 was the highest-risk deliverable**, and the design that answers it is
recorded as decisions.md §27. The queue holds a scan as PENDING until the server
confirms it; the idempotency key is minted at the moment of the physical scan;
and **displayed stage counters come from the server only**, so a queued scan
never moves a number that might later be refused.

**3.6's risk — posting consumption exactly once — is handled** by
`CuttingOrder.consumptionPostedAt`, claimed conditionally so a concurrent
second completion updates zero rows and stops. Building it also surfaced a real
partial-application bug; see testing-strategy.md §6.

### Exit criteria — all met

| Criterion | Where it is asserted |
|---|---|
| Cutting 100 received / 95 completed / 5 rejected leaves 95 to stitching | `phase3.e2e-spec.ts` "cutting 100 received / 95 completed / 5 rejected leaves 95 to forward" |
| A duplicate scan with the same idempotency key is a no-op | `phase3.e2e-spec.ts` "applies a forward scan exactly once when replayed" |
| Stage quantities reconcile across the whole route | `phase3.e2e-spec.ts` "reconciles quantities across the whole route" |
| A garment reworked twice is still one garment | `phase3.e2e-spec.ts` "a garment reworked twice is still one garment" |
| Cutting, stitching, embroidery and finishing quantities reconcile | `phase3.e2e-spec.ts` "keeps cutting, embroidery and stitching quantities reconciled" |

### Not delivered in phase 3

- **Reinspection flow.** `QualityInspection.reinspectionOfId` is modelled and
  accepted by the API, but nothing in the UI walks a failed batch back to a
  second inspection.
- **Photos on inspections and defects.** The columns accept URLs; there is no
  upload (object storage is configured, no UI).
- **Operator productivity reporting.** Every scan records operator, device and
  timestamp, so the data is there; the report is phase 6.
- **Per-unit stage movement.** Units are minted and tracked, but stage
  transitions still move batch quantities rather than individual garments.

### Known limitation: the scan station needs the network to look a code up

Recording is queued and survives a network drop. **Resolving** a barcode — what
batch is this, what can I do with it here — is a live call, so an operator who
scans an unfamiliar batch while offline cannot start. In practice a station
works the same few batches, so the common case is covered by recording; a
resolution cache would close the gap and is not built.

## 5. Phase 4 — demand

**Prerequisite: API verification.** See the checklists in
[shopify-integration.md](shopify-integration.md) §10 and
[unicommerce-integration.md](unicommerce-integration.md) §9.

**Do not start writing connectors before those are answered.** Two questions in
particular:

1. **Which Unicommerce document type carries bulk manufacturing demand?** A PO
   *to* DASH AND DOT is demand; a PO *from* DASH AND DOT is procurement. Importing
   the wrong direction would have the factory manufacture goods the company is
   buying.
2. **Which inventory source is authoritative for the manufacturing decision** —
   Shopify inventory levels or Unicommerce facility stock? They will disagree, and
   the ERP must name one.

| # | Deliverable |
|---|---|
| 4.1 | Shopify client with version pinning, cost-aware throttling, cursor pagination |
| 4.2 | Order import → `ShopifyOrder` / `ShopifyOrderLine` |
| 4.3 | Webhook receiver, HMAC verified, `IntegrationEvent` dedupe, queued processing |
| 4.4 | Channel classification (online / POS / custom) **— verify on real data** |
| 4.5 | Unicommerce client, auth, facility master |
| 4.6 | Facility inventory snapshot fetch |
| 4.7 | Availability assessment → demand (`assessLineAvailability()` exists) |
| 4.8 | Bulk PO import → demand |
| 4.9 | Cross-system dedup (`demandFingerprint()` exists) |
| 4.10 | Order and demand UI, availability view |
| 4.11 | Demand approval workflow |
| 4.12 | Integrations admin screen |
| 4.13 | Exception dashboard: broken mappings, failed syncs, missing barcodes |

### Exit criteria

- A Shopify order appears with per-line facility availability
- Only uncovered quantity becomes demand
- A snapshot older than the window is marked stale and does not net off demand
- The same order via both systems produces **one** demand with **two** mappings
- A replayed webhook changes nothing

## 6. Phase 5 — finished goods and external inventory

**Prerequisite: phase 3** (QC-approved quantity) **and phase 4 verification**.

| # | Deliverable |
|---|---|
| 5.1 | FG inward service (`planInwardLine()` exists) |
| 5.2 | FG ledger and balances |
| 5.3 | Internal GRN |
| 5.4 | FG stock + inward UI |
| 5.5 | Push preview UI (`previewPush()` exists) |
| 5.6 | Push job service with `externalRequestId` |
| 5.7 | Push worker, outcome classification (`classifyPushOutcome()` exists) |
| 5.8 | Reconciliation service and UI (`reconcile()` exists) |
| 5.9 | Retry — **only from `FAILED`, never from `RECONCILIATION_REQUIRED`** |
| 5.10 | Sync log viewer |

### Risks

**This is the only outward write in the system.** The whole phase should be
rehearsed in a sandbox facility before touching a real one, including a
**deliberately timed-out request** to exercise the reconciliation path. That path
protects real inventory, and a path that has never been run is a path that does
not work.

### Exit criteria

- Partial inward works: 100 ordered, 90 QC-approved, 50 then 40 inwarded
- A third inward is refused
- Pushing the same inward line twice credits once
- A timeout produces `RECONCILIATION_REQUIRED` and **cannot** be retried
- Reconciliation records both quantities and the variance
- An overage is raised for investigation, never auto-corrected

## 7. Phase 6 — intelligence

**Prerequisite: phases 2–5 for meaningful data.**

| # | Deliverable |
|---|---|
| 6.1 | Sales velocity from Shopify history |
| 6.2 | Forecast generation (`computeVelocity()` exists) |
| 6.3 | Replenishment suggestions (`suggestReplenishment()` exists) |
| 6.4 | Alert evaluation worker with dedupe (`notificationDedupeKey()` exists) |
| 6.5 | Email and WhatsApp delivery |
| 6.6 | Notification centre |
| 6.7 | Costing service (`rollUpCosts()` exists) |
| 6.8 | Costing UI: planned vs actual, cost per accepted unit |
| 6.9 | Wastage and BOM variance (`analyseWastage()` exists) |
| 6.10 | Production reports with Excel export |
| 6.11 | Stage bottleneck and SLA analysis |
| 6.12 | Generic approval matrix engine |
| 6.13 | Stock counting and reconciliation UI |
| 6.14 | Document attachments |
| 6.15 | Saved views, keyboard shortcuts, bulk actions |
| 6.16 | Performance: indexing review, 100k-movement fixture, query budgets |

Forecasting stays **rule-based and transparent** — every row stores its inputs
and method, so a planner can reproduce the number by hand. Machine learning only
once there is enough reliable history to justify it, and not before.

## 8. Cross-cutting work not tied to a phase

| Item | Why | When |
|---|---|---|
| **Concurrency tests against real Postgres** | Row locking is load-bearing and unverified under contention | Before phase 3 |
| Department / location restriction | Named gap in security §12 | Phase 3 |
| MFA for elevated roles | Before any external exposure | Before production |
| Session revocation | A stolen token is valid for ≤15 min | Before production |
| Automated backups + restore rehearsal | A backup never restored is not a backup | Before production |
| Error monitoring (Sentry or similar) | Structured logs exist; no aggregation | Before production |
| Frontend component tests | Three dialogs hold real validation logic | Phase 2 |
| Nightly reconciliation job | `assertMaterialBalanced`, `reconcileRollLengths`, route chain | Phase 2 |

The first and last are the two most valuable. The nightly reconciliation turns
the invariants from things that are true when checked into things that are
*known* to be true every morning.

## 9. Suggested order of work

```
now ─────────────────────────────────────────────────────────────────►

Phase 2  ████████████████
         BOM → MRP → reservations → MO (snapshot!) → planning

Phase 3        ████████████████████████
               barcodes → scan station → stages → QC → rework

API verification  ████                      ← runs in parallel, blocks 4
                  Shopify + Uniware discovery

Phase 4                   ████████████████
                          connectors → availability → demand → dedup

Phase 5                             ████████████
                                    FG inward → push → reconcile

Phase 6                                      ████████████████
                                             forecasting → costing → analytics

Concurrency tests  ██                        ← before phase 3
Production hardening                    ████ ← before go-live
```

The API verification work has no code dependency and should begin now, in
parallel with phase 2. It is a series of conversations and sandbox calls, and it
is the long-lead item: phases 4 and 5 cannot responsibly start without its
answers, and discovering a surprise in Uniware's receiving model after phase 5 is
built would be expensive.

## 10. Definition of done, per module

Applied to every module, per the specification:

1. Database schema
2. Migration
3. Domain logic with unit tests
4. Service with transactions and row locks where stock or quantity moves
5. REST endpoints with Zod validation and declared permissions
6. OpenAPI documentation (generated from the same schemas)
7. Frontend pages with real data
8. Form validation using the shared contracts
9. Authorisation enforced server-side
10. Audit logging for elevated actions
11. End-to-end test of the happy path plus the critical refusals
12. Documentation updated

Phase 1 met all twelve. No module should ship against a lower bar — in particular
not 11, because the two defects this project found were both caught there.
