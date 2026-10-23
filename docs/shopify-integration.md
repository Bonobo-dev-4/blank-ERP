# Shopify Integration

**Status: contract defined, connector not built. Phase 4.**

> ### Verification required before implementation
>
> Everything in §4 and §5 below is a **design intent**, not a verified API
> surface. Field names, connection shapes and webhook topics must be confirmed
> against the Shopify Admin API documentation for the pinned version, and against
> the actual scopes granted to the DASH AND DOT app, **before** any of it is
> written.
>
> The specification is explicit: *do not invent API endpoints*. Nothing here
> should be treated as confirmed. Items marked **[VERIFY]** are the ones most
> likely to differ from what is written.
>
> This document was produced without live access to the Shopify schema, so the
> field names are from recollection of the Admin GraphQL API and are flagged
> accordingly.

---

## 1. Direction of the relationship

Shopify is the **commerce system**. This ERP reads from it and writes nothing to
it.

| Operation | Allowed? |
|---|---|
| Read orders, line items, products, variants, inventory levels | Yes |
| Receive order webhooks | Yes |
| Create a shipment or fulfilment | **No** |
| Capture or refund a payment | **No** |
| Change a fulfilment status | **No** |
| Change inventory levels in Shopify | **No** |

The last one deserves a note: Shopify inventory is driven by Unicommerce in this
architecture, not by the ERP. The ERP's outward write path is finished goods into
Unicommerce, and Unicommerce propagates to Shopify. Writing to both would create
two sources of truth for the same number.

Should Shopify writes ever be wanted, they would be a separate, separately
authorised feature — not an extension of the import.

## 2. Configuration

```
SHOPIFY_ENABLED=false                     master switch, off by default
SHOPIFY_SHOP_DOMAIN=""                    e.g. dash-and-dot.myshopify.com
SHOPIFY_ADMIN_API_VERSION="2025-07"       [VERIFY] pin a supported version
SHOPIFY_ADMIN_ACCESS_TOKEN=""             never committed; secret store in prod
SHOPIFY_WEBHOOK_SECRET=""                 HMAC verification
```

`IntegrationConnection` holds the non-secret configuration and a `credentialRef`
— an opaque pointer into the configured secret store. **Credentials are never
stored in this database.**

A pinned API version is deliberate. Shopify versions expire; an unpinned client
silently changes behaviour on a schedule nobody at the factory is watching.

### Required scopes **[VERIFY]**

Expected: `read_orders`, `read_products`, `read_inventory`, `read_locations`. The
actual grant must be confirmed against the app's configuration — and note that
reading orders older than 60 days requires an additional scope in Shopify.

## 3. Data model

Imported documents are stored **verbatim** and separately from manufacturing
demand:

```
ShopifyOrder          ← the order as Shopify describes it, rawPayload retained
  └── ShopifyOrderLine   ← per line: ordered, cancelled, fulfilled, refunded
                            plus availability, allocation, manufacturing qty

ManufacturingDemand  ← DERIVED. Only the uncovered quantity.
  └── DemandSourceMapping ← records that this Shopify line was the source
```

Keeping them separate matters. The raw order is evidence of what Shopify said;
demand is a decision the ERP made. Conflating them means an amended order rewrites
history, and an import bug becomes indistinguishable from a planning decision.

`externalUpdatedAt` holds the Shopify `updatedAt` of the version processed, so a
late-arriving older webhook can be discarded rather than overwriting newer data.

## 4. Order import **[VERIFY — all field names]**

Shopify GraphQL Admin API. The intended shape:

```graphql
# [VERIFY] every field name, nesting and connection shape
query ImportOrders($cursor: String, $query: String) {
  orders(first: 50, after: $cursor, query: $query, sortKey: UPDATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id                    # gid://shopify/Order/…  → ShopifyOrder.externalId
      name                  # "#158420"
      createdAt
      updatedAt
      cancelledAt
      displayFinancialStatus
      displayFulfillmentStatus
      note
      tags
      lineItems(first: 100) {
        nodes {
          id                # gid://shopify/LineItem/… → externalLineId
          quantity
          sku
          title
          variant { id sku }
          # [VERIFY] the correct field for cancelled / refunded quantity —
          # Shopify exposes several related figures and they are NOT
          # interchangeable for this purpose
        }
      }
    }
  }
}
```

### Channel classification

The specification requires `ONLINE`, `POS` and `CUSTOM` to be distinguished,
because a POS sale is already in a customer's hands and an online order is not —
which changes the urgency of the manufacturing decision.

**[VERIFY]** the correct discriminator. Candidates to confirm: the order's
`publication` / sales channel, `app` attribution, or the presence of a POS
`retailLocation`. Guessing here would misclassify every order, so the connector
must not ship until it is confirmed on real data from this shop.

When a POS order is identified, its location is recorded on
`ShopifyOrder.posLocationId` / `posLocationName`.

### Pagination and rate limits **[VERIFY]**

The Admin GraphQL API uses a calculated-cost leaky bucket, not a simple request
count. The connector must read the throttle status returned with each response
and back off on it, rather than assuming a fixed rate. Cursor pagination over
`updatedAt` with a high-water mark makes the import resumable.

## 5. Webhooks **[VERIFY topics]**

Expected topics: order creation, order update, order cancellation, and the
fulfilment events. Exact topic names and payload shapes must be confirmed.

Every delivery is written to `IntegrationEvent` **before** it is processed:

```
UNIQUE (organizationId, provider, eventType, externalEventId)
```

That index is the duplicate-webhook guard. Shopify retries; without this, one
order becomes two helpings of demand. Processing then happens from the queue, so
a slow import never causes a webhook timeout and a retry storm.

HMAC verification against `SHOPIFY_WEBHOOK_SECRET` is mandatory, using a
timing-safe comparison.

## 6. Which orders need manufacturing

The central rule: **not every Shopify order requires manufacturing.** Existing
sellable inventory must not generate unnecessary production.

`assessLineAvailability()` in `packages/domain/src/integrations/dedupe.ts`
implements the decision, and is already tested against the specification's
worked example:

```
Shopify order #158420

Item A  ordered 1,  5 available at Head Office, allocation confirmed
        → ALLOCATION_CONFIRMED,  manufacturing 0
Item B  ordered 1,  0 available
        → OUT_OF_STOCK,          manufacturing 1
Item C  ordered 2,  1 available, allocation confirmed for 1
        → PARTIALLY_AVAILABLE,   manufacturing 1
```

### Availability is not a reservation

This is the rule the specification stresses hardest, and the implementation
follows it exactly:

- A facility stock snapshot is **evidence that stock existed at a moment**. It
  carries `snapshotAt`, and a snapshot older than the configured window (default
  15 minutes) is marked stale.
- An unconfirmed snapshot yields `ALLOCATION_PENDING`. The coverable quantity is
  reported, but it is **not** netted off manufacturing demand.
- Only a **confirmed external allocation** reduces the manufacturing quantity.
- If the stock check itself failed, the status is `INVENTORY_CHECK_FAILED` and
  nothing is assumed — the full quantity stays as manufacturing demand, because
  making a garment that turns out to be unnecessary is recoverable and failing to
  make one that was is not.

### Manual approval

`ManufacturingDemand.status` moves through `NEW → PENDING_REVIEW →
APPROVED_FOR_PRODUCTION`, gated by `demand.approve`. Configurable rules can
pre-classify by product type, fulfilment status and stock availability, but a
human can always intervene before anything reaches the floor.

## 7. Deduplication across systems

A Shopify order that is also pushed into Unicommerce arrives **twice**. Without
protection, it is manufactured twice.

Deduplication cannot key on the source document, because the same demand
legitimately *is* two different documents. It keys on what the demand **is**:

```ts
demandFingerprint({
  productVariantId,                  // or externalSku when unmapped
  commerceOrderRef: '#158420',       // normalised: strip #, non-alphanumerics
  commerceLineRef: 'JACKET-L',
})
```

`normaliseCommerceRef()` reduces `#158420`, `158420` and `DD-158420` to the same
value, so both sightings produce the same fingerprint and collapse onto **one**
`ManufacturingDemand` row with **two** `DemandSourceMapping` rows recording where
each came from.

`UNIQUE (organizationId, dedupeFingerprint)` makes it structural rather than
best-effort.

### Reconciliation decisions

`reconcileIncomingDemand()` handles the four real cases:

| Situation | Action |
|---|---|
| New line, never seen | `CREATE` |
| Same line, same quantity (duplicate webhook) | `IGNORE_DUPLICATE` |
| Same economic demand, different source system | `ATTACH_TO_EXISTING` |
| Same line, quantity amended externally | `UPDATE_QUANTITY` with the delta |

All four are covered by tests.

## 8. Handling change

| Event | Response |
|---|---|
| Order cancelled | Demand cancelled; released production flagged for a decision, not auto-cancelled — fabric may already be cut |
| Quantity reduced | `UPDATE_QUANTITY` with a negative delta; allocated quantity reviewed |
| Quantity increased | Positive delta; additional demand created |
| Partial fulfilment | `fulfilledQty` updated; remaining demand unchanged |
| Order split | Each resulting line keyed on its own `externalLineId` |
| Duplicate webhook | Refused by the `IntegrationEvent` unique index |
| Missing SKU mapping | `ProductSyncIssue` raised; demand held in `NEEDS_MAPPING` |

The cancellation row is the one that needs human judgement. Cancelling demand is
free; cancelling production that has already consumed fabric is a write-off, and
the system should present that choice rather than make it.

## 9. Observability

Every outbound call is written to `SyncLog`: operation, request and response
payloads, HTTP status, parsed business success, duration, attempt number, and
`outcomeUncertain` for timeouts. Retained so an uncertain outcome can be
investigated rather than guessed at.

## 9a. API verification — done 23 Oct 2026

Verified against the Admin GraphQL schema and the published documentation, not
assumed. What changed as a result:

### The channel discriminator is not one field

The original design assumed a single "is this POS?" field. There are three, and
they do not mean the same thing:

| Field | What it says | Use |
|---|---|---|
| `Order.retailLocation` | The physical store a retail order was created at | **Primary POS test.** Non-null ⇒ POS |
| `Order.sourceName` | The platform: `web`, `pos`, `mobile_app`, … | Secondary, and free-text |
| `ChannelInformation.channelDefinition.handle` | Legacy channel handle | **Deprecated.** Do not build on it |

`retailLocation` is the right primary test, and it is better than a boolean
because it names *which* store — which is exactly what an eleven-store business
needs in order to answer "is this piece available somewhere else?".

**Documented exception:** draft POS orders completed with "mark as paid" in the
admin return `null` here. Those fall back to `sourceName`, and a mis-classified
draft is the one case where the fallback matters.

### Use `currentQuantity`, never `quantity`

| Field | Meaning |
|---|---|
| `LineItem.quantity` | Units originally ordered |
| `LineItem.currentQuantity` | **Units ordered excluding refunded and removed units** |
| `LineItem.unfulfilledQuantity` | Units not yet fulfilled |

Demand must be driven by `currentQuantity`. Using `quantity` would keep
manufacturing garments for lines the customer refunded — the exact class of
error the specification's deduplication rules exist to prevent.

### Rate limits are cost-based, not request-based

A leaky bucket of *points*, per app-and-store combination, refilling
continuously. Plan determines the rate: Standard 100/s, Advanced 200/s,
Plus 1000/s. Connection cost is sized by `first`/`last`, so page size directly
drives cost.

The consequence for the connector: throttling cannot be "N requests per
second". It has to read the cost the response reports and pace against the
remaining budget. A fixed request rate would be both too slow and, on a large
page, still too expensive.

### Incremental import is possible

The `orders` query supports `query: "updated_at:>..."` plus cursor pagination
(`first` / `after`, `pageInfo { hasNextPage endCursor }`). So import is
incremental by `updatedAt`, and `ShopifyOrder.externalUpdatedAt` is the
stale-write guard against processing an older version of an order.

### Still unverified — needs the real store

Schema facts are store-independent; these are not:

- [ ] **Which `sourceName` values this store actually emits.** The set is not
      enumerable from the schema, and the POS fallback depends on it.
- [ ] **Granted access scopes.** A missing `read_orders` or `read_locations`
      surfaces as an empty result, not an error.
- [ ] **Whether reading orders older than 60 days needs `read_all_orders`.**
- [ ] **The store's plan**, which sets the rate budget.

`POST /api/integrations/shopify/verify` answers all four against the live store
and writes the result to the connection record. It is read-only.

## 9b. Live store probe — 23 Oct 2026

Run against `dash-and-dot.myshopify.com` (**Shopify Plus**, INR, Asia/Kolkata)
over the 50 most recently updated orders. All five checks passed:
authentication, order read access, historical orders (`read_all_orders` is
granted), and a 1000 points/second cost budget.

### What the store actually emits

| `sourceName` | Orders | Classified |
|---|---|---|
| `web` | 23 | ONLINE ×22, CUSTOM ×1 |
| `402708955137` | 21 | ONLINE ×21 |
| `pos` | 3 | POS ×2, CUSTOM ×1 |
| `shopify_draft_order` | 2 | ONLINE ×2 |
| `4388981` | 1 | ONLINE ×1 |

Retail orders resolved to real shops — **Kala Ghoda Fort (2)**, **DLF
Promenade (1)** — which confirms `retailLocation` identifies POS *by store*,
exactly as the design needs.

### Four things this changed

**1. 42% of orders come from an unidentified numeric channel.**
`402708955137` is a sales-channel app id, not a name. It is the second largest
source and nothing in the API says what it is. It currently falls through to
ONLINE, which is probably right but is a default, not a decision. **Needs
naming before demand is trusted.**

**2. `shopify_draft_order` exists.** Draft orders are the usual route for
wholesale and manually-keyed B2B. If bulk demand reaches this business at all,
this is the likeliest place it arrives — see the open question in
unicommerce-integration.md about where manufacturing demand comes from.

**3. Unicommerce writes back to Shopify.** Every retail order carried the tag
`unicommerce complete`. That is a fulfilment signal the ERP can read without
calling Unicommerce at all, and it means Shopify tags are part of the
integration surface, not just merchandising metadata.

**4. A store sale can also be a custom order.** One `pos` order carried
`Custom` and `Custom Order` tags and classified as CUSTOM rather than POS. The
store is still recorded on it, but the channel is not.

### The open question this raises

`DemandChannel` allows one value, and a bespoke garment sold at Kala Ghoda Fort
is honestly both. The current rule puts bespoke first, because it changes what
production has to *do* rather than merely where the order came from — but the
consequence is that POS counts under-report by however many store sales are
also custom.

Two coherent answers, and the business has to pick:

- **Keep CUSTOM winning.** Production routing stays correct; store-level sales
  reporting needs to read `posLocationName`, which is populated either way.
- **Make POS win and record customisation separately** on the line
  (`ShopifyOrderLine.customization` already exists for this). Channel then
  means "where it came from" consistently, and bespoke becomes an attribute.

Tags are also used for product handles — one order carried
`off-shoulder-sequin-gown-47751089193130` — so any tag-driven rule has to match
exactly rather than by substring. The current implementation does.

## 10. Implementation checklist

Before writing the connector:

- [x] Confirm the pinned Admin API version is supported and not near expiry
- [x] Confirm granted scopes cover orders, products, inventory and locations
      — verified 23 Oct 2026, see §9b
- [x] **Confirm the POS / online / custom discriminator** — see §9a; it is
      `retailLocation`, not a single boolean, and the legacy field is deprecated
- [x] Confirm the correct cancelled and refunded quantity fields — `currentQuantity`
- [ ] Confirm webhook topic names and payload shapes — polling first
- [x] Confirm the rate-limit model and the throttle fields to read — cost-based
- [x] Confirm whether reading historical orders needs an extra scope
      — `read_all_orders` IS granted, see §9b
- [ ] **Name the `402708955137` sales channel** — 42% of recent orders
- [ ] **Decide whether CUSTOM or POS wins** for a bespoke in-store sale
- [ ] Decide the inventory-availability source: Shopify inventory levels, or
      Unicommerce facility stock. **They will disagree**, and the ERP must name
      one of them as authoritative for the manufacturing decision.

The last item is a design decision, not a lookup. Phase 4 should not start until
it has an answer.
