# BOM and MRP Design

Domain logic implemented and tested in `packages/domain/src/bom/explode.ts` and
`packages/domain/src/mrp/plan.ts` (36 tests). Screens arrive in phase 2.

---

## 1. BOM structure

Three tables, because "the BOM" and "a version of the BOM" are different things:

```
Bom            the logical BOM for a style, or for one specific variant
  └── BomVersion    a revision with its own status, effective date, cost snapshot
        └── BomItem      one material line
              ├── BomItemAlternative     approved substitutes, in preference order
              └── BomItemSizeOverride    per-size consumption
```

### Resolution order

A variant-level BOM overrides the style-level BOM:

1. `ProductVariant.activeBomVersionId`, if set
2. the approved version of the variant's own `Bom`
3. the approved version of the style-level `Bom` (`productVariantId IS NULL`)

Exactly one style-level BOM per product, enforced by a partial unique index —
a plain `UNIQUE` cannot express it, because a NULL `productVariantId` never
collides in Postgres:

```sql
CREATE UNIQUE INDEX boms_one_style_level_per_product
  ON boms ("organizationId", "productId") WHERE "productVariantId" IS NULL;
```

### Status

`DRAFT → PENDING_APPROVAL → APPROVED → SUPERSEDED → ARCHIVED`

Only an `APPROVED` version may drive production. `explodeBom()` refuses anything
else unless explicitly asked for a what-if preview (`requireApproved: false`).

## 2. Consumption and wastage

Each line carries net `consumptionQty` per `baseQuantity` garments, plus a
wastage allowance with an explicit basis:

| Basis | Calculation | Use |
|---|---|---|
| `PERCENT_OF_CONSUMPTION` | `net × value / 100` | Fabric — loss scales with quantity |
| `FIXED_PER_UNIT` | `value × garments` | Buttons — half a spare per garment |
| `FIXED_PER_ORDER` | `value`, once | Set-up loss, marker waste |
| `NONE` | `0` | Labels, packaging |

The basis is explicit because a flat percentage is wrong for set-up loss and a
fixed figure is wrong for fabric, and guessing produces either shortages or dead
stock. `FIXED_PER_ORDER` is charged **once for the whole order**, not once per
size line — a detail that matters when a 100-piece order spans six sizes.

## 3. The worked example

DASH AND DOT KURTA, SKU `DD-KRT-001-M`, order of 100:

| Material | Consumption | Wastage | Net | Gross |
|---|---|---|---|---|
| Main fabric | 2.5 m | 5% | 250.0000 | **262.5000** |
| Lining | 1.2 m | 3% | 120.0000 | 123.6000 |
| Buttons | 8 pc | 0.5/unit | 800.0000 | 850.0000 |
| Thread | 1 pc | none | 100.0000 | 100.0000 |
| Brand label | 1 pc | none | 100.0000 | 100.0000 |
| Care label | 1 pc | none | 100.0000 | 100.0000 |
| Packaging | 1 set | none | 100.0000 | 100.0000 |

Fabric: `100 × 2.5 = 250`, `250 × 5% = 12.5`, gross `262.5`. Asserted exactly in
`explode.test.ts`.

## 4. Size-wise consumption

A `BomItemSizeOverride` replaces the base consumption for that size. Sizes are
**not** averaged:

```
50 M  at 2.50 m = 125.0
50 XXL at 2.85 m = 142.5
                ─────
net               267.5 m   (not 250 m)
gross @ 5%        280.875 m
```

Averaging would under-order for an order weighted towards large sizes, which is
how a cutting room runs out of fabric two thirds of the way through.

## 5. The frozen snapshot

When a manufacturing order is released, the BOM version is copied into
`MoBomSnapshotLine` — per-unit consumption, per-unit wastage, gross per unit,
unit cost, planned quantity, planned cost. Written once, never modified.

Changing the master BOM afterwards **cannot** reach a released order:

```
v1  fabric 2.5 m, 5% wastage   → MO released, snapshot: 262.5 m planned
v2  fabric 2.7 m, 8% wastage   → new orders compute 291.6 m
                                → the released MO still says 262.5 m
```

Three things depend on this:

1. **Costing** compares actuals against what was planned at release, not against
   a BOM someone has since edited.
2. **Wastage analysis** measures the production run, not the edit.
3. **Issue limits** are bounded by the snapshot, so a BOM revision cannot
   retroactively authorise more material for an order already on the floor.

`diffBomVersions()` powers the comparison screen and the warning shown when a
planner revises a BOM that live orders depend on.

## 6. MRP

`runMrp()` takes an exploded BOM plus a supply position per material and produces
one line per material.

### Two rules that distinguish it from "required minus stock"

**Open purchase orders are supply, not stock.** They are reported with an
expected arrival date, but the shortage figure is computed against physically
available stock only:

```
gross required      262.5
available (unreserved, issuable locations)  180.0
shortage             82.5      ← measured against stock
open purchase        100.0     ← reported, not netted off
uncovered shortage    0.0      ← shortage − incoming
```

The planner sees both numbers and decides. The system does not quietly treat a
supplier's promise as inventory.

**Stock reserved by other orders is already excluded** from `availableQty`, and
reported separately as `reservedElsewhereQty` — so a planner can see that the
material exists but is promised elsewhere, which calls for a different
conversation than a genuine shortage.

### Readiness

| Readiness | Condition |
|---|---|
| `READY` | shortage = 0 |
| `PARTIALLY_AVAILABLE` | shortage > 0, covered by incoming supply arriving in time |
| `SHORT` | shortage not covered by incoming supply |
| `SHORT_AND_LATE` | incoming supply exists but arrives after the required date |

`SHORT_AND_LATE` is separate because "we have ordered it" and "it will be here in
time" are different facts, and a PO arriving a month after the delivery date is
not coverage.

### Purchase suggestions

`roundPurchaseQty()` rounds the uncovered shortage up to something a supplier
will accept: at least `minimumOrderQty`, rounded up to `orderMultiple`.
82.5 m of fabric sold in 25 m rolls becomes 100 m.

## 7. Authorised partial release

`maxProducibleQty()` answers the question a planner actually asks: *we wanted
100, how many can we start today?*

It is the minimum across materials of `available / gross-per-garment`, floored to
whole garments:

```
180 m fabric ÷ 2.625 m per garment = 68 garments
170 buttons  ÷ 8.5 per garment     = 20 garments
                                      ──
limit                                 20
```

Floored because half a kurta is not a releasable quantity. Releasing short of
the order quantity needs `manufacturing.release_with_shortage`, and the override
plus its reason is recorded on the order.

## 8. Reproducibility

An `MrpRun` stores its `scope` (which orders were planned) and its `parameters`
(horizon, lot policy), so a run can be explained after the fact. `MaterialRequirement`
rows keep every input — required, available, reserved elsewhere, open purchase,
expected arrival, estimated cost — not just the conclusion.

A planner challenged on a purchase suggestion three weeks later can see exactly
what the system knew when it made it.

`aggregateMrpLines()` produces the all-store aggregation view: requirements add
up across runs, supply is counted once. Adding the same 180 m into two runs would
report coverage twice.

## 9. Lot allocation

`allocateFromStock()` picks which lots a reservation draws on:

- **Oldest received first**, so fabric does not age in the rack while newer rolls
  are cut
- Filtered by `requiredShade` and `minimumWidth` — a cut plan depends on usable
  width, so a narrow lot is not a substitute
- `singleShade` keeps an order on one shade, choosing the shade with the most
  cover
- **Deterministic**: two planners running MRP on the same data get the same
  allocation, with a stable tiebreak on lot id

### Shade control

`assertShadeMixAllowed()` refuses an allocation spanning more than one shade
unless an approval exists. Mixing shades inside a garment batch produces visibly
mismatched panels, which is a reject discovered at final QC after all the labour
has been spent. It needs an approved exception, not a silent allocation decision.

For fabric rolls, `selectRollsForLength()` prefers **partially-used rolls before
opening a full one** — how a cutting room actually works, because it minimises
the number of short remnants left in the rack.

## 10. Bundles

A bundle SKU (`Set = Kurta + Pant + Dupatta`) is assembled from component SKUs
via `ProductBundleComponent`. Each component keeps its **own BOM and its own
production route**, so component-level material consumption and stage tracking
stay intact.

A bundle cannot contain itself (`pbc_no_self_reference`).

## 11. Test coverage

| Area | Cases |
|---|---|
| BOM explosion, wastage bases, size overrides | 18 |
| MRP shortage, open PO handling, partial release, aggregation | 18 |
| Lot allocation, shade control, reservations | 15 |

Including the specification's worked figures: 262.5 m gross, 82.5 m shortage,
267.5 m for a mixed-size order, 68 and 20 garment release limits.
