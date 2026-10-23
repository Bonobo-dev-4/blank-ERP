# Decision Record

Significant design decisions, with the reasoning and the alternatives rejected.
Append-only; supersede rather than edit.

---

## 1. Modular monolith, not services

**Decision.** One NestJS application with enforced module boundaries, rather than
separate services per domain.

**Why.** The invariants in [inventory-accounting.md](inventory-accounting.md) are
transactional *across* module boundaries. Receiving a delivery writes a GRN,
creates lots, registers fabric rolls, mints barcodes, updates purchase-order
counters and posts ledger movements — and all of it must commit or none of it.

Split across services, that becomes a saga. A half-applied saga in an inventory
system means stock that does not exist, and compensating transactions for
"created a lot but failed to post the movement" are a worse problem than the
scaling one they would solve.

**Rejected.** Microservices with an event bus. Would require eventual consistency
precisely where the business needs immediate consistency.

**Revisit when.** A single module needs independent scaling — realistically the
integration workers, which are already separable because they communicate through
BullMQ rather than in-process calls.

---

## 2. Framework-free domain package

**Decision.** `packages/domain` contains all quantity arithmetic and invariants
with no Prisma, no Nest, no HTTP.

**Why.** These are the parts that must not be wrong. Logic embedded in services
can only be tested by standing up a database, which in practice means it gets
tested thinly — happy paths and one or two error cases.

As pure functions, 255 cases run in under a second, covering every boundary
condition and every illegal state transition. Services then became thin: lock the
rows, call the domain, persist the returned deltas, write the audit row.

**Cost.** Some duplication of type definitions between the domain's interfaces
and Prisma's generated types, and a mapping layer at the boundary.

**Judgement.** Worth it. The domain tests are the reason a refactor of the
location model (§4) could be made confidently in one pass.

---

## 3. Product Master and SKU Mappings added to the sidebar

**Decision.** Added two screens under Administration that the V3 specification's
sidebar does not list.

**Why.** The specification defines the product master in §3 and references it from
Orders, BOM and Production, but §2's sidebar has no entry for it. Taken literally,
the product master would be unreachable — no way to create a style, generate SKUs
or map external identifiers.

Unreachable master data is worse than an extra menu item. Administration was
chosen because that is where the other master-data screens (locations, users,
roles) live.

**Alternatives rejected.** A top-level "Masters" group — more disruptive to the
specified structure for no gain. Leaving them unreachable and seeding everything —
makes the system undemonstrable and unusable.

---

## 4. `PRODUCTION_FLOOR` location kind

**Decision.** Department floors are a distinct location kind, excluded from
`ISSUABLE_KINDS`, with their own `issuedToProductionQty` figure.

**Why.** Originally department locations were ordinary `PHYSICAL`. An end-to-end
test caught the consequence: after issuing 100 m of fabric to cutting, the
material still reported 290 m available instead of 190 m. The issued fabric was
owned, countable — and still being offered to the next order that asked.

"We own 290 m" and "290 m is available to cut" are different statements. The
specification lists "Issued to Production" as a distinct stock status in §6, which
the original model collapsed into availability.

**What changed.** New enum value in `LocationKind`; `OWNED_KINDS` includes it,
`ISSUABLE_KINDS` does not; `ISSUE_TO_PRODUCTION` now credits it and `CONSUMPTION`
sources from it; `computeStockPosition()` gained a bucket; the seed marks the
seven department locations accordingly.

A useful side effect: `CONSUMPTION` can no longer be sourced from a warehouse at
all. Material must be issued to a department or a job worker before it can be
consumed, which keeps "issued" and "consumed" genuinely distinguishable.

**Found by.** `phase1.e2e-spec.ts`, "surfaces live stock alerts from the ledger" —
the alert level came back `AT_REORDER_LEVEL` instead of `BELOW_MINIMUM`, because
availability was 290 rather than 190.

---

## 5. Partial rejection splits the fabric roll

**Decision.** When a receipt line arrived as individual rolls and inspection
rejects part of it, the rejected length must be allocated to specific rolls. A
roll rejected in part is split: the accepted roll shrinks and the offcut becomes
its own barcoded roll in the rejected location.

**Why.** The original implementation moved whole rolls wholesale on inspection.
Rejecting 10 m of a 300 m three-roll delivery moved all three rolls to the
warehouse at full length, so roll lengths said 300 m at the warehouse while the
ledger said 290 m.

The roll reconciliation check caught it, which is exactly what it exists for. But
the deeper problem is that "10 m rejected" is not actionable: a storekeeper cannot
find the bad fabric without knowing which roll it came off.

**What changed.** `inspectReceiptRequest` lines gained an optional
`rollDecisions` array, **required** when a roll-tracked line rejects anything.
`applyRollInspection()` handles three cases: wholly accepted (move), wholly
rejected (move), partially rejected (split). The inspect dialog validates the
allocation live.

**Trade-off.** A roll's `originalLength` is rewritten on a split, which
contradicts "immutable". Accepted because it reflects physical reality — the roll
was cut — and the removed piece exists as its own record with its own barcode, so
no length is lost. `originalLength` is documented as "length as accepted".

**Found by.** `phase1.e2e-spec.ts`, "reconciles fabric roll lengths against the
ledger".

---

## 6. Average cost derived, not accumulated

**Decision.** `averageCost` is recomputed from lot costs on every costed inward:

```
averageCost = Σ(onHandQty × lot.unitCost) / Σ(onHandQty)   over owned locations
```

**Why.** An incremental weighted average needs the previous quantity and average.
Both are wrong the moment stock sits in QC hold between being received and being
costed: the held quantity dilutes the average at a cost of zero.

Concretely, the original implementation produced 246.98 instead of 255.50 on a
300 m receipt where 290 m had been released and 10 m was still in the rejected
area.

Deriving the figure means it is always exactly the cost of what is on the shelf,
and a single bad inward cannot leave permanent drift behind it.

**Cost.** One aggregate query per costed inward instead of arithmetic on two
numbers. Negligible at this scale, and correct.

**Found by.** `phase1.e2e-spec.ts`, "records a weighted average cost including
apportioned freight".

---

## 7. Every movement cites a lot

**Decision.** `MaterialMovement.materialLotId` and
`MaterialBalance.materialLotId` are NOT NULL. Materials that are not lot-tracked
get one implicit `GENERAL` lot.

**Why.** Three reasons, compounding:

1. A nullable lot means two shapes of ledger row and two code paths.
2. In Postgres, a NULL in a unique index does not collide, so
   `(material, NULL, location)` could duplicate — the balance unique key would
   not be unique.
3. Per-lot costing then works for *every* material, not only the tracked ones.

Enforced by a partial unique index: one `GENERAL` lot per material.

**Cost.** One extra row per material, and `isGeneral` must be surfaced in the UI
so the implicit lot does not look like a data-entry mistake (it is badged
"implicit").

---

## 8. Unit conversions are never inferred

**Decision.** Only two built-in conversions (`KILOGRAM ↔ GRAM`). Everything else
must be configured. An unconfigured conversion raises `NO_UOM_CONVERSION`.

**Why.** There is no universal roll length — it depends on the fabric. There is
no defensible metre ↔ kilogram conversion without GSM and width. A system that
guesses either one fabricates stock, and the error is silent and compounding.

Even `METER ↔ YARD`, which *is* definitional, is left configurable because real
purchase documents disagree about it and the business should decide which figure
it uses rather than inherit one.

**Cost.** Setup friction. A purchase in a new unit fails until someone configures
the conversion. Mitigated by a preview endpoint that returns
`convertible: false` with a reason, so a form can grey out the unit rather than
showing an error the user cannot act on.

---

## 9. Quantities cross the wire as decimal strings

**Decision.** Every quantity, rate and money value is a string in JSON.

**Why.** A JSON number is an IEEE-754 double. `262.5` survives, but a 6-decimal
rate through enough round trips does not, and the failure is silent. Postgres
`NUMERIC(18,4)` exceeds what a double represents exactly.

Enforced by a global `DecimalSerializerInterceptor`, so no endpoint can emit a
quantity as a float even by accident.

**Consequence.** The browser never does arithmetic on quantities. It formats them
for display with `Intl` and sends strings back. The server owns the numbers.

**Note.** The wire format is canonical and drops trailing zeros: `155250.00`
serialises as `"155250"`. Asserted in the end-to-end suite so the convention is
pinned rather than incidental.

---

## 10. Strict double entry with virtual counter-accounts

**Decision.** Every movement has both a source and a destination, including
virtual `COUNTERPARTY` and `SINK` locations.

**Why.** It makes "is the ledger intact?" a single query:

```sql
SELECT SUM("onHandQty") FROM material_balances WHERE "rawMaterialId" = $1;  -- 0
```

The alternative — nullable source for inward, nullable destination for
consumption — needs special cases throughout, and gives no way to verify the
ledger as a whole.

**Cost.** Eight extra location rows and negative balances that look wrong to
someone unfamiliar with double-entry bookkeeping. Mitigated by showing them
separately on the Locations screen, labelled as counter-accounts, with their
signed balances.

---

## 11. Received goods cannot reach an issuable location

**Decision.** `PURCHASE_INWARD` may only credit `QUALITY_HOLD`. Only `QC_RELEASE`
can move stock to a usable location.

**Why.** "Inspect before use" becomes a property of the movement graph rather
than a rule someone has to remember. There is no transition that gets received
goods into the warehouse without an inspection, so there is no path to forget.

**Cost.** Two steps for every delivery, including ones nobody intends to inspect
carefully. Accepted: the second step is one screen, and a delivery that nobody
checks is how a bad dye lot reaches a cutting table.

---

## 12. A short delivery never closes a purchase order

**Decision.** A PO reaches `RECEIVED` only when every line is satisfied within
the under-receipt tolerance. Anything short stays `PARTIALLY_RECEIVED` until
someone closes it explicitly, with `purchasing.close_po` and a mandatory reason.

**Why.** Abandoning outstanding quantity is a commercial decision — it may mean a
supplier conversation, a credit note, or a second order elsewhere. Auto-closing
makes that decision silently and loses the fact that it was made.

The close action records how much was abandoned, in the audit log.

---

## 13. Two layers of idempotency

**Decision.** Request-level (`IdempotencyRecord`) *and* row-level (unique
`idempotencyKey` on movement tables).

**Why.** The shop floor retries. The request layer returns the stored result for a
replay, which is the good experience. The row layer is the guarantee — even if the
request layer were bypassed, the ledger refuses the duplicate.

A replayed key with a **different** payload is a 409 rather than either answer,
because the client has reused a key for a different operation and silently
accepting one of them would be wrong.

A **failed** attempt releases the request key, because the operation did not take
effect and there is nothing to protect against repeating.

---

## 14. `ReadCommitted` plus explicit row locks

**Decision.** Not `Serializable`.

**Why.** `Serializable` would make two unrelated materials serialise against each
other. On a floor with a dozen simultaneous issues, that is the difference between
workable and unusable.

Locking only the balance rows a movement touches, in a deterministic order sorted
by `locationId`, gives the same correctness for the rows that matter without the
contention.

**Caveat.** This is the part of the design least verified. PGlite serves one
connection, so the test suite cannot exercise genuine contention. Concurrency
tests against real Postgres are the highest-priority addition — see
[testing-strategy.md](testing-strategy.md) §9.

---

## 15. Cumulative rework counters

**Decision.** `reworkSentQty` and `reworkReturnedQty` are cumulative;
outstanding rework is the difference.

**Why.** The first implementation used `reworkQty` meaning "currently out", with
a constraint `reworkQty + reworkReturnedQty ≤ receivedQty`. That breaks on a
legitimate second rework pass of the same garment: total sent would be 2 while
received was 1.

Cumulative counters handle the loop correctly — 10 sent, 10 returned, 10 sent
again gives sent 20, returned 10, outstanding 10 — and a garment reworked twice is
still one garment.

**Caught during** schema review, before any data existed.

---

## 16. Rework is a loop at a stage, not a separate path

**Decision.** Quantity sent to rework never leaves its stage's `receivedQty`.
`ReworkOrder.targetStageId` records which department does the physical work.

**Why.** Modelling rework as movement to another stage and back would create a
second quantity path, and the arithmetic would stop closing — the rework stage's
`receivedQty` would double-count garments already counted upstream.

Keeping the quantity parked at its own stage as "outstanding rework" means the
route chain check (`stage[n].received ≤ stage[n−1].forwarded`) holds without
exception, and the garment keeps its original production identity throughout, as
the specification requires.

---

## 17. A timeout is a distinct outcome

**Decision.** An uncertain external posting goes to `RECONCILIATION_REQUIRED`,
and **no transition exists** from there back to `PENDING` or `READY`.

**Why.** A timed-out push may have been applied. Retrying blind credits inventory
twice. Treating it as a failure and retrying is the single most expensive mistake
this integration can make.

The only way out is `RECONCILED`, which requires something to have actually read
the external system's inventory. Encoding it in the state machine means it cannot
be bypassed by a well-meaning retry button.

Likewise, HTTP 200 is not success — only an explicitly parsed business-level
success counts, and an unparseable response is treated as uncertain.

---

## 18. An overage is never auto-corrected

**Decision.** Reconciliation that finds external quantity *higher* than ERP
quantity returns `INVESTIGATE_OVERAGE`, not an automatic adjustment.

**Why.** An overage means inventory was credited more than once. Silently
adjusting it down fixes the number and hides the defect — and the next occurrence
would be invisible too.

A shortfall *can* be retried, because the posting demonstrably did not land.

---

## 19. Demand deduplication keys on economic identity

**Decision.** `demandFingerprint(variant, normalised commerce order ref,
commerce line ref)`, with a unique index.

**Why.** Deduplication cannot key on the source document, because the same demand
legitimately *is* two different documents — a Shopify order and its Unicommerce
mirror. Keying on what the demand *is* collapses both sightings onto one demand
row with two source mappings.

`normaliseCommerceRef()` reduces `#158420`, `158420` and `DD-158420` to the same
value, because systems disagree about formatting.

**Risk.** The fingerprint depends on the commerce order reference surviving into
the Unicommerce document. If Uniware does not carry it, deduplication falls back
to manual review. **This must be verified in phase 4** — it is listed in the
integration checklist.

---

## 20. Availability is never a reservation

**Decision.** A facility stock snapshot carries `snapshotAt` and never reduces
manufacturing demand. Only a confirmed external allocation does.

**Why.** The specification is emphatic, and the reason is operational: stock seen
a minute ago may be sold by the time production is planned. Netting it off demand
means not making a garment that is then not available either.

An unconfirmed snapshot yields `ALLOCATION_PENDING` — the coverable quantity is
*reported* so a planner can act, but demand is unchanged. A failed check assumes
nothing: the full quantity stays as demand, because making an unnecessary garment
is recoverable and failing to make a necessary one is not.

---

## 21. No seeded stock or production records

**Decision.** The seed creates master data only. No balances, no movements, no
batches.

**Why.** The specification forbids mock production transactions. Beyond
compliance: seeded stock would make every figure on the dashboard a fiction, and
the first real question anyone asks — "is this number right?" — would have no
answer.

To get real stock into a development database, raise a purchase order and receive
it through the application. That exercises the real code path and produces real
ledger rows.

**Cost.** A fresh install shows zeros. Mitigated by the dashboard stating that
explicitly rather than looking broken.

---

## 22. The seed generates a random admin password

**Decision.** Printed once, not a known default.

**Why.** A known default survives into production because nobody changes it. A
random password printed once forces the operator to record it deliberately.

Production boot additionally refuses to start if the JWT secrets still hold their
`change-me…` placeholders.

---

## 23. Planned screens are disabled, not empty

**Decision.** 42 unbuilt routes render as disabled sidebar items with a phase
chip. Reaching one by URL gives a page stating the phase and its scope.

**Why.** The specification requires every visible action to either work or be
clearly marked unavailable. The practical reason is trust: an operator who clicks
three dead links stops trusting the whole interface, including the parts that
work.

The dashboard does the same at the data level — `available: false` with a phase,
rather than a zero that reads as a measurement.

---

## 24. PGlite for offline verification

**Decision.** Postgres-compiled-to-WASM is used to apply migrations and run the
end-to-end suite on a machine with no Postgres and no Docker.

**Why.** It let the migrations, the seed and the full HTTP workflow be verified
during development on exactly such a machine — which is how the two defects in §4
and §5 were found before any screen existed.

**Limitation.** PGlite serves one connection at a time, so genuine concurrency
cannot be tested. It also needs `pgbouncer=true` to disable Prisma's
prepared-statement caching, which its single backend session cannot support
across connections. Real Postgres is provided by `docker/docker-compose.yml` for
concurrency work.

---

## 25. Integration connectors deliberately not written

**Decision.** Shopify and Unicommerce contracts, schema, state machines and
domain logic are built; the HTTP clients are not.

**Why.** The specification says *do not invent API endpoints* and *inspect
official documentation* before implementing. Neither API's surface could be
verified during this work — the Shopify documentation connector required
re-authorisation, and no Uniware documentation or account access was available.

Writing clients against guessed endpoints would produce code that compiles,
passes its own tests, and fails on contact with the real API — while looking
finished. Worse, for Unicommerce it could credit real inventory incorrectly.

So the integration documents state the contract and **mark every assumption that
must be verified**, with a checklist per phase. The Unicommerce one opens with a
warning, because it is the only outward write in the system.

**The most important unanswered question:** which Unicommerce document type
represents bulk manufacturing demand in this account. A PO *to* DASH AND DOT is
demand; a PO *from* DASH AND DOT is procurement. Importing the wrong direction
would have the factory manufacture goods the company is buying.

---

## 26. Batches are created explicitly, not at release

**Decision.** Releasing a manufacturing order does **not** create production
batches. A supervisor creates them from the released order, choosing the route
and the batch size. The order detail screen shows "released, no batches yet" as
an unmissable outstanding step.

**Why.** A batch is a bundle of garments that physically travels together, and
its size is a floor decision: a cutting table lays up what it can lay up, which
is not the same as the size line on the order. Auto-creating one batch per size
line would guess that number, and a 500-piece "batch" that never exists as a
physical bundle makes every downstream stage count fiction.

Release is also already the heaviest transaction in the system — it freezes the
BOM snapshot (§2.9 of the roadmap). Adding route resolution to it means an order
can fail to release for a reason that has nothing to do with material, and the
BOM freeze is the part that must not become fragile.

**Rejected.**

*Auto-create at release.* The floor is never blocked and there is no dead end,
which is the real argument for it. But it has to guess the batch size, and it
makes release fail when no route can be resolved — turning a planning action
into a routing one.

*Require a route on the order.* Would make release refuse an order with no
route. Cleaner in principle, but it changes the behaviour of a shipped and
tested phase for the convenience of a later one.

**The risk this accepts.** An order released with no batches is a dead end that
nobody notices until someone asks why nothing is moving. Mitigated by surfacing
it on the order itself and in the batch list, not by a report someone has to
remember to run.

**Revisit when.** Batch sizing becomes predictable per style — a `defaultBatchSize`
on the product would then make auto-creation safe, because it would be a
recorded decision rather than a guess.

---

## 27. The scan station queues locally and never reports a false success

**Decision.** The scan station accepts a scan offline, holds it in a local queue,
and shows it as **PENDING** until the server confirms it. It displays three
states — pending, confirmed, rejected — and never a fourth that means "probably
fine".

Specifically:

- The idempotency key is generated **on the device at scan time**, not when the
  request is sent. That is what makes a replay provably the same event.
- **Stage counters shown on screen come from the server only.** A queued scan
  does not move the displayed numbers. Showing 95 completed because a queued
  scan said so, when the server later rejects it, is precisely the false success
  this is meant to prevent.
- A pending scan cannot be cleared by the operator, only retried. Clearing it
  would discard a real physical event.
- A rejected scan shows the server's reason and the real numbers, and stays on
  screen until acknowledged.

**Why.** This is the screen with the most users, the worst devices and the least
forgiving network. An operator told "done" for a scan that never landed is worse
than one told to retry: the first produces a quantity discrepancy nobody can
trace, the second produces a second scan.

The whole system is built so that a duplicate scan is safe —
`barcode_scan_events.idempotencyKey` is unique per organisation, and the stage
ledger refuses an outcome that exceeds work in progress. That makes "retry until
confirmed" the correct behaviour, and it only works if the key is fixed at the
moment of the physical event.

**Rejected.**

*Online-only.* Simplest, and honest about what it knows. But on factory wifi it
means operators standing still, and a request that times out leaves the operator
with no idea whether it landed — the ambiguity this decision exists to remove.

*Service Worker with the Background Sync API.* Technically the best fit. Rejected
because iOS Safari does not support Background Sync, and shop-floor tablets are
frequently iPads. A sync mechanism that silently does nothing on half the devices
is worse than a simpler one that works on all of them.

*Optimistic counter updates.* Rejected explicitly — see above. It is the one
thing that turns an offline queue into a lie.

**Revisit when.** The floor standardises on a device class that supports
Background Sync, or the network becomes reliable enough that the queue is
consistently empty.

---

## 28. Stage access is restricted by assignment, not by a department field

**Decision.** When department and location restriction is implemented
(roadmap 3.13), it reads from `ProductionStageTask.assignedUserId` /
`assignedJobWorkerId` and the stage's `defaultLocation`, rather than from a new
`User.departmentId` column.

**Why.** A user's department is a property of their employment; what they are
allowed to record is a property of the work. A stitching supervisor covering
cutting for a shift is an ordinary occurrence, and a department column makes it
an administrative change rather than an assignment.

The schema already carries the assignment on the task, and
`ProductionStage.defaultLocation` already names where the stage happens. Adding a
department to the user would create a second, competing answer to "may this
person record this?" — and two sources for one authorisation question is how
authorisation gets it wrong.

**Rejected.** `User.departmentId` plus a guard comparing it with the stage's
location. Simpler to query, but it cannot express "assigned to this batch today"
without a second mechanism anyway.

**Status.** Not yet implemented. The permission layer is in force; this is the
narrowing on top of it, and it remains the named gap in
[security-and-permissions.md](security-and-permissions.md) §12.

**Revisit when.** Job workers need the same restriction — the task already
carries `assignedJobWorkerId`, so the shape should extend without change.

---

## 29. How the ERP reaches Unicommerce

**Status.** Accepted for development, **Proposed for production** — the
production transport needs a deployment decision (below) that is not mine to
make. **Date:** 23 Oct 2026.

**Context.** Unicommerce whitelists source IPs, so reachability is a deployment
property, not a code property. The business already runs a fixed-IP proxy at a
bare address on **plain HTTP**, authenticated by a shared static secret, and
their Apps Script integration signs in with a named employee's login.

Probing it on 23 Oct 2026 established what was previously guesswork:

| Fact | Verified value |
|---|---|
| Proxy gate | `X-Proxy-Secret` header; anything else returns 401 |
| Token endpoint | `GET /oauth/token` — **not** under `/services/rest/v1/` |
| Grant | `password`, `client_id=my-trusted-client` |
| Token | opaque UUID bearer, `expires_in` ≈ 25500s (~7h), scope `read trust write` |
| Business errors | **HTTP 200 with `successful: false`** |
| Facility codes | all 17 supplied codes are real (§8a) |

**Decision.** The connector talks to a single configurable base URL and sends
`X-Proxy-Secret` when one is set. It does not know or care whether that URL is
the proxy, a replacement gateway, or the tenant directly — which is what lets
the production transport change without touching connector code.

For **development** it uses the existing proxy, because it is the only route
that reaches the tenant from a machine whose IP is not whitelisted.

### Options considered

**A. Keep the existing proxy.**

| Dimension | Assessment |
|---|---|
| Complexity | Low — it already works |
| Cost | None |
| Security | **Poor** — cleartext credentials on the public internet |
| Team familiarity | High |

*Pros:* zero work; already carries production traffic.
*Cons:* `http://` on a bare IP means the Uniware password crosses the internet
in cleartext on every token refresh, and the password rides the **query
string** because that is the only form the token endpoint accepts — so it lands
in any proxy access log. A shared static secret is the only thing in front of a
credential with `write` scope.

**B. Whitelist the ERP's own egress IP.**

| Dimension | Assessment |
|---|---|
| Complexity | Low in code, medium in deployment |
| Cost | A static egress address |
| Security | **Good** — TLS directly to the tenant, no middle box |
| Team familiarity | Medium |

*Pros:* removes the proxy and the cleartext hop entirely; one less thing to
run. *Cons:* needs a stable egress IP, so it constrains hosting; a platform
with rotating addresses fails intermittently, which reads as a flaky API.

**C. Replace the proxy with a TLS gateway.**

| Dimension | Assessment |
|---|---|
| Complexity | Medium — something new to run |
| Cost | A small always-on host |
| Security | Good, if built correctly |
| Team familiarity | Low |

*Pros:* keeps a fixed IP while removing cleartext; can hold the credential so
the ERP never sees it. *Cons:* a new production dependency on the path of all
inventory traffic.

**Trade-off.** A and B differ mainly in *where the trust boundary sits*. The
proxy's weakness is not that it is a proxy — it is that it is unencrypted and
guarded by a static shared secret while holding a `write`-scoped credential.
B is the better endpoint and the cheaper long-run answer; C is the fallback if
a stable egress IP is not available.

**The credential is the sharper problem, and it is independent of A/B/C.** The
token returned carries scope `read trust write`, and it is a *named employee's*
login. That means the integration inherits a senior human's blast radius, stops
working when they change their password, and dies when they leave. §8c asks for
a service account; this probe raises its priority, because `write` scope is now
a measured fact rather than an assumption.

**Consequences.** Development is unblocked immediately. Production is not: the
connector will run against whatever base URL it is given, so an unreviewed
deployment could quietly ship cleartext credentials. `UNICOMMERCE_ENABLED`
stays `false` by default, and the three write gates in §6 remain the thing that
stands between a bug and real inventory.

**Revisit when.** A service account exists, or the egress IP is whitelisted.

---

## 30. Success is the envelope, never the HTTP status

**Decision.** The Unicommerce client treats a response as successful only when
the body says `successful: true`. HTTP 200 is necessary and nowhere near
sufficient, and the client raises on `successful: false` rather than returning
a shape callers might read as empty.

**Why.** This is measured, not defensive programming. Every one of these
returned **HTTP 200**:

```
{"successful":false,"errors":[{"message":"INVENTORY_NOT_AVAILABLE"}]}
{"successful":false,"errors":[{"message":"INVALID_ITEM_TYPE"}]}
{"successful":false,"errors":[{"message":"SALE_ORDER_SEARCH_DATE_RANGE_LIMIT_EXCEEDED"}]}
{"successful":false,"errors":[{"fieldName":"vendorCode","message":"MISSING_REQUIRED_PARAMETERS"}]}
```

A client that checks `res.ok` reads every one of them as success. On a read
that yields a wrong number; on an inventory push it would record a credit that
never happened — the precise failure §6 exists to prevent.

**The inverse also holds.** `FACILITY_ACCESS_DENIED` arrives as HTTP 403 with a
*parseable* body, and it means something completely different from the HTTP 403
a wrong URL produces. Status alone cannot tell them apart.

**Rejected.** *Return null on `successful: false`.* Rejected because "no stock"
and "the call failed" would become the same value, and the one place that
distinction matters most is deciding whether to manufacture.

---

## 31. Facility is a per-call argument whose honouring is verified per endpoint

**Decision.** Every facility-scoped call passes the facility explicitly, and the
connector records, per endpoint, whether the `Facility` header is actually
honoured. It never assumes a header that worked on one endpoint works on the
next.

**Why.** Probing found the header is **not** uniformly applied:

| Endpoint | Behaviour with a deliberately invalid facility |
|---|---|
| `oms/saleOrder/search` | **Ignored.** Returns an identical 4128 results |
| `inventory/inventorySnapshot/get` | **Enforced.** 403 `LOOKUP_INVENTORY` |
| `facility/get` | **Enforced**, and distinguishes the two failure kinds |

A nonsense facility code returning the same data as the real one is the
dangerous half. If that behaviour extended to a write, an inventory push aimed
at a Mumbai shop would land in whatever facility the session defaults to, and
the response would look like success.

**`facility/get` is the only honest validator**, because it separates the two
questions that every other endpoint conflates:

- `INVALID_FACILITY_CODE` — the code is wrong.
- `FACILITY_ACCESS_DENIED` — the code is right; this account cannot see it.

Nothing else distinguishes them: `inventorySnapshot/get` returns the same 403
for a real-but-invisible facility as for a typo. So facility codes are resolved
through `facility/get` and cached, never inferred from an error elsewhere.

**Consequence for facility switching.** The user's requirement — "switch
facility if the piece is available somewhere else" — is bounded by what the
service account can *see*. Five of seventeen facilities are invisible to it, so
an availability search across facilities is silently partial. The connector
reports which facilities it could not check rather than presenting a partial
answer as a complete one.

**Revisit when.** A service account with visibility across all 17 facilities
exists (§8c).
