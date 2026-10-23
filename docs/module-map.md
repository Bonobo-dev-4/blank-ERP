# Module Map

Every screen, its API, its permission and its build status. Source of truth for
navigation: `packages/contracts/src/navigation.ts`.

**64 sidebar entries: 40 built, 3 partial, 21 planned.**

54 page files are implemented — the 27 built sidebar entries plus detail and
create pages (`/materials/[id]`, `/purchasing/orders/[id]`,
`/purchasing/orders/new`, `/purchasing/receipts/[id]`, `/bom/new`, `/bom/[id]`,
`/mrp/[id]`, `/manufacturing/new`, `/manufacturing/[id]`,
`/barcodes/batches/[id]`) and `/login`.

---

## 1. Honest navigation

Planned screens render as **disabled** sidebar items showing the phase they are
due in (`P2`, `P3`, …), not as links to empty pages. Reaching one by URL gives a
page that states the phase and what that phase covers.

The specification requires that every visible action either works or is clearly
marked unavailable. The practical reason: an operator who clicks three dead links
stops trusting the whole interface, including the parts that work.

Partial screens carry an amber dot and a tooltip saying what is and is not there.

## 2. Status legend

| | Meaning |
|---|---|
| **Built** | Implemented against real data, end to end |
| **Partial** | Works, but a section is explicitly marked as awaiting a later phase |
| **Planned** | Schema and API contract exist; screen does not |

---

## 3. Dashboard

| Screen | Route | API | Permission | Status |
|---|---|---|---|---|
| Dashboard | `/` | `GET /dashboard/summary` | `inventory.read` | **Partial** (1) |

Every figure is a live aggregate. The production, demand and finished-goods
sections report `available: false` with their phase rather than showing a zero
that reads as a measurement.

## 4. Orders & Demand — *phase 4*

| Screen | Route | Permission | Status |
|---|---|---|---|
| All Orders | `/orders` | `demand.read` | Planned (4) |
| Shopify Orders | `/orders/shopify` | `demand.read` | Planned (4) |
| POS Orders | `/orders/pos` | `demand.read` | Planned (4) |
| Unicommerce Bulk POs | `/orders/bulk-po` | `demand.read` | Planned (4) |
| Stock Availability | `/orders/availability` | `demand.read` | Planned (4) |
| Manufacturing Demand | `/demand` | `demand.read` | Planned (4) |
| Demand Forecast | `/demand/forecast` | `reports.read` | Planned (6) |

Domain logic for availability assessment and cross-system deduplication is
implemented and tested; only the connectors and screens are outstanding.

## 5. Raw Materials — *phase 1, built*

| Screen | Route | API | Permission | Status |
|---|---|---|---|---|
| Raw Material Master | `/materials` | `GET /materials` | `materials.read` | **Built** |
| Material detail | `/materials/[id]` | `GET /materials/:id` | `materials.read` | **Built** |
| Fabric Rolls | `/materials/rolls` | `GET /fabric-rolls` | `inventory.read` | **Built** |
| Material Lots | `/materials/lots` | `GET /materials/lots` | `inventory.read` | **Built** |
| Raw Material Stock | `/inventory/stock` | `GET /inventory/balances` | `inventory.read` | **Built** |
| Material Movements | `/inventory/movements` | `GET /inventory/movements` | `inventory.read` | **Built** |
| Stock Adjustments | `/inventory/adjustments` | `POST /inventory/adjust` | `inventory.adjust` | **Built** |
| Stock Audits | `/inventory/audits` | — | `inventory.count` | Planned (6) |

Notable behaviour:

- The material list shows **six distinct stock figures** per row — available,
  reserved, at production, QC hold, on hand, reorder level — because conflating
  them is how planners over-promise.
- Fabric Rolls shows a live reconciliation banner comparing roll lengths against
  the ledger.
- Movements is read-only by design. The ledger is append-only; a correction is a
  new reversing movement.

## 6. Purchasing — *phase 1, built*

| Screen | Route | API | Permission | Status |
|---|---|---|---|---|
| Purchase Requests | `/purchasing/requisitions` | `GET/POST /purchasing/requisitions` | `purchasing.read` | **Built** |
| Purchase Orders | `/purchasing/orders` | `GET /purchasing/orders` | `purchasing.read` | **Built** |
| New purchase order | `/purchasing/orders/new` | `POST /purchasing/orders` | `purchasing.write_po` | **Built** |
| PO detail | `/purchasing/orders/[id]` | `GET /purchasing/orders/:id` | `purchasing.read` | **Built** |
| Goods Receipts | `/purchasing/receipts` | `GET /purchasing/receipts` | `purchasing.read` | **Built** |
| Receipt detail + inspection | `/purchasing/receipts/[id]` | `POST …/inspect` | `purchasing.inspect` | **Built** |
| Vendor Management | `/purchasing/suppliers` | `GET/POST /suppliers` | `purchasing.read` | **Built** |
| Purchase Approvals | `/purchasing/approvals` | `POST …/decision` | `purchasing.approve_po` | **Built** |

Notable behaviour:

- The PO detail page states its closure assessment **in words** — "3 of 5 lines
  are still short; closing early requires an explicit decision" — so a buyer does
  not have to do the arithmetic.
- Recording a delivery supports **roll-by-roll fabric entry**, with live
  validation that the lengths add up to the received quantity.
- Inspection requires **per-roll allocation** of any rejected length, and refuses
  to submit until accepted + rejected equals received.
- The approvals queue shows full line detail, not a summary. An approver who
  cannot see what they are committing to will approve everything.

## 7. BOM & MRP — *phase 2, built*

| Screen | Route | API | Permission | Status |
|---|---|---|---|---|
| BOM Master | `/bom` | `GET /bom` | `bom.read` | Built |
| BOM Builder | `/bom/builder` | → `/bom/new` | `bom.write` | Built |
| BOM Versions | `/bom/versions` | `GET /bom/versions` | `bom.read` | Built |
| Material Requirements | `/mrp` | `GET/POST /mrp/runs` | `mrp.run` | Built |
| Material Shortages | `/mrp/shortages` | `GET /mrp/shortages` | `mrp.run` | Built |
| Purchase Suggestions | `/mrp/suggestions` | `GET /mrp/shortages?uncoveredOnly` | `purchasing.write_requisition` | Built |
| Material Allocation | `/mrp/allocation` | — | `mrp.reserve` | **Partial** |

Detail pages: `/bom/new`, `/bom/[id]` (versions, line editor, explosion
preview, version diff, approval), `/mrp/[id]` (requirement lines, requisition).

**Material Allocation is partial.** Reserving material and seeing what an order
holds both work, on the manufacturing order itself. What does not exist is the
cross-order view — one screen answering "who is holding this fabric?". The
reservation rows carry everything that view needs.

### What the BOM screens enforce

- A **draft** is editable; an **approved** version is not. Changing an approved
  recipe would silently rewrite the cost of every order already placed against
  it, so the UI offers "New version" rather than an edit.
- Only one draft per BOM is open at a time. Two concurrent drafts is a merge
  problem nobody wants to resolve by hand at approval time.
- Approving **supersedes** its predecessor rather than replacing it, and the
  approval dialog says so, including that released orders are not touched.
- The gross-per-unit figure recalculates as the planner types, mirroring
  `wastageFor` from `@dnd/domain`. The server recomputes it with the real
  function — the live figure is feedback, never the authority.

## 7a. Manufacturing orders — *phase 2, built*

| Screen | Route | API | Permission | Status |
|---|---|---|---|---|
| Manufacturing Orders | `/manufacturing` | `GET /manufacturing/orders` | `manufacturing.read` | Built |
| Order detail | `/manufacturing/[id]` | `GET /manufacturing/orders/:id` | `manufacturing.read` | Built |
| New order | `/manufacturing/new` | `POST /manufacturing/orders` | `manufacturing.write` | Built |
| Production Planning | `/manufacturing/planning` | — | `manufacturing.write` | Planned (2) |

The order detail screen carries the three actions that matter:

| Action | Endpoint | Permission | Guard |
|---|---|---|---|
| Reserve material | `POST …/reserve` | `mrp.reserve` | Tops up an existing reservation; never double-books |
| Release to floor | `POST …/release` | `manufacturing.release` | Freezes the BOM snapshot. A critical shortage additionally needs `manufacturing.release_with_shortage` **and** a written reason |
| Cancel | `POST …/cancel` | `manufacturing.cancel` | Releases every reservation the order held |

Before release the screen shows live **material readiness** — required,
available, reserved elsewhere, incoming, short — and how many garments current
stock actually covers. After release it shows the **frozen BOM snapshot**
instead, labelled as such, because that is what the order is costed against.

## 8. Shop floor — *phase 3, built*

| Screen | Route | API | Permission | Status |
|---|---|---|---|---|
| Scan Station | `/scan` | `POST /production/scan{,/resolve}` | `production.scan` | Built |
| Batch Tracking | `/barcodes/batches` | `GET /production/batches` | `manufacturing.read` | Built |
| Batch detail | `/barcodes/batches/[id]` | `GET /production/batches/:id` | `manufacturing.read` | Built |
| Scan History | `/barcodes/history` | `GET /production/scans` | `production.scan` | Built |

The five stage screens below are **one component** (`components/app/stage-queue.tsx`)
with a different stage code. They differ in what the garments physically go
through, not in how quantity is accounted for, and five near-identical screens
would drift apart within a release.

Each shows three queues — *in hand*, *ready to hand on*, *out in rework* — and
every quantity is bounded by what that stage actually holds.

`/production/cutting` carries a second panel the others do not: **cutting
orders**, where fabric is issued to the table (a transfer) and the cut is
completed (the one operation that retires fabric, exactly once).

### Quality, rework and job work — *phase 3, built*

| Screen | Route | API | Permission | Status |
|---|---|---|---|---|
| Quality Control | `/quality` | `GET/POST /quality/inspections` | `quality.read` / `quality.inspect` | Built |
| Rework | `/quality/rework` | `GET/POST /quality/rework` | `quality.manage_rework` | Built |
| Production Handover | `/production/handover` | `GET /job-work/orders`, `POST …/receive` | `production.record_stage` | Built |
| Unit Tracking | `/barcodes/units` | `GET /production/units` | `manufacturing.read` | Built |
| Production Routes | `/admin/routes` | `GET/POST /production/{stages,routes}` | `admin.manage_routes` | Built |

Three invariants these screens enforce, each refused by the server independently:

- **An inspection accounts for every garment it looked at.** Passed, failed,
  rework and hold must add up to exactly the inspected quantity, and the
  verdict moves the stage counters itself — so QC and the floor can never
  report different numbers for the same garments.
- **Two rework tickets cannot claim the same garments.** A ticket is bounded by
  what is actually out in rework, less whatever open tickets already cover.
- **A job worker is paid for good pieces.** Receiving 90 good and 10 rejected
  charges for 90.

### Stage access

Assigned work can only be recorded by the person it is assigned to, or by
someone holding `production.assign` — a supervisor covering an absence. Work
out with a job worker must be recorded by receiving its job work order, so the
pieces and the charge stay together. Unassigned work stays open to anyone who
can record a stage, because most of a factory's work is never assigned to a
named person. See [decisions.md](decisions.md) §28.



| Screen | Route | Permission | Status |
|---|---|---|---|
| Cutting | `/production/cutting` | `production.record_stage` | Planned (3) |
| Embroidery | `/production/embroidery` | `production.record_stage` | Planned (3) |
| Stitching | `/production/stitching` | `production.record_stage` | Planned (3) |
| Washing / Processing | `/production/washing` | `production.record_stage` | Planned (3) |
| Finishing | `/production/finishing` | `production.record_stage` | Planned (3) |
| Quality Control | `/quality` | `quality.read` | Planned (3) |
| Rework | `/quality/rework` | `quality.manage_rework` | Planned (3) |
| Production Handover | `/production/handover` | `production.record_stage` | Planned (3) |

Stage ledger, QC verdicts, serialisation and batch splitting are implemented and
tested (28 + 10 + 8 tests).

## 9. Barcode Operations — *phases 1 and 3*

| Screen | Route | API | Permission | Status |
|---|---|---|---|---|
| Scan Station | `/scan` | — | `production.scan` | Planned (3) |
| Barcode Printing | `/barcodes/print` | `POST /barcodes/labels` | `production.print_labels` | **Built** |
| Scan History | `/barcodes/history` | — | `production.scan` | Planned (3) |
| Batch Tracking | `/barcodes/batches` | — | `manufacturing.read` | Planned (3) |
| Unit Tracking | `/barcodes/units` | — | `manufacturing.read` | Planned (3) |

Printing works today because lot, roll and receipt barcodes are minted
automatically by the phase 1 receiving flow — a delivery becomes scannable
without any operator action.

## 10. Finished Goods — *phase 5*

| Screen | Route | Permission | Status |
|---|---|---|---|
| Finished Stock | `/finished-goods` | `finished_goods.read` | Planned (5) |
| Finished Goods Inward | `/finished-goods/inward` | `finished_goods.inward` | Planned (5) |
| GRN Management | `/finished-goods/grn` | `finished_goods.read` | Planned (5) |
| Unicommerce Inventory Push | `/sync/push` | `sync.read` | Planned (5) |
| External Reconciliation | `/sync/reconciliation` | `sync.reconcile` | Planned (5) |

Inward eligibility, push preview, outcome classification and reconciliation are
implemented and tested (34 tests).

## 11. Intelligence — *phases 1 and 6*

| Screen | Route | API | Permission | Status |
|---|---|---|---|---|
| Inventory Alerts | `/intelligence/alerts` | `GET /inventory/alerts` | `inventory.read` | **Built** |
| Replenishment | `/intelligence/replenishment` | — | `reports.read` | Planned (6) |
| Forecasting | `/intelligence/forecasting` | — | `reports.read` | Planned (6) |
| Production Reports | `/reports/production` | — | `reports.read` | Planned (6) |
| Material Consumption | `/reports/consumption` | — | `reports.read` | Planned (6) |
| Production Costing | `/reports/costing` | — | `reports.view_costing` | Planned (6) |
| Job Worker Performance | `/reports/job-workers` | — | `reports.read` | Planned (6) |

Alerts are computed **live from the ledger**, not from a cached flag, so an alert
clears the moment stock is received.

## 12. Administration — *phase 1, built*

| Screen | Route | API | Permission | Status |
|---|---|---|---|---|
| Product Master | `/admin/products` | `GET/POST /products` | `products.read` | **Built** |
| SKU Mappings | `/admin/mappings` | `POST /products/mappings` | `products.read` | **Built** |
| Users | `/admin/users` | `GET/POST /admin/users` | `admin.manage_users` | **Built** |
| Roles | `/admin/roles` | `PUT /admin/roles/:id/permissions` | `admin.manage_roles` | **Built** |
| Locations | `/admin/locations` | `GET/POST /locations` | `admin.manage_locations` | **Built** |
| Production Routes | `/admin/routes` | — | `admin.manage_routes` | Planned (3) |
| Approvals | `/admin/approvals` | — | `admin.manage_approvals` | Planned (6) |
| Integrations | `/admin/integrations` | — | `admin.manage_integrations` | Planned (4) |
| Settings | `/admin/settings` | `GET /admin/settings` | `admin.manage_settings` | **Built** |
| Audit Logs | `/admin/audit` | `GET /admin/audit` | `admin.view_audit_log` | **Built** |

**Product Master and SKU Mappings are a deliberate addition.** The V3 sidebar has
no entry for them, but they are master data referenced by Orders, BOM and
Production. Unreachable master data is worse than an extra menu item. See
[decisions.md](decisions.md) §3.

Notable behaviour:

- Product Master generates the full colour × size SKU matrix in one pass, with a
  preview and idempotent re-runs.
- SKU Mappings surfaces unmapped SKUs per provider as **blockers**, because an
  unmapped SKU cannot take part in an import or a push.
- Roles marks **elevated** permissions distinctly, so whoever edits a role can
  see they are about to let a stitching supervisor adjust stock.
- Locations shows the virtual counter-accounts and their signed balances, and
  protects them from edit.
- Settings shows integration configuration without showing anything sensitive,
  because credentials live in a secret store and only a reference is held here.

## 13. API surface

Base `/api`, OpenAPI at `/api/docs`.

| Group | Endpoints |
|---|---|
| `auth` | `POST login`, `POST pin-login`, `POST refresh`, `GET me` |
| `dashboard` | `GET summary` |
| `products` | `GET /`, `GET :id`, `POST /`, `PATCH :id`, `GET variants`, `POST variants`, `PATCH variants/:id`, `POST variants/matrix`, `POST mappings`, `POST bundles`, `GET mapping-issues` |
| `materials` | `GET /`, `GET :id`, `POST /`, `PATCH :id`, `GET/POST uom-conversions`, `GET uom-conversions/preview`, `GET lots` |
| `locations` | `GET /`, `POST /`, `PATCH :id` |
| `suppliers` | `GET /`, `GET :id`, `POST /`, `PATCH :id` |
| `fabric-rolls` | `GET /`, `GET :id`, `GET suggest`, `GET reconciliation`, `POST /`, `POST :id/qc`, `POST issue`, `POST return` |
| `inventory` | `GET balances`, `GET movements`, `GET alerts`, `POST inward`, `POST transfer`, `POST issue`, `POST return`, `POST consume`, `POST adjust` |
| `purchasing` | requisitions (`GET`, `POST`, `POST :id/decision`), orders (`GET`, `GET :id`, `POST`, `POST :id/decision`, `POST :id/close`), receipts (`GET`, `GET :id`, `POST`, `POST :id/inspect`) |
| `barcodes` | `GET /`, `GET resolve`, `GET image`, `POST labels`, `POST reissue` |
| `admin` | users, roles, permissions, audit, settings |
| `health` | `GET /`, `GET ready` |

Every mutation that touches stock requires an `idempotencyKey`. Every response
serialises decimals as strings.

## 14. Shared packages

### `@dnd/domain`

Framework-free business logic. 255 tests.

| Module | Contents |
|---|---|
| `decimal` | Scales, coercion, safe arithmetic |
| `uom` | Explicit conversion engine |
| `inventory/locations` | Location kinds, system location specs |
| `inventory/ledger` | Movement state machine, delta planning, balance assertion |
| `inventory/availability` | Stock position: the six distinct quantities |
| `inventory/reservations` | Lot allocation, FEFO, shade control |
| `inventory/rolls` | Roll length math, status derivation, selection |
| `purchasing/receipt` | Tolerance, inspection split, PO closure, landed cost |
| `bom/explode` | Explosion, wastage bases, size overrides, snapshot, diff |
| `mrp/plan` | Shortage, incoming supply, partial release, aggregation |
| `production/stage-ledger` | Stage counters, transitions, batch progress |
| `production/barcode` | Code format, check character, scan validation |
| `production/serialization` | Unit minting, batch splitting |
| `quality/qc` | Verdict split, defect consistency |
| `finished-goods/inward` | Inward eligibility, lifecycle states |
| `integrations/dedupe` | Demand fingerprint, availability assessment |
| `integrations/push` | Push state machine, outcome classification, reconciliation |
| `costing/rollup` | Variance, cost per accepted unit, wastage analysis |
| `forecasting/replenishment` | Velocity, replenishment, alert levels, dedupe keys |
| `numbering` | Document number formats |

### `@dnd/contracts`

Zod schemas shared by API and UI, the permission catalogue, the role matrix and
the navigation map. One definition per field, so client and server cannot drift.

26 consistency tests assert that the three maps agree with each other: every
role grants real permissions, every navigation gate is a real permission, and
every built screen is reachable by at least one role.
