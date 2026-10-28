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

### Proxy configuration (29 Oct 2026)

The ERP now reaches Unicommerce through `https://uc-proxy.dashanddot.com/uc`
(TLS; the previous route was plain HTTP to an IP — the §29 cleartext concern is
closed for this deployment). Configured by the operator's `UC_*` names, which
take precedence over the originals:

| `UC_*` | replaces | meaning |
|---|---|---|
| `UC_BASE_URL` | `UNICOMMERCE_BASE_URL` | proxy base, `/uc` prefix included |
| `UC_AUTH_HEADER` | — (was fixed `X-Proxy-Secret`) | header carrying the proxy secret |
| `UC_PROXY_SECRET` | `UNICOMMERCE_PROXY_SECRET` | the proxy's shared secret |
| `UC_READ_ENABLED` | `UNICOMMERCE_ENABLED` | connector on/off |
| `UC_WRITE_ENABLED` | `INTEGRATION_ALLOW_EXTERNAL_WRITES` | environment write switch |
| `UC_WRITE_CONFIRMATION_REQUIRED` | — | must stay `true`; `false` refuses all writes |

Verified read-only on 29 Oct: sign-in, `facility/get` and `saleOrder/search`
through the new proxy succeed; the previous secret is refused by it.

### Three independent gates on every external write

(Unicommerce writes today are facility switches only — §8h. They need
`UC_WRITE_ENABLED=true` with confirmation required, **Allow writes** on the
connection in Admin → Settings — an administrator's audited action — and a
person confirming each switch.)

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

## 8a. Facility master — VERIFIED against the live API, 23 Oct 2026

All seventeen codes supplied by the business are **real**. Confirmed with
`POST /services/rest/v1/facility/get`, which is the only call that separates a
wrong code from an inaccessible one.

| Code | Display name | `type` | `operationalType` | Visible to the service account |
|---|---|---|---|---|
| `dashanddot` | WarehouseII | WAREHOUSE | WAREHOUSE | yes — **default** |
| `WH_Noida_3` | Online DashAndDot | WAREHOUSE | WAREHOUSE | yes |
| `WH_Noida` | Production | WAREHOUSE | WAREHOUSE | yes |
| `ST_Dhanmill` | The Dhan mill | WAREHOUSE | **STORE** | yes |
| `ST_Pacific_DEL` | Pacific Mall Tagore Garden | WAREHOUSE | **STORE** | yes |
| `ST_Mmchandigarh_CH` | MM Chandigarh | WAREHOUSE | **STORE** | yes |
| `ST_dlfpromenade_DL` | DLF Promenade | WAREHOUSE | **STORE** | yes |
| `ST_dlfavenue_DL` | DLF Avenue | WAREHOUSE | **STORE** | yes |
| `ST_Zora_Mall` | Zora The Mall | WAREHOUSE | **STORE** | yes |
| `ST_KGF_Mumbai` | Kala Ghoda Fort | WAREHOUSE | **STORE** | yes |
| `ST_Exibition_NO` | Exibition | WAREHOUSE | **STORE** | yes |
| `WH_Second_Floor` | Second Floor | WAREHOUSE | **STORE** | yes |
| `International_Warehouse` | — | — | — | **no — access denied** |
| `CWH` | — | — | — | **no — access denied** |
| `Coords_Warehouse` | — | — | — | **no — access denied** |
| `MBO` | — | — | — | **no — access denied** |
| `ST_PhoenixPalladium` | — | — | — | **no — access denied** |

A deliberately invented code returns `INVALID_FACILITY_CODE`, which is how the
five above are known to be genuine rather than typos.

### What the probe settled

**The ambiguous default code is correct.** `dashanddot` resolves to
"WarehouseII". That was the single most important code to confirm, because it
is the default push destination, and it is the one that did not split the way
every other row did.

**The `type` field is useless and `operationalType` is the only discriminator.**
This is stronger than previously suspected. *Every* facility reports
`type: WAREHOUSE`, retail shops included — so Kala Ghoda Fort and the Noida
production warehouse are indistinguishable by `type`. Only `operationalType`
separates STORE from WAREHOUSE. Reading `type`, or parsing the `WH_`/`ST_`
prefix, puts eleven shops in the warehouse bucket.

`WH_Second_Floor` remains the trap that proves it: a `WH_` prefix, `type:
WAREHOUSE`, and `operationalType: STORE`. It also **holds real stock** — it was
the only facility carrying inventory of the SKU probed.

**Five facilities are invisible, and that bounds facility switching.** The
service account is denied `LOOKUP_INVENTORY` at `International_Warehouse`,
`CWH`, `Coords_Warehouse`, `MBO` and `ST_PhoenixPalladium`. An
"is it available elsewhere?" search therefore covers **12 of 17** facilities.
The connector must say so rather than reporting a partial search as a complete
one — see decisions.md §31.

**The Disabled status could not be verified.** `CWH` and `Coords_Warehouse`
were supplied as Disabled, but access is denied, so their `enabled` flag is
unreadable. Every *visible* facility reports `enabled: true`. Treat the Disabled
claim as still unconfirmed, and keep `isPushEnabled` false for both.

### What this list means for the system

Eleven of the seventeen are retail stores. That is what makes "switch facility
if the piece is available somewhere else" an *omnichannel routing* question
rather than a warehouse one, and it is why `sync.change_facility` is a separate
elevated permission: moving a push from the production warehouse to a shop in
Chandigarh is a commercial decision, not a clerical one.

## 8d. Verified endpoint map

Everything below was exercised against the live tenant on 23 Oct 2026. Paths
are **case-sensitive and inconsistent** — `saleOrder/search` is camelCase while
`saleorder/get` is not. Guessing the casing returns 404.

| Purpose | Method + path | Notes |
|---|---|---|
| Token | `GET /oauth/token` | Not under `/services/rest/v1/`. `grant_type=password`, `client_id=my-trusted-client`. ~7h lifetime |
| Facility detail | `POST /services/rest/v1/facility/get` | `{facilityCode}`. The only honest code validator |
| Inventory | `POST /services/rest/v1/inventory/inventorySnapshot/get` | `{itemTypeSKUs:[...]}` + `Facility` header, **which it enforces** |
| Order search | `POST /services/rest/v1/oms/saleOrder/search` | **31-day window cap.** Ignores the `Facility` header |
| Order detail | `POST /services/rest/v1/oms/saleorder/get` | `{code}` → `saleOrderDTO` |
| Item master | `POST /services/rest/v1/catalog/itemType/get` | `{skuCode}` |
| Inventory adjust | `POST /services/rest/v1/inventory/adjust` | **Exists; schema NOT probed.** Needs authorisation first |
| Purchase order | `POST /services/rest/v1/purchase/purchaseOrder/create` | Exists; requires `vendorCode`. Not probed further |

The two write endpoints were confirmed to exist using **empty request bodies
only** — a payload that names no SKU and no quantity cannot change inventory.
Their field schemas are deliberately unknown; establishing them means sending
a real payload, which §6 forbids without explicit authorisation.

### The order payload, and the join to Shopify

`saleOrderDTO.saleOrderItems[]` is where the useful fields live:

- `facilityCode` / `facilityName` — **per line item**, not per order. One order
  can be served from several facilities.
- `alternateFacilityCode` — Unicommerce's own answer to "available elsewhere?".
- `allocatedQuantity`, `unallocatedQuantity`, `inProcessQuantity`,
  `completedQuantity`, `cancelledQuantity`, `unfulfillableQuantity` — note that
  these are **stage counters and must never be summed**, exactly as with
  internal production quantities.
- `itemSku` / `sellerSkuCode` — e.g. `W/2769-L-49295244427434`, which **embeds
  the Shopify variant id** (`49295244427434`) after the style and size.

The order header carries `source: SHOPIFY` and `displayOrderCode: #170717`,
which matches the Shopify order *name*. **That is the join between the two
systems**, and it is a far more reliable key than SKU text matching.

### The inventory snapshot is sixteen numbers, not one

`inventorySnapshot/get` returns `inventory`, `openSale`, `openPurchase`,
`putawayPending`, `inventoryBlocked`, `pendingStockTransfer`, `vendorInventory`,
`virtualInventory`, `pendingInventoryAssessment`, `badInventory`,
`inventoryNotSynced`, `batchRecallQuantity`, `quantityNotFound`,
`excessQuantity`, `quarantinedInventory`, `ageingStockInventory`.

The probed SKU showed `inventory: 0`, `inventoryBlocked: 1`,
`pendingInventoryAssessment: 5` at the default facility. Reading `inventory`
alone would call that "nothing here" while six units sit in the building in
states that are not sellable but are not absent either. **Which of these counts
as available is a business decision, not a technical one** — see §5.

## 8b. Network constraint: Unicommerce requires a whitelisted IP

The business's existing integration (a Google Apps Script poller) reaches
Unicommerce through a fixed-IP proxy because **Unicommerce whitelists source
IPs**. That is a hard constraint on where this ERP can run:

- A development machine on a domestic connection will be refused.
- A container on a platform with rotating egress addresses will be refused
  intermittently, which is worse — it will look like a flaky API.

Either the ERP's egress IP is whitelisted, or it routes through the same proxy.
The decision belongs in deployment, but it has to be made before the connector
is written, because "works locally, fails in staging" is the expensive way to
discover it.

**The existing proxy is not reusable as-is:** it is plain HTTP on a bare IP, so
the Unicommerce credentials cross the public internet in cleartext, and it
authenticates with a shared static secret. A replacement needs TLS and
credentials that are not a person's login — see §8c.

## 8c. Credentials: a service account, not a person's login

The existing integration signs in with a named employee's email and password.
That must not carry over, for three reasons that have nothing to do with
secrecy:

1. **It breaks when that person changes their password**, and the failure
   surfaces as a sync outage with no obvious cause.
2. **It breaks when that person leaves.** The integration's access is tied to
   employment.
3. **It inherits that person's permissions.** A human admin can do far more in
   Uniware than an inventory push needs, so a bug in the connector has the blast
   radius of a senior user rather than of a narrowly scoped client.

What to ask Unicommerce for: API client credentials (`UNICOMMERCE_CLIENT_ID` /
`UNICOMMERCE_CLIENT_SECRET`) scoped to the operations in §2, for a service
account that is not a mailbox.

## 8e. Demand does not arrive only from Shopify

A 45-day order pull returned 6,792 orders with four distinct sources:

| `source` | Orders | Share |
|---|---|---|
| `SHOPIFY` | 6,573 | 96.8% |
| `NYKAA_FASHION` | 135 | 2.0% |
| `MYNTRAPPMP` | 83 | 1.2% |
| `AUDACITY` | 1 | — |

**This changes the demand picture.** Building demand purely from the Shopify
connector would silently miss ~3% of orders — the marketplace channels never
touch Shopify, so nothing in that import would reveal they exist. Unicommerce
is the only system that sees all four.

The same pull splits `channel` into `WAREHOUSE` (4,689) and `STORE` (1,884),
which is an independent confirmation that retail is a substantial share of
volume rather than a rounding error.

## 8f. Quantities on a sale order line can be null

Every quantity field on a `CREATED` line — `totalQuantity`, `allocatedQuantity`,
`unallocatedQuantity`, `inProcessQuantity`, `completedQuantity`,
`cancelledQuantity`, `unfulfillableQuantity` — comes back **null**, not zero.

`null` means Uniware did not report the figure. Coercing it to `0` would state
"none of these were allocated" on the authority of a field the API declined to
answer, and that number would then flow into a manufacturing decision. The
connector keeps them nullable and the UI must render "not reported" rather than
a confident zero.

These are also **stage counters**: allocated, inProcess and completed describe
the same garment at different points, so summing them double-counts exactly as
summing cutting + stitching + finishing would internally.

## 8g. Purchase orders cannot be read on this tenant

Probed against the live API on 23 Oct 2026. Six documented paths for reading
purchase orders all returned **404**:

```
/services/rest/v1/purchase/purchaseOrder/search
/services/rest/v1/purchase/purchaseOrder/get
/services/rest/v1/purchase/searchPurchaseOrder
/services/rest/v1/oms/purchaseOrder/search
/services/rest/v1/purchase/purchaseOrder/list
/services/rest/v1/inventory/purchaseOrder/search
```

Meanwhile `POST /services/rest/v1/purchase/purchaseOrder/create` responds
normally (it asks for `vendorCode`). So the module is present and the account
can write, but **reading purchase orders is either unavailable or not
permitted** for this service account.

That settles what the Bulk POs screen can be. It states the block rather than
rendering an empty grid, because an empty grid reads as *no bulk orders exist*
— a different and false claim from *this system cannot be asked*.

It also narrows, without closing, the open question about where bulk
manufacturing demand comes from. It is not reachable through this API today.

## 8h. Facility switch — moving one sale-order item to another facility

`POST /services/rest/v1/oms/saleorder/facility/switch` with
`{facilityCode, saleOrderCode, saleOrderItemCodes[]}` and a `Facility` header
(the item's current facility). Tenant level. Documented, **never yet sent from
this ERP**: the endpoint is on the transport's refused-write list, and only
`UnicommerceClient.switchFacility()` can carry it.

### Measured on the live tenant, 28 Oct 2026 (read-only)

- A Shopify order's Unicommerce `code` **is the Shopify order id**
  (`legacyResourceId`); its `displayOrderCode` is the order name (`#170717`).
  Six of six orders checked.
- Each sale-order item's `code` **is the Shopify line-item id**, one item per
  unit; the SKU ends in the Shopify variant id.
- Fresh items are `CREATED` with no shipping package; `UNFULFILLABLE` and
  `DISPATCHED`/`SHIPPED` were also seen.

The ERP uses these only to *find and prove* the pairing. The codes sent are
always the ones Unicommerce returned.

### Rules

- **Eligibility** (`evaluateFacilitySwitch` in `@dnd/domain`): order
  `CREATED`/`PROCESSING`; item `CREATED`/`FULFILLABLE`/`UNFULFILLABLE`, not on
  hold; no shipping package or one still `CREATED`; item matched to its ERP line;
  Shopify still shows units open; target configured, visible and enabled; target
  stock read within two minutes and at least one unit; no other switch holding
  the item; writes enabled. Unicommerce documents no preconditions, so these are
  deliberately conservative — widen them only after a verified switch.
- **Stock** is Unicommerce's documented `inventory` ("Available quantity").
  `openSale` and the held buckets are shown beside it, never subtracted again.
  It is not a reservation.
- **Gates.** `INTEGRATION_ALLOW_EXTERNAL_WRITES=true` *and*
  `IntegrationConnection(UNICOMMERCE).allowExternalWrites=true` *and* the
  `demand.switch_facility` permission *and* a 30-second preflight token bound to
  the operator, order, item, source and target. Both write flags are **off**.
- **Once only.** The operation is stored before sending, with a unique per-item
  lock; `submittedAt` is written before the request and nothing re-sends.
- **Success is what Unicommerce shows afterwards.** `successful:true` is a
  claim; the order is read back (three attempts) and only the item at the
  target counts. A timeout or an acceptance that did not take is
  `VERIFICATION_PENDING` until a person checks or confirms it was not applied.
- **Production is reviewed, never changed.** A verified switch with live demand
  behind it becomes `RECONCILIATION_REQUIRED` with what production has done
  (stage, issues, scans, completions); nothing is cancelled or reversed.
- **History is append-only** at the database: `facility_switch_events` refuses
  UPDATE and DELETE, and operations cannot be deleted.

### Still unverified

- The response to a real switch, and whether the `Facility` header must be the
  source facility. Both need one authorised switch on a test order.
- Whether Unicommerce allows a switch once a package exists in `CREATED`.
- Five facilities are invisible to the service account (§8a), so they can never
  be targets: their stock cannot be read.

## 9. Implementation checklist

Phase 4 — **done, verified against the live tenant 23 Oct 2026**:

- [x] Confirm the tenant base URL and the authentication scheme
      — `GET /oauth/token`, password grant, ~7h opaque bearer (§8d)
- [x] Confirm facility master endpoint and the exact facility codes
      — `facility/get`; **all 17 codes confirmed real** (§8a)
- [x] Confirm the inventory availability endpoint
      — `inventorySnapshot/get`, 16 separate counters (§8d)
- [x] Confirm the item master endpoint for SKU mapping
      — `catalog/itemType/get`; SKUs embed the Shopify variant id (§8d)
- [x] Confirm pagination and limits
      — sale-order search caps at **31 days**; no cursor, one page per window
- [x] Confirm the business-level success/failure shape
      — HTTP 200 with `successful:false` (decisions.md §30)

Still open, and none of it is code:

- [ ] **Confirm which document type carries bulk manufacturing demand.**
      Narrowed twice and still open: marketplace orders (§8e) are retail, not
      bulk, and purchase orders cannot be read at all (§8g).
- [ ] Confirm the egress IP the ERP will call from, and get it whitelisted (§8b)
- [ ] Obtain API client credentials for a service account, not a person (§8c)
      — now **urgent**: the token this account receives carries `write` scope
- [ ] Get the service account visibility at the five facilities it cannot see,
      or accept that availability search is permanently partial (§8a)
- [ ] Confirm whether `inventorySnapshot` figures are live or cached

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
