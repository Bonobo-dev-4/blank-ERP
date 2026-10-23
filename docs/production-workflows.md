# Production Workflows

How quantity moves through the factory, and the rules that stop it being
double-counted. Domain logic implemented and tested in
`packages/domain/src/production/stage-ledger.ts`; screens arrive in phase 3.

---

## 1. The problem this solves

The specification states it directly: *cutting completed 100, stitching 85,
finishing 60, QC passed 50, inwarded 40.* A naive system adds those up and
reports 335 garments produced from a batch of 100.

The real answer is that the batch has produced **50 QC-passed garments** and has
50 in progress spread across stages. Getting that right is what the stage ledger
is for.

## 2. Production hierarchy

```
ManufacturingOrder          one style, a due date, a frozen BOM version
  └── ManufacturingOrderItem   one SKU — the size/colour breakdown
        └── ProductionBatch       one SKU, one barcode, a quantity
              ├── ProductionStageTask   one per (batch, route step)
              └── ProductionUnit        serialised garment, own barcode
```

A **batch is always one SKU**. A batch spanning sizes would make stage counters
meaningless, because "85 completed" would not say which sizes.

A **consolidated batch may serve several source orders** — that is the whole
point of consolidation — but `DemandAllocation` keeps the mapping back to each
original demand line, so a Shopify customer's garment is still traceable.

## 3. Routes are configurable

A route is an ordered list of stage steps. Not every garment needs every stage,
so a style with no embroidery uses a route that omits it rather than a route with
a stage someone has to remember to skip.

Default route `STD-GARMENT` (12 steps):

```
01 RELEASE          → 02 MATERIAL_ISSUE  → 03 CUTTING    → 04 EMBROIDERY
05 STITCHING        → 06 WASHING         → 07 FINISHING  → 08 QC
09 PRESSING         → 10 TAGGING         → 11 PACKING    → 12 FG_INWARD
```

`PLAIN-GARMENT` (10 steps) drops embroidery and washing.

Per-step configuration: `standardMinutes` for capacity, `slaHours` for delay
flagging, `defaultJobWorkerId`. Per-stage flags: `consumesMaterial`,
`allowsJobWork`, `requiresQc`, `serialisesUnits`, `isTerminal`.

## 4. The stage counters

One `ProductionStageTask` per (batch, route step). All counters are **cumulative
totals**, never running balances, so an event can always be replayed to the same
state.

| Counter | Meaning |
|---|---|
| `receivedQty` | Accepted into this stage (released, or forwarded from the previous stage) |
| `completedQty` | Finished here and eligible to go downstream |
| `rejectedQty` | Scrapped here |
| `reworkSentQty` | Cumulative quantity ever sent out to rework from here |
| `reworkReturnedQty` | Cumulative quantity ever returned from rework to here |
| `forwardedQty` | Cumulative quantity handed to the next stage |

Two derived figures do the work:

```
reworkOutstanding  = reworkSentQty − reworkReturnedQty
wipAtStage         = receivedQty − completedQty − rejectedQty − reworkOutstanding
availableToForward = completedQty − forwardedQty
```

### Why rework counters are cumulative

A garment can be reworked twice. If `reworkQty` meant "currently out", a second
pass would have no way to record that it had been out before, and
`reworkSent + reworkReturned ≤ received` would fail on a legitimate loop.

With cumulative counters, 10 sent → 10 returned → 10 sent again gives
`sent = 20, returned = 10, outstanding = 10`, and the stage still only ever
received 100. A garment reworked twice is still one garment.

## 5. The five operations

Each is a pure function returning deltas, validated before anything is written.

### `planRelease(batch, firstTask, qty)`

Puts quantity into step 1. Bounded by `batch.plannedQty`, across all releases.
Refuses any step other than the first.

### `planStageOutcome(task, { completedQty, rejectedQty, reworkQty })`

The specification's cutting example: received 100, completed 95, rejected 5.

Bounded by `wipAtStage`. A **second identical submission therefore fails** rather
than silently doubling the numbers — genuine re-submission is handled upstream by
the scan idempotency key, so a retry is a no-op and a mistaken second entry is an
error.

### `planForward(fromTask, toTask, qty)`

Hands accepted quantity to the next stage. Two guards:

- The destination must be the **immediately following** step, so work cannot skip
  embroidery because nobody scanned it. Skipping needs
  `production.override_stage`.
- Bounded by `availableToForward` at the source. This is the arithmetic form of
  *"quantity cannot advance beyond the accepted quantity at the preceding
  stage"*.

Forwarding is one atomic operation: it increments `forwardedQty` at the source
and `receivedQty` at the destination in the same transaction. The chain cannot
break halfway.

### `planSendToRework` / `planReturnFromRework`

Rework is modelled as a **loop at the stage where the defect is attributed**,
not as a separate path. Quantity never leaves that stage's `receivedQty`, so it
is conserved across the loop.

`ReworkOrder.targetStageId` records which department does the physical fixing.
That is an assignment, not a second quantity path — which is what keeps the
arithmetic closed.

### `planFinalStageCompletion(batch, lastTask, outcome)`

Completing the **last** step of the route is what makes a garment "finished" at
the batch level. Any earlier stage completing does not.

## 6. Reading batch progress

`computeBatchProgress()` deliberately does **not** add completed quantities
together. For the specification's example:

| Stage | Received | Completed | Forwarded | Available to forward | WIP |
|---|---|---|---|---|---|
| Cutting | 100 | 100 | 85 | 15 | 0 |
| Stitching | 85 | 85 | 60 | 25 | 0 |
| Finishing | 60 | 60 | 50 | 10 | 0 |
| QC | 50 | 50 | 0 | 50 | 0 |

```
finishedQty   = 50    ← completedQty of the FINAL route step only
releasedQty   = 100
totalWipQty   = 50    ← released − finished − rejected − rework outstanding
```

Fifty garments exist. Fifty are in progress. Nothing produced 335.

## 7. Chain consistency

`assertRouteChainConsistent()` validates the whole route:

```
first stage received  ≤ batch released
stage[n] received     ≤ stage[n−1] forwarded     for every n
```

plus the per-task checks. Intended for the nightly reconciliation job and used
by the test suite.

## 8. Serialisation and batch splitting

### Serialisation

Turning a quantity-tracked batch into individually identified garments, normally
after cutting (`serialisesUnits` on the stage).

Bounded by eligible quantity, so a batch can never produce more serials than
garments. This is the failure the specification warns about from both ends: a
batch of 100 must not be representable as one finished unit, and one batch scan
must not be counted as 100 completed garments.

With `trackingMode = UNIT`, a unit scan creates a stage movement of qty 1 linked
to the unit *and* updates the batch stage counters through the same code path —
so unit-level and batch-level figures cannot disagree.

### Splitting

`planBatchSplit()` is a **partition**: children must account for exactly the
parent quantity. Splitting is never a way to create or lose garments. Parent-child
lineage is preserved via `ProductionBatch.parentBatchId`.

## 9. Quality control

`planQcVerdict()` requires the split to account for **exactly** the inspected
quantity:

```
passed + failed + rework + hold = inspected
```

An inspector who checks 50 garments must say what happened to all 50. Allowing
it to fall short would strand quantity in a state nothing reports on.

Only `passedQty` becomes sellable. FAIL, REWORK and HOLD stay out of finished
goods entirely — the arithmetic form of *"rejected units cannot become sellable
inventory"*. Backed by `pb_inwarded_within_qc_passed` at the database level.

`assertInspectableQty()` bounds inspection by `finishedQty − qcPassedQty`, so QC
cannot inspect garments production has not finished.

Defects may exceed the garment count (one garment, several defects) but cannot
exist with nothing failed.

## 10. Job work

Material and semi-finished goods issued to an external worker move to a
`JOB_WORKER` location. Still owned, not available to another order.

**Issuing is not completing.** `JobWorkOrder` tracks `assignedQty`, `issuedQty`,
`receivedQty`, `completedQty`, `rejectedQty`, `reworkQty` as separate figures.
Goods are only complete when they come back and are recorded at the stage.

Per-piece rate and total charge are held on the order and its lines, feeding
conversion cost in [costing](#12-costing).

## 11. The four workflows end to end

### A — Shopify order *(phase 4–5)*

```
order imported → line items split out
  → facility stock snapshot (timestamped; availability ≠ reservation)
  → confirmed allocation covers part of the line
  → ONLY the uncovered quantity becomes ManufacturingDemand
  → MO, BOM frozen, material reserved
  → cutting → embroidery → stitching → finishing → QC
  → FG inward → Unicommerce push → reconciliation
```

### B — Unicommerce bulk PO *(phase 4–5)*

```
bulk PO imported → SKU and size breakdown
  → ManufacturingDemand (deduplicated against Shopify by fingerprint)
  → MRP → procurement if short → MO
  → barcode-tracked production → QC
  → FG inward → external PO/GRN receiving → facility reconciliation
```

### C — Raw material *(phase 1, implemented)*

```
purchase order → approval
  → supplier delivery → GRN  (→ QC HOLD; rolls created and barcoded)
  → inspection        (→ accepted released to warehouse, rejected quarantined)
  → available to production
  → reservation → issue → consumption → return / wastage
```

### D — Rework *(phase 3)*

```
QC failure → defects recorded
  → rework order, department assigned
  → barcode movement out and back (quantity stays at the QC stage)
  → rework completed → reinspection
  → QC approval → FG inward
```

The garment keeps its original production identity throughout, because the
rework loop never moves it off its batch or its stage.

## 12. Costing

`MoCostEntry` holds planned and actual amounts per category: MATERIAL, WASTAGE,
CUTTING, EMBROIDERY, STITCHING, FINISHING, JOB_WORK, PACKAGING, OVERHEAD.

```
costPerAcceptedUnit = actualTotal / acceptedUnits
```

Divided by **accepted** units, not released units. Rejected garments consumed
material and labour but produced nothing sellable, so loading their cost onto the
good units is the only honest unit cost. For 100 released and 95 accepted, the
unit cost is higher than `total / 100`, and it should be.

Wastage analysis compares the **frozen BOM snapshot** against actual consumption.
Comparing against a BOM someone has since edited would measure the edit, not the
production run.

## 13. Guard summary

| Guard | Stops |
|---|---|
| `releaseQty + released ≤ plannedQty` | Releasing more than the batch holds |
| `completed + rejected + rework ≤ wipAtStage` | A stage disposing of garments it never received |
| `forwarded ≤ completed` | Advancing past the previous stage's accepted quantity |
| Destination must be the next step | Silently skipping a stage |
| `reworkReturned ≤ reworkSent` | More coming back than went out |
| Serialisation ≤ eligible quantity | More serials than garments |
| Split children sum to parent | Creating or losing garments in a split |
| `passed + failed + rework + hold = inspected` | Quantity stranded by an incomplete verdict |
| Only `passedQty` is sellable | Rejected garments reaching finished goods |
| `inspected ≤ finished − qcPassed` | Inspecting garments production has not finished |
| Scan idempotency key | A retried scan counting twice |
