# Unicommerce Integration

**Status: contract defined, connector not built. Phases 4–5.**

> ### Verification required before implementation
>
> **This is the highest-risk integration in the system.** It is the only place
> the ERP writes outward, and a mistake credits real sellable inventory that does
> not exist.
>
> Nothing in §4–§6 is a verified API surface. Endpoint paths, authentication
> scheme, request and response shapes, and — most importantly — **which business
> document type represents bulk manufacturing demand in this particular Uniware
> account** must all be confirmed against the account's own API documentation
> before implementation.
>
> This document was written without access to the Uniware API documentation or
> the account. Every endpoint name below is a **placeholder** describing intent.
> Treat all of §4–§6 as a specification of what must be discovered, not as an
> implementation plan.

---

## 1. What Unicommerce is used for

| Purpose | Direction | Phase |
|---|---|---|
| Finished product master mapping | read | 4 |
| Facility master | read | 4 |
| Bulk purchase order import → manufacturing demand | read | 4 |
| Facility-level inventory availability | read | 4 |
| **Finished goods inventory posting** | **write** | 5 |
| Inventory reconciliation | read | 5 |

Everything except the one write is a read. That asymmetry is the point: the
blast radius of this integration is concentrated in a single operation, so that
operation gets a disproportionate share of the safeguards.

## 2. Configuration

```
UNICOMMERCE_ENABLED=false                 master switch, off by default
UNICOMMERCE_BASE_URL=""                   [VERIFY] tenant-specific
UNICOMMERCE_CLIENT_ID=""                  [VERIFY] auth scheme unconfirmed
UNICOMMERCE_CLIENT_SECRET=""
UNICOMMERCE_USERNAME=""
UNICOMMERCE_PASSWORD=""
UNICOMMERCE_DEFAULT_FACILITY_CODE=""

INTEGRATION_ALLOW_EXTERNAL_WRITES=false   master switch for ALL external writes
```

### Three independent gates on every external write

A push happens only when **all three** are true:

1. `INTEGRATION_ALLOW_EXTERNAL_WRITES=true` — environment level. Off by default
   in every environment, so a developer running this locally against production
   credentials is not one typo away from crediting real stock.
2. `IntegrationConnection.allowExternalWrites=true` — per connection.
3. An approved `InventoryPushJob` — per transaction, with a human approval.

Plus a fourth, per destination: `ExternalFacility.isPushEnabled`. A facility that
has not been explicitly approved cannot be pushed to, which is how "never
silently push inventory to the wrong facility" is enforced.

`previewPush()` refuses on each of these with a distinct error code, so the
reason a push is blocked is never ambiguous.

## 3. Facility master

```
ExternalFacility
  externalCode     the exact external identifier, preserved verbatim
  displayName      "The Dhan Mill"
  mirrorLocationId optional internal location that mirrors it
  isPushEnabled    false until explicitly approved
  isDefault        at most one per provider (partial unique index)
```

Expected facilities: `HEAD OFFICE`, `THE DHAN MILL`, `PACIFIC MALL`,
`CHANDIGARH`. **[VERIFY]** the exact codes — they are matched literally, and a
transposed code sends inventory to the wrong shop.

`externalCode` is never normalised, uppercased or trimmed on the way in. It is
whatever the external system calls it.

## 4. Bulk purchase order import **[VERIFY — the whole section]**

### The question that must be answered first

The specification says it directly: *validate how the actual Unicommerce account
represents bulk manufacturing demand. If demand originates in a different
document type, support an appropriate mapped connector.*

A Unicommerce "purchase order" may be:

- a PO **to** DASH AND DOT from a wholesale customer — i.e. demand to manufacture
- a PO **from** DASH AND DOT to a supplier — i.e. procurement, not demand
- a stock transfer between facilities
- something else entirely in this account's configuration

**These are not interchangeable.** Importing the wrong direction would create
manufacturing demand for goods the company is buying, not making — and the
factory would make them.

So the first implementation task is not writing a client. It is sitting with the
Unicommerce account and establishing which document type carries bulk
manufacturing demand. Until that is answered, `UnicommercePurchaseOrder` is a
container with no connector filling it.

### Intended data model

```
UnicommercePurchaseOrder        raw, verbatim, rawPayload retained
  └── UnicommercePurchaseOrderLine
        ↓ derived
ManufacturingDemand (deduplicated against Shopify by fingerprint)
  └── DemandSourceMapping  sourceSystem=UNICOMMERCE, sourceDocType=…
```

Fields the model expects: PO id and number, date, supplier, destination facility,
SKU, product name, quantity, expected delivery date, status, received quantity,
pending quantity.

`externalVersion` holds the external amendment counter, for the stale-write guard.

### Supported cases

| Case | Handling |
|---|---|
| Full PO manufacturing | One demand per line |
| Partial PO manufacturing | `manufacturingQty` < `orderedQty` |
| Multiple SKUs per PO | One line each |
| One SKU in multiple sizes | One line per size; each maps to its own variant |
| Multiple MOs against one PO | `DemandAllocation` rows, many-to-one |
| PO amendment | `UPDATE_QUANTITY` with a delta |
| PO cancellation | Demand cancelled; released production flagged for a decision |
| Quantity reconciliation | `receivedQty` / `pendingQty` tracked per line |

`UNIQUE (organizationId, externalId)` on the order and
`UNIQUE (organizationId, externalLineId)` on the line make a re-run import a
no-op.

## 5. Facility inventory availability **[VERIFY]**

```
FacilityInventorySnapshot
  externalFacilityId, productVariantId / externalSku
  availableQty, reservedQty, inTransitQty, totalQty
  snapshotAt     when the EXTERNAL system reported this
  fetchedAt      when we asked
  rawPayload
```

Two timestamps, not one, because the difference matters: a figure Unicommerce
computed an hour ago and served from cache is not the same as a figure it
computed when asked.

A snapshot is **evidence, never a reservation**. See
[shopify-integration.md](shopify-integration.md) §6.

## 6. Finished goods inventory push — the dangerous one

### Choosing the operation

```ts
resolvePushOperation({ hasExternalPurchaseOrder, requestedKind, adjustmentApprovedByUserId })
```

| Situation | Operation |
|---|---|
| Inward linked to an external PO | `GRN_AGAINST_PURCHASE_ORDER` |
| No external PO | `INVENTORY_ADJUSTMENT` |
| Overwriting external inventory | `INVENTORY_OVERRIDE`, **approval required** |

A PO-linked inward **cannot** be pushed as an adjustment. The function throws
`PO_RECEIVING_REQUIRED` rather than quietly substituting one for the other,
because the specification is explicit: *do not use stock adjustment as a
substitute for proper purchase-order receiving without verifying the intended
business workflow.*

The reason is operational, not pedantic. An adjustment credits stock but leaves
the external PO showing nothing received. The wholesale customer's PO never
closes, nobody can invoice against it, and the discrepancy surfaces weeks later
in a reconciliation nobody can explain.

**[VERIFY]** which Uniware API operations correspond to each of the three kinds.
This mapping is the single most important thing to confirm before phase 5.

### The push lifecycle

```
DRAFT → READY → PENDING → PROCESSING → ┬→ SUCCESS
                                       ├→ PARTIAL_SUCCESS → RECONCILIATION_REQUIRED
                                       ├→ FAILED → READY (retry allowed)
                                       └→ RECONCILIATION_REQUIRED → RECONCILED → READY
```

`PUSH_TRANSITIONS` in `packages/domain/src/integrations/push.ts` encodes this and
`assertPushTransition()` enforces it.

**Note what is absent: there is no edge from `RECONCILIATION_REQUIRED` back to
`PENDING` or `READY`.** An uncertain outcome can only leave that state through
`RECONCILED`, after something has actually read the external system's inventory.
Retrying blind is exactly how inventory gets credited twice. The state machine
makes it unreachable.

### Operator workflow

1. Select eligible inward records
2. Select or verify the destination facility
3. Review quantities
4. **Preview** — validates SKU mappings, facility enablement, quantity ceilings
   and whether the facility differs from the one the inward was raised against
5. Confirm (a changed facility needs `sync.change_facility`)
6. Job queued with a generated `externalRequestId`
7. Status displayed
8. Reconcile against Unicommerce

Everything that could go wrong surfaces at preview, not at submit:

| Blocked line | Code |
|---|---|
| SKU has no external mapping | `SKU_NOT_MAPPED` |
| Already fully pushed | `NOTHING_ELIGIBLE` |
| Requested exceeds eligible | `PUSH_EXCEEDS_ACCEPTED` |
| Facility not approved for pushes | `FACILITY_PUSH_DISABLED` |
| Environment forbids writes | `EXTERNAL_WRITES_DISABLED` |

### Preventing a double credit

Four layers, because this is the failure that costs real money:

1. **Quantity ceiling.** `FinishedGoodsInwardLine.pushedQty` tracks what has been
   accepted externally. `eligiblePushQty = acceptedQty − pushedQty`.
2. **Database constraint.** `fgil_pushed_within_accepted` —
   `pushedQty ≤ acceptedQty`. Cannot be violated by any code path.
3. **Re-check inside the transaction.** `assertPushableNow()` runs with the
   inward lines locked, because the preview may be minutes old and another
   operator may have pushed in between.
4. **External idempotency.** A client-generated `externalRequestId`, unique per
   organisation, is sent with the call so a retry is idempotent on
   Unicommerce's side too — **[VERIFY]** that the API honours such a key, and if
   it does not, the reconciliation path in §6 becomes the only protection and
   must be mandatory rather than advisory.

Plus `UNIQUE (inventoryPushJobId, finishedInwardLineId)`: one inward line appears
at most once per job.

### Interpreting the response

```ts
classifyPushOutcome({ httpStatus, businessSuccess, transportUncertain, ... })
```

Two rules, both of which the specification insists on:

**HTTP 200 is not success.** Enterprise APIs commonly return 200 with
`successful: false` and an error list in the body. Only an explicitly parsed
business-level success counts. An unparseable response is treated as *uncertain*,
not as success.

**A timeout is not a failure.** The request may well have been applied. That
outcome goes to `RECONCILIATION_REQUIRED` with:

> *"The call did not return a definite outcome; the quantity may or may not have
> been credited externally. Reconcile against external inventory before any
> retry."*

| Outcome | Status |
|---|---|
| `businessSuccess === true` | `SUCCESS` |
| `businessSuccess === false` | `FAILED` — retry allowed |
| `transportUncertain` | `RECONCILIATION_REQUIRED` — **no retry** |
| Uninterpretable | `RECONCILIATION_REQUIRED` |

### Reconciliation

```ts
reconcile({ erpQty, externalQty })
```

| Variance | Recommendation |
|---|---|
| Zero | `MARK_RECONCILED` |
| External **lower** | `RETRY_SHORTFALL` — the posting did not land |
| External **higher** | `INVESTIGATE_OVERAGE` |

An overage is never corrected automatically. It means inventory was credited more
than once, and silently adjusting it down would hide a real integration defect —
the next one would be invisible too. It is raised for a human.

Every comparison is recorded in `ExternalInventoryReconciliation` with both
quantities, the variance, when it was observed and the raw payload. Nothing is
marked reconciled without one of these rows existing.

### If a push fails

The stock stays in the ERP with `syncStatus = SYNC_FAILED` or
`RECONCILIATION_REQUIRED`. It is **not** rolled back — the garments physically
exist and were genuinely inwarded; only the external posting failed. Rolling back
the inward would make the ERP lie about its own warehouse to compensate for a
network error.

`FinishedGoodsBalance` separates `pendingSyncQty` from `syncedQty` so the gap is
visible rather than inferred.

## 7. The six finished goods states

The specification asks for these to be kept distinct, and
`summariseFinishedGoods()` returns all six separately:

| State | Meaning |
|---|---|
| Produced | Completed the final production stage |
| QC passed | Approved by final QC |
| Inwarded in ERP | Recorded into ERP finished goods stock |
| Pending external sync | Inwarded, not yet accepted externally |
| Accepted by Unicommerce | Confirmed by the **business** response |
| Reconciled | Verified against Unicommerce's own inventory figures |

Each is a different question, and the difference between the last three is where
double-crediting hides.

## 8. Observability

`SyncLog` records every outbound call: operation, verbatim request and response,
HTTP status, parsed business success, duration, attempt number, and
`outcomeUncertain`. Indexed by `externalRequestId`, so an uncertain posting can
be found by the id that was sent rather than by guesswork.

`InventoryPushJob` retains `requestPayload` and `responsePayload` verbatim for
dispute handling. When Unicommerce and the ERP disagree about what was sent,
both sides of the conversation are on record.

## 9. Implementation checklist

Phase 4:

- [ ] Confirm the tenant base URL and the authentication scheme
- [ ] **Confirm which document type carries bulk manufacturing demand**
- [ ] Confirm facility master endpoint and the exact facility codes
- [ ] Confirm the inventory availability endpoint and whether its figures are
      live or cached
- [ ] Confirm rate limits and pagination
- [ ] Confirm the item master endpoint for SKU mapping

Phase 5 — none of this starts until the above is done:

- [ ] **Confirm which operation corresponds to GRN-against-PO receiving**
- [ ] **Confirm which operation corresponds to an inventory adjustment**
- [ ] **Confirm whether the API honours a client-supplied idempotency key**
- [ ] Confirm the business-level success/failure shape of each response
- [ ] Confirm the inventory read used for reconciliation
- [ ] Rehearse the full reconciliation path in a sandbox facility, including a
      deliberately timed-out request

The last item is not optional. The uncertain-outcome path is the one that
protects real inventory, and a path that has never been exercised is a path that
does not work.
