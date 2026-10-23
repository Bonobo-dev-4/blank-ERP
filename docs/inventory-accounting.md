# Inventory Accounting

The rules that make stock figures trustworthy. This is the most important
document in the repository; everything else is downstream of it.

---

## 1. The core idea: double entry

The material ledger is **strict double entry**. Every movement debits one
location and credits another by the same base quantity. There are no one-sided
entries, and no quantity is ever negative on a movement row — direction is
expressed by which location is the source and which is the destination.

That gives one invariant worth more than all the others combined:

> For any raw material, the signed sum of every balance across every location —
> including the virtual counter-accounts — is **exactly zero**.

```sql
SELECT SUM("onHandQty") FROM material_balances WHERE "rawMaterialId" = $1;
-- must return exactly 0
```

If it does not, something wrote a balance without a ledger row, and the system
can say so in one query instead of leaving an accountant to find it.

Implemented as `assertLedgerBalanced()` in `packages/domain/src/inventory/ledger.ts`,
exposed as `LedgerService.assertMaterialBalanced()`, and asserted by the
end-to-end suite.

## 2. Locations, including the virtual ones

Double entry needs somewhere for the other side of an entry to go. Material
arriving from a supplier has to come *from* somewhere; material consumed into a
garment has to go *to* somewhere. So locations are typed:

| Kind | Owned? | Issuable? | Purpose |
|---|---|---|---|
| `PHYSICAL` | yes | **yes** | Warehouse, room, rack, bin. Uncommitted stock. |
| `PRODUCTION_FLOOR` | yes | no | A department floor. Owned, but already committed to an order. |
| `JOB_WORKER` | yes | no | Physically with an external worker, still owned. |
| `QUALITY_HOLD` | yes | no | Received, not yet inspected. |
| `BLOCKED` | yes | no | Rejected, damaged or administratively blocked. |
| `IN_TRANSIT` | yes | no | Moving between internal locations. |
| `SINK` | **no** | no | Consumed or scrapped. Stock permanently leaves here. |
| `COUNTERPARTY` | **no** | no | The external world: supplier, adjustment authority, opening balance. |

System locations, created by the seed and protected from edit:

| Code | Kind | Role |
|---|---|---|
| `SYS-EXTERNAL` | COUNTERPARTY | Supplier / opening-balance counter-account |
| `SYS-ADJUSTMENT` | COUNTERPARTY | Counter-account for authorised corrections |
| `SYS-CONSUMED` | SINK | Where material ends its life inside a garment |
| `SYS-SCRAP` | SINK | Cutting loss, damage write-off, wastage |
| `SYS-QC-HOLD-RM` | QUALITY_HOLD | Received, awaiting inspection |
| `SYS-REJECTED-RM` | BLOCKED | Inspection-rejected, awaiting a supplier-return decision |
| `SYS-BLOCKED-RM` | BLOCKED | Administratively blocked or damaged |
| `SYS-TRANSIT` | IN_TRANSIT | Between internal locations |

The counter-accounts carry negative balances. `SYS-EXTERNAL` for a material that
has received 500 m shows `-500`. That is not an error; it is what makes the sum
zero, exactly as a liability account does in financial accounting.

### Why `PRODUCTION_FLOOR` exists

"We own 290 m of fabric" and "290 m of fabric is available to cut" are different
statements. Fabric issued to the cutting department is still owned and still
countable, but it has already been committed to an order, so it must not appear
as availability a planner can promise to a second order.

This was originally modelled with department floors as ordinary `PHYSICAL`
locations. An end-to-end test caught it: after issuing 100 m to cutting, the
material still reported 290 m available instead of 190 m. See
[decisions.md](decisions.md) §4.

## 3. The six quantities that must stay distinct

Conflating any two of these is how stock reporting becomes fiction.

| Quantity | Definition | Computed from |
|---|---|---|
| **On hand** | Everything owned, anywhere | Sum over `OWNED_KINDS` |
| **Issuable** | Owned stock in locations production may draw from | Sum over `PHYSICAL` only |
| **Reserved** | Portion of issuable stock committed to specific orders | `reservedQty` on issuable rows |
| **Available** | `issuable − reserved`: what a *new* order may claim | Never negative |
| **Issued to production** | On a department floor, not yet consumed | Sum over `PRODUCTION_FLOOR` |
| **QC hold / blocked** | Received but not inspected / rejected | Sum over `QUALITY_HOLD`, `BLOCKED` |

`computeStockPosition()` returns all of them, and the UI labels every figure with
its definition, because a planner who reads "on hand" as "available" will
over-promise.

Worked example from the end-to-end suite, after a real sequence of operations:

```
300 m received, 290 accepted, 10 rejected, 100 issued to cutting

on hand              300   (190 warehouse + 100 cutting + 10 rejected)
issuable             190   (warehouse only)
reserved               0
available            190
issued to production 100
blocked               10
quality hold           0
```

## 4. The movement state machine

`MOVEMENT_RULES` in `packages/domain/src/inventory/ledger.ts` is the single place
that decides which transitions exist. Each rule names the location kinds it may
debit and credit.

| Movement | From → To | Notes |
|---|---|---|
| `OPENING_BALANCE` | COUNTERPARTY → PHYSICAL | Elevated |
| `PURCHASE_INWARD` | COUNTERPARTY → **QUALITY_HOLD** | Cannot reach a usable location |
| `QC_RELEASE` | QUALITY_HOLD → PHYSICAL | Inspection accepted |
| `QC_REJECT` | QUALITY_HOLD → BLOCKED | Inspection rejected |
| `SUPPLIER_RETURN` | BLOCKED / QUALITY_HOLD → COUNTERPARTY | |
| `ISSUE_TO_PRODUCTION` | PHYSICAL → **PRODUCTION_FLOOR** | A transfer. Owned quantity unchanged. |
| `RETURN_FROM_PRODUCTION` | PRODUCTION_FLOOR → PHYSICAL | |
| `TRANSFER` | PHYSICAL / PRODUCTION_FLOOR / IN_TRANSIT / BLOCKED ↔ same | |
| `ISSUE_TO_JOB_WORKER` | PHYSICAL / PRODUCTION_FLOOR → JOB_WORKER | |
| `RETURN_FROM_JOB_WORKER` | JOB_WORKER → PHYSICAL / PRODUCTION_FLOOR | |
| `CONSUMPTION` | PRODUCTION_FLOOR / JOB_WORKER → **SINK** | Retires stock |
| `WASTAGE` | PRODUCTION_FLOOR / JOB_WORKER → **SINK** | Retires stock |
| `ADJUSTMENT_IN` / `OUT` | COUNTERPARTY ↔ PHYSICAL / BLOCKED | Elevated, reason mandatory |
| `STOCK_COUNT_GAIN` / `LOSS` | COUNTERPARTY ↔ PHYSICAL | Elevated |

Three things the table makes impossible by construction:

**Nothing may be sourced from a SINK.** Material consumed into a garment or
scrapped cannot be un-consumed. A mistake is corrected with an explicit reversing
movement, which leaves both entries in the audit trail. There is no edge that
quietly undoes history.

**Received goods cannot reach an issuable location.** `PURCHASE_INWARD` may only
credit `QUALITY_HOLD`. The only way out is `QC_RELEASE`, which requires an
inspection. So "inspect before use" is a property of the graph, not a reminder.

**Issuing is not consuming.** `ISSUE_TO_PRODUCTION` credits a `PRODUCTION_FLOOR`
location, not a sink. This is the single most important rule in the document, so
it gets its own section.

## 5. Why issue and consumption are separate

This is the rule that prevents the specification's central failure mode: *the
same material being deducted twice as it moves between production stages.*

A naive design deducts stock when fabric is issued to cutting. Then stitching
needs thread, so it deducts again. Then the cut panels move to finishing, and if
anything deducts there too, the same metre has been removed three times.

Here:

```
ISSUE        warehouse → cutting floor      owned quantity UNCHANGED
TRANSFER     cutting floor → stitching      owned quantity UNCHANGED
CONSUMPTION  cutting floor → SYS-CONSUMED   owned quantity REDUCED
WASTAGE      cutting floor → SYS-SCRAP      owned quantity REDUCED
```

Material can travel through as many stages as the route has, and **only**
`CONSUMPTION` and `WASTAGE` reduce what the organisation owns. Each is bounded by
what was actually issued to that department.

Two further guards:

- `MaterialIssueLine` tracks `issuedBaseQty`, `returnedBaseQty`, `consumedBaseQty`,
  and the constraint `mil_returned_consumed_within_issued` enforces
  `returned + consumed ≤ issued`. A department cannot consume or return more than
  it was given.
- `CuttingOrder.consumptionPostedAt` is set when consumption is posted, so
  completing a cutting order twice cannot deduct fabric twice.

## 6. Reservations

A reservation does not move anything. It raises `reservedQty` on the exact
balance row for one `(material, lot, location)`, so other orders stop seeing
that quantity as available.

Pinned to a lot and a location deliberately. "Reserve 262.5 m of FAB-001" is not
actionable — a cutting plan depends on shade and usable width, and a reservation
that does not say which lot is a promise the warehouse may not be able to keep.
`allocateFromStock()` picks lots oldest-received-first, filtered by required
shade and minimum width, and the choice is deterministic so two planners running
MRP on the same data get the same allocation.

When material is issued against a reservation, unreserved stock is drawn down
first and the reservation only afterwards, so a reservation is not released
earlier than it has to be:

```
on hand 300, reserved 262.5 for this order, issue 262.5
  → 37.5 taken from unreserved stock
  → 225 drawn from the reservation
```

Backstop: `mb_reserved_within_on_hand` — `reservedQty = 0 OR reservedQty ≤ onHandQty`.
The `= 0` branch allows the counter-accounts, whose `onHandQty` is legitimately
negative.

## 7. Lots

**Every movement cites a lot**, including for materials nobody tracks by batch.

A button or a thread cone does not need lot traceability, but allowing a nullable
lot would mean two shapes of ledger row, two code paths and a nullable column in
the balance unique key — and in Postgres a NULL in a unique index does not
collide, so `(material, NULL, location)` could duplicate.

Instead each material gets one implicit `GENERAL` lot, enforced by a partial
unique index:

```sql
CREATE UNIQUE INDEX material_lots_one_general_per_material
  ON material_lots ("rawMaterialId") WHERE "isGeneral" = true;
```

The ledger shape stays uniform, and per-lot costing works for every material.

Each goods receipt line creates its own lot, carrying the attributes that must
not be mixed: `shade`, `width`, `gsm`, `supplierLotRef`, and the landed
`unitCost`.

## 8. Fabric rolls

A roll is a physically identifiable piece of one lot, with its own barcode and
its own length.

Roll lengths and the material ledger are **two projections of the same
movements** — every roll movement stamps `fabricRollId` on the ledger row — so
they can be reconciled against each other rather than drifting apart:

> For each (material, lot, location) where fabric is held *as rolls*, the sum of
> roll `currentLength` equals the ledger `onHandQty`.

`FabricRollsService.reconcileRollLengths()` is that check, surfaced on the Fabric
Rolls screen. It is scoped to `PHYSICAL`, `QUALITY_HOLD` and `BLOCKED` locations:
once a length has been issued to a cutting floor it is cut panels, not roll
stock, so comparing it to a roll length would report a variance that is not one.

Roll status is **derived from length**, never set by hand, so a roll cannot
report `AVAILABLE` with zero metres on it:

```
currentLength = 0              → EXHAUSTED
0 < currentLength < original   → PARTIALLY_ISSUED
currentLength = original       → AVAILABLE
BLOCKED / RETURNED_TO_SUPPLIER → preserved (administrative)
```

Constraints: `fr_current_within_original` (`0 ≤ current ≤ original`) and
`fr_reserved_within_current`. The first is what stops a partial return from
inventing fabric: you can only put back what came off.

### Partial rejection splits the roll

If a receipt line arrived as rolls and inspection rejects part of it, the
rejected length must be attributed to specific rolls. "10 m rejected" cannot be
applied otherwise, and guessing would break the reconciliation above.

A roll rejected in full moves to the rejected location. A roll rejected in part
is **split**: the accepted roll shrinks, and the offcut becomes its own barcoded
roll in the rejected location. Lengths still add to what the supplier delivered:

```
3 rolls × 100 m received = 300 m
inspection: 290 accepted, 10 rejected off roll #1

→ roll #1   90 m  AVAILABLE
→ roll #2  100 m  AVAILABLE
→ roll #3  100 m  AVAILABLE
→ roll #1-REJ 10 m  BLOCKED   (new record, new barcode)
            ─────
             300 m
```

Found by an end-to-end test; see [decisions.md](decisions.md) §5.

## 9. Units of measure

Conversions are **explicit by design**. There is no universal "1 roll = N metres"
— it depends on the fabric — and no defensible metre ↔ kilogram conversion
without GSM and width. A conversion that has not been configured raises
`NO_UOM_CONVERSION` rather than fabricating stock.

Only two built-ins, because they are definitional rather than operational:
`KILOGRAM ↔ GRAM`. Everything else is configured, either organisation-wide
(`rawMaterialId = NULL`) or per material. A material-specific rule wins.

Both quantities are stored on every movement: `enteredQty`/`enteredUom` as the
operator typed it, and `baseQty`/`baseUom` as the authoritative figure. Balances
are in base UOM only. When a storekeeper queries a figure months later, the
original entry is still there.

## 10. Costing

`averageCost` is **derived from lot costs**, not accumulated:

```
averageCost = Σ(onHandQty × lot.unitCost) / Σ(onHandQty)   over owned locations
```

An incremental running average needs to know the previous quantity and average,
and both are wrong the moment stock sits in QC hold between being received and
being costed — the held quantity dilutes the average at a cost of zero. Deriving
the figure means it is always exactly the cost of what is on the shelf, and a
single bad inward cannot leave permanent drift behind it. (This replaced an
incremental implementation that an end-to-end test caught producing 246.98
instead of 255.50.)

Lot cost is the **landed** cost: line rate plus a share of freight, apportioned
by line value so an expensive fabric carries more of the freight than a bag of
buttons shipped alongside it.

## 11. Purchase receipt tolerance

Partial delivery is normal and needs no special handling. What is bounded is
over-receipt.

```
maxReceivable = ordered × (1 + overReceiptTolerancePct/100)
```

A purchase order reaches `RECEIVED` only when **every** line is satisfied within
the under-receipt tolerance:

```
minimumAcceptable = ordered × (1 − underReceiptTolerancePct/100)
```

Anything short leaves it `PARTIALLY_RECEIVED`. It is never closed automatically,
because abandoning outstanding quantity is a decision someone has to own —
closing short needs `purchasing.close_po` and a mandatory reason, and is audited.

Inspection must account for the whole receipt: `accepted + rejected = received`,
exactly. Allowing it to fall short would strand quantity in QC hold with nothing
recording what was decided about it.

## 12. Stock adjustments

Adjustments post against `SYS-ADJUSTMENT`, so a correction is an ordinary ledger
movement — as visible, as auditable and as reversible as any other stock change.
There is no back door that edits a balance directly.

Requirements: the elevated `inventory.adjust` permission, a mandatory free-text
reason, and an audit row written in the same transaction.

## 13. Database constraints

73 CHECK constraints in `20261021000100_invariant_constraints`. Services check
first, to return a useful error; the constraints are the last line of defence,
so a bug, a manual SQL fix or a future code path cannot corrupt stock while they
exist.

The ones that matter most:

```sql
-- direction is expressed by locations, never by a negative number
mm_base_qty_positive          CHECK ("baseQty" > 0)
mm_source_ne_destination      CHECK ("sourceLocationId" <> "destinationLocationId")

-- cannot promise more than exists
mb_reserved_non_negative      CHECK ("reservedQty" >= 0)
mb_reserved_within_on_hand    CHECK ("reservedQty" = 0 OR "reservedQty" <= "onHandQty")

-- cannot consume or return more than was issued
mil_returned_consumed_within_issued
  CHECK ("returnedBaseQty" + "consumedBaseQty" <= "issuedBaseQty")

-- a roll cannot grow
fr_current_within_original    CHECK ("currentLength" >= 0 AND "currentLength" <= "originalLength")

-- inspection cannot invent quantity
rmrl_inspection_within_received
  CHECK ("acceptedBaseQty" + "rejectedBaseQty" <= "receivedBaseQty")
```

Verified two ways without needing a live database: `scripts/verify-constraints.py`
checks every referenced column exists in the generated schema (112 references),
and `scripts/apply-migrations-check.mjs` applies both migrations to an in-process
Postgres and counts what was created.

## 14. Reconciliation checks

| Check | Question answered | Where |
|---|---|---|
| Ledger balance | Did anything write a balance without a movement? | `assertMaterialBalanced()` |
| Roll reconciliation | Did a roll length change without a movement? | `reconcileRollLengths()` |
| Stock count | Does the ledger match the physical shelf? | `StockCount` + variance movements |
| External reconciliation | Does Unicommerce agree with us? | `ExternalInventoryReconciliation` |

The first two need no external input and should run on a schedule. The third and
fourth compare against the world.
