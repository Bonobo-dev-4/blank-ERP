# Testing Strategy

**414 tests passing: 285 domain unit, 28 contract consistency, 100 HTTP end-to-end.**

---

## 1. The shape of it

```
                ┌─────────────────────────────┐
                │  100 end-to-end             │  real Postgres, real HTTP
                │  whole workflows            │  catches composition bugs
                ├─────────────────────────────┤
                │  SQL constraint checks      │  PGlite, raw SQL
                │  does the DB refuse it?     │
                ├─────────────────────────────┤
                │  28 contract consistency    │  do the permission and
                │  permission + nav coherence │  navigation maps agree?
                ├─────────────────────────────┤
                │  285 domain unit tests      │  pure, <1 s, exhaustive
                │  arithmetic + invariants    │
                └─────────────────────────────┘
```

Deliberately bottom-heavy. The quantity invariants are the part that must not be
wrong, and pure functions let every boundary condition and every illegal
transition be exercised in under a second. That is only possible because
`@dnd/domain` has no framework and no database.

The end-to-end layer is thin but not optional — it is the only layer that catches
bugs in how modules *compose*, and it earned its place by finding four of them
(§6).

## 2. Domain unit tests — 285

`packages/domain`, vitest, no database, no mocks.

| Suite | Tests | Covers |
|---|---|---|
| `decimal` | 8 | Float-drift resistance, DB scales, rounding mode |
| `uom` | 9 | Explicit conversions, refusal to guess, inverses |
| `inventory/ledger` | 18 | Double entry, state machine, stock sufficiency, reservations |
| `inventory/reservations` | 15 | Stock position, FEFO allocation, shade and width filters |
| `inventory/rolls` | 21 | Roll lengths, partial issue and return, shade control |
| `purchasing/receipt` | 15 | Tolerance, inspection split, PO closure, landed cost |
| `bom/explode` | 18 | Explosion, wastage bases, size overrides, snapshot, diff |
| `mrp/plan` | 18 | Shortage, open PO handling, partial release, aggregation |
| `manufacturing/order-lifecycle` | 30 | MO status machine, release assessment and authorisation, quantity rollup |
| `production/stage-ledger` | 28 | Release, outcome, forward, rework, batch progress |
| `production/barcode` | 19 | Code format, check character, scan validation, serialisation |
| `quality/qc` | 10 | Verdict split, inspectable quantity, defect consistency |
| `finished-goods/inward` | 11 | Inward eligibility, unit tracking, lifecycle states |
| `integrations/dedupe` | 18 | Fingerprints, reconciliation, availability assessment |
| `integrations/push` | 23 | Eligibility, state machine, outcome classification |
| `costing/rollup` | 8 | Variance, cost per accepted unit, wastage analysis |
| `forecasting/replenishment` | 15 | Velocity, replenishment, alert levels, dedupe keys |

### What the tests assert

Not "the function returns a number" but the specification's actual figures:

```ts
it('arrives at a gross requirement of 262.5 m', () => {
  expect(byId.fab!.grossRequiredQty.toFixed()).toBe('262.5');
});

it('reports a shortage of 82.5 m against 262.5 required and 180 available', () => {
  expect(line.shortageQty.toFixed()).toBe('82.5');
});

it('recommends 16 units', () => {   // Dhan Mill, 10/week, 4 on hand, 14-day lead
  expect(s.suggestedQty.toFixed()).toBe('16');
});
```

And the things that must be **refused**:

```ts
it('refuses to guess a conversion that was never configured', () => {
  expect(() => c.convert(1, 'ROLL', 'METER', 'fab-1')).toThrow(ConfigurationError);
});

it('never allows stock to come back out of a sink', () => { … });

it('will not retry an uncertain posting without reconciling first', () => {
  expect(() => assertPushTransition('RECONCILIATION_REQUIRED', 'PENDING')).toThrow();
});
```

## 3. The specification's critical test list

All 14 scenarios the specification names, and where each is covered:

| # | Scenario | Where | Status |
|---|---|---|---|
| 1 | 100 units released, 95 accepted, 5 rejected | `stage-ledger.test.ts` | ✓ 5 tests |
| 2 | Partial material issue | `ledger.test.ts`, e2e | ✓ |
| 3 | Material return | `ledger.test.ts`, `rolls.test.ts` | ✓ |
| 4 | BOM revision after MO release | `explode.test.ts` | ✓ snapshot unchanged |
| 5 | Batch splitting across operators | `barcode.test.ts` | ✓ 4 tests |
| 6 | Duplicate barcode scan | `barcode.test.ts`, e2e idempotency | ✓ |
| 7 | Concurrent stage transfers | `stage-ledger.test.ts` | ✓ second attempt refused |
| 8 | Partial QC approval | `qc.test.ts` | ✓ |
| 9 | Partial finished goods inward | `inward.test.ts` | ✓ 100→90→50→40 |
| 10 | Repeated Unicommerce push | `push.test.ts` | ✓ |
| 11 | Shopify + Unicommerce duplicate demand | `dedupe.test.ts` | ✓ same fingerprint |
| 12 | Facility mapping errors | `push.test.ts` | ✓ 3 tests |
| 13 | API timeout after uncertain posting | `push.test.ts` | ✓ no blind retry |
| 14 | MO cancellation after material issue | `ledger.test.ts` | ✓ return, not write-off |

### Two worth reading

**#1 — the double-count guard.** The test that matters is not that 95 + 5 = 100;
it is that submitting the same outcome twice *fails*:

```ts
it('refuses a second identical submission, which would double the numbers', () => {
  const after = task({ receivedQty: '100', completedQty: '95', rejectedQty: '5' });
  expect(() => planStageOutcome(after, { completedQty: '95', rejectedQty: '5' }))
    .toThrow(/exceeds the work in progress/);
});
```

**#13 — the uncertain posting.** The assertion is about an edge that does *not*
exist in the state machine:

```ts
it('will not retry an uncertain posting without reconciling first', () => {
  expect(() => assertPushTransition('RECONCILIATION_REQUIRED', 'PENDING')).toThrow();
  expect(() => assertPushTransition('RECONCILIATION_REQUIRED', 'READY')).toThrow();
  expect(() => assertPushTransition('RECONCILIATION_REQUIRED', 'RECONCILED')).not.toThrow();
});
```

## 3a. Contract consistency tests — 28

`packages/contracts`. These catch a class of bug that is otherwise invisible
until runtime and produces no error when it happens.

| Group | Asserts |
|---|---|
| Permission catalogue | Unique codes, derived module/action, every elevated permission marked, no read marked elevated |
| Role matrix | Every granted code exists, no duplicates, super admin holds all |
| Barcode operator | Holds scan and record-stage, holds **no** elevated permission |
| Separation of duty | Purchase Manager cannot adjust stock; Raw Material Manager cannot approve a PO; only Super Admin holds `sync.push` |
| Read-only roles | Finance and Management hold no write permissions |
| Navigation | Unique hrefs, every gate is a real permission, phase and status coherent |
| Build honesty | Nothing beyond `DELIVERED_PHASES` may be marked `BUILT`; delivered phases must be contiguous from 1; every non-`BUILT` item inside a delivered phase must explain its gap |
| **Reachability** | **Every built screen is openable by at least one role** |

The last two are the interesting ones. A typo in a permission string would
otherwise produce a screen that silently never appears for anyone, and nothing
would log it:

    it('gates every item on a permission that exists', ...)
      // An item gated on a non-existent permission is invisible to everyone,
      // with no error to explain why.

    it('makes every built screen reachable by at least one role', ...)
      // A built screen nobody can open is a built screen nobody will use.

## 4. Database verification

Three checks, two of which need no database at all.

### Constraint identifiers — offline

```bash
python3 scripts/verify-constraints.py
#   tables in schema         : 88
#   identifier refs verified : 112
#   CHECK constraints        : 73
```

Parses the generated init migration for every table and column, then confirms
every identifier referenced by the constraints migration exists. Catches typos
and drift without a running Postgres.

### Migrations apply — in-process Postgres

```bash
node scripts/apply-migrations-check.mjs
#   APPLIED 20261021000000_init
#   APPLIED 20261021000100_invariant_constraints
#   tables=88 check_constraints=73 fks=190 indexes=307
```

Uses PGlite — Postgres compiled to WASM — so this runs on a machine with no
Postgres and no Docker.

### Constraints actually reject bad data

Raw SQL against PGlite, confirming each constraint refuses what it should. The
reason this is separate from the service tests: a service test proves the
*service* refuses something, not that the *database* would.

## 5. End-to-end tests — 31

`apps/api/test/phase1.e2e-spec.ts`. Real Postgres, real NestJS app, real HTTP
through supertest, against seeded master data.

Drives the entire raw-material path in order, each test building on the last:

```
sign in
  → list materials (zero stock, genuinely)
  → refuse an unconfigured unit conversion
  → create a PO for 500 m fabric + 10,000 buttons
  → refuse a delivery against an unapproved PO
  → approve the PO
  → receive 300 m as three rolls      → QC hold, not warehouse
  → verify 200 m outstanding, PO not closed
  → replay the same receipt            → idempotent, received once
  → refuse an inspection split that does not add up
  → refuse a partial rejection not attributed to a roll
  → inspect: 290 accepted, 10 rejected off one roll
  → verify 290 available, 10 blocked, 300 still owned
  → verify weighted average cost 255.50 (rate + apportioned freight)
  → verify the roll split: 100 / 100 / 90 / 10-REJ = 300
  → suggest rolls for 262.5 m
  → issue 100 m to cutting
  → verify owned still 300, available now 190, at production 100
  → refuse issuing from an exhausted roll
  → assert the ledger sums to exactly zero
  → assert roll lengths reconcile against the ledger
  → verify every movement type was recorded
  → verify the audit log
  → verify live stock alerts
  → verify the dashboard reports real figures and flags unbuilt modules
  → sign in as a BARCODE_OPERATOR and confirm the server refuses an adjustment
```

### The decisive assertions

```ts
it('issuing moved the fabric without consuming it', async () => {
  expect(res.body.stock.onHandQty).toBe('300');             // unchanged
  expect(res.body.stock.availableQty).toBe('190');          // reduced
  expect(res.body.stock.issuedToProductionQty).toBe('100'); // moved
});

it('keeps the material ledger balanced to exactly zero', async () => {
  const total = balances.reduce((acc, b) => acc.plus(b.onHandQty), new Prisma.Decimal(0));
  expect(total.toFixed()).toBe('0');
});

it('enforces permissions on the server, not just in the UI', async () => {
  // signed in as BARCODE_OPERATOR
  const denied = await http.post('/api/inventory/adjust').set(operatorAuth).send({…}).expect(403);
  expect(denied.body.details.missing).toContain('inventory.adjust');
});
```

The last one is the point of the whole authorisation design, asserted rather than
assumed.

## 6. What the end-to-end suite found

Four real defects that unit tests could not have caught, because all four were
about how modules compose:

### Department stock counted as available

After issuing 100 m to cutting, the material still reported 290 m available
instead of 190 m. Department floors were modelled as ordinary `PHYSICAL`
locations, so issued material still counted as issuable.

Fix: a `PRODUCTION_FLOOR` location kind, removed from `ISSUABLE_KINDS`, with a
matching `issuedToProductionQty` bucket. The specification lists "Issued to
Production" as a distinct stock status, which the original model collapsed.

### Whole rolls moved on a partial rejection

Rejecting 10 m of a 300 m three-roll delivery moved all three rolls to the
warehouse at full length, so roll lengths said 300 m at the warehouse while the
ledger said 290 m. The roll reconciliation check caught it immediately.

Fix: per-roll rejection allocation, with a roll rejected in part being **split** —
the accepted roll shrinks and the offcut becomes its own barcoded roll.

### An order's own reservation read as a shortage against itself

Reserving material for an order removed that stock from "available", so the
readiness check immediately reported a shortage of exactly the quantity the
order was holding — and asked the planner to override a shortage that did not
exist. An order that reserved its own material could never be released.

The domain had always defined the field as "stock reserved by OTHER
manufacturing orders"; the service was computing it as *all* reservations.

Fix: `MrpService.supplyPositions` takes `forManufacturingOrderId` and credits
back the open quantity that order holds. Caught by the phase 2 release test,
which reserves before it releases — exactly as a planner would.

### A transaction waiting on its own connection

`BomService.createVersion` opened a transaction, then called a helper that read
from the connection *pool*. On the single-connection development database that
deadlocked against its own transaction and timed out after ten seconds as a
bare `P2024`; on a large pool it would have read outside the transaction's
snapshot instead, which is worse because it is silent.

Fix: the helper takes an optional transaction client, and the transactional
caller passes it. The rule is now stated where the helper is defined.

The first two are documented in [decisions.md](decisions.md) §4 and §5. All
four are the justification for having an end-to-end layer at all.

## 6a. What no automated test found: the sign-in redirect loop

A third defect reached a user, and none of the 312 tests could have caught it,
because it lived entirely in the browser: signing in with correct credentials
returned 200 and then bounced straight back to the login form.

`AuthProvider` is mounted in the **root** layout, so it does not remount when
the router navigates from `/login` to `/`. Its one-time `load()` effect had
already run at page load, found no token, and settled on
`user = null, loading = false`. The login page wrote the token to
`localStorage` and pushed to `/`, but nothing told the provider to re-read it,
so `(app)/layout.tsx` saw `!loading && !user` and replaced back to `/login`.
The `refresh()` method that would have resolved it was defined on the context
and never called.

The symptom is indistinguishable from a wrong password: the user is returned to
a blank login form with no error, because from the API's point of view nothing
failed. The network panel is the only place the truth is visible —
`POST /api/auth/login → 200` followed immediately by `GET /login?_rsc=…`.

Fix: sign-in moved onto the context itself (`signIn` / `signInWithPin`), so the
token write and the state transition happen in one step and no window exists in
which the token is stored but the provider does not know. The login response
already carries the full identity, so adopting it costs no extra round trip —
which also matters on the single-connection PGlite dev database.

### The gap this exposes

Every layer below the browser was green. The API was correct, the token was
correct, the permissions were correct. **There are no tests for `apps/web` at
all** — `pnpm --filter @dnd/web test` prints "no web unit tests yet" and
exits 0.

The untested seam is specifically *client-side auth state across navigation*:
sign in, sign out, reload while signed in, expired token on load, and arriving
at a deep link while signed out. Each is a redirect decision made from React
state, and each fails silently rather than loudly. Until that seam has
automated coverage, the login flow must be exercised in a real browser before
any release — the check is "did the dashboard render", not "did the request
return 200".

### Phase suites are ordered, not isolated

`test/phase-sequencer.js` runs the e2e specs in filename order. They are
deliberately not independent: each drives the real API against one seeded
database, and a later phase legitimately changes state an earlier one set up —
phase 2 reserves and re-stocks the materials phase 1 received, and phase 3
works the order phase 2 released.

Isolating them would mean each phase seeding its own materials, locations and
suppliers, which would stop them testing the thing that actually breaks in an
ERP: modules composing over shared master data. The cost is that **each run
needs a freshly seeded database**, and that phase 2's setup explicitly closes
the purchase order phase 1 leaves open, so "nothing incoming" means it.

## 7. Running the tests

### No database needed

```bash
pnpm --filter @dnd/domain test        # 285 tests, <1 s
python3 scripts/verify-constraints.py
node scripts/apply-migrations-check.mjs
pnpm typecheck                        # all four projects
```

### With a database

```bash
pnpm infra:up                         # Postgres 16, Redis 7, MinIO
pnpm prisma:deploy
pnpm seed
pnpm --filter @dnd/api test:e2e       # 100 tests
```

### Without Docker

The repository includes a PGlite TCP server, so the full suite runs on a machine
with no Postgres and no Docker:

```bash
node scripts/pglite-server.mjs --port 5433 &
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public&sslmode=disable&pgbouncer=true&connection_limit=1"
pnpm --filter @dnd/api prisma:deploy
pnpm --filter @dnd/api seed
pnpm --filter @dnd/api test:e2e
```

`pgbouncer=true` is required: it disables Prisma's prepared-statement caching,
which PGlite's single backend session cannot support across connections.

## 8. Known limitations

**PGlite serves one connection at a time**, so it cannot exercise genuine
concurrency. Row-lock behaviour under contention — two supervisors forwarding the
same batch simultaneously — needs real Postgres. The *logic* is tested (the
second attempt is refused from updated state); the *locking* is not.

**Concurrency tests are not written.** They should be, against real Postgres:
parallel issues of the same lot, parallel forwards of the same batch, parallel
pushes of the same inward line. The constraints would catch a violation, but
catching it as a constraint error is worse than queueing correctly.

**No load or soak testing.** No measured figures for a 10,000-row movement
ledger or 50 concurrent scan terminals.

**Frontend has no tests.** No component tests, no browser automation. The build
typechecks and every page compiles, but no test asserts that the inspect dialog
blocks submission when the roll allocation is short — only that the API would
refuse it.

**Services are tested only through HTTP.** There are no isolated service unit
tests with a mocked Prisma client. That is a deliberate trade — the domain layer
holds the logic worth unit-testing, and testing services through HTTP exercises
guards, validation, serialisation and transactions at the same time — but it
means a service bug shows up as an end-to-end failure rather than a precise one.

## 9. What to add next

In priority order:

1. **Concurrency tests against real Postgres.** The row-locking design is
   unverified under contention, and it is load-bearing.
2. **Phase 2–3 domain coverage as those services land.** The domain tests exist;
   the services that use them do not.
3. **Integration contract tests** against Shopify and Unicommerce sandboxes,
   including a deliberately timed-out push to exercise the reconciliation path.
   A path that has never been run is a path that does not work.
4. **Frontend component tests** for the three dialogs with real validation logic:
   receive, inspect, adjust.
5. **A seeded performance fixture** — 100,000 movements — to measure the ledger
   queries before they become a problem in production.
