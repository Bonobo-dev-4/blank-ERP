# DASH AND DOT — Manufacturing & Inventory Control ERP

A manufacturing ERP for a premium Indian fashion brand. It connects commercial
demand to the factory floor and back:

```
Shopify order / Unicommerce bulk PO
  → SKU → BOM → fabric roll → manufacturing job
  → barcode-scanned stages → QC → finished goods GRN
  → Unicommerce facility inventory
```

Shopify stays the commerce platform. Unicommerce stays the warehouse and
order-operations platform. This system integrates with both and replaces neither.

**Status: Phases 1 and 2 complete. Phase 3's shop-floor spine is delivered and
all five of its exit criteria are met; its QC, cutting and job-work modules are
outstanding. Phases 4–6 have schema, contracts and tested domain logic.**

49 screens are implemented (35 sidebar entries plus detail and create pages);
26 planned routes render as disabled items rather than empty pages.

| | |
|---|---|
| Tables / enums / constraints | 88 / 49 / 73 CHECK |
| Tests passing | **414** — 285 domain, 28 contract consistency, 100 HTTP end-to-end |
| API endpoints | 100+ across 13 modules, OpenAPI at `/api/docs` |
| Sidebar screens | 35 built, 3 partial, 26 planned (shown disabled, never faked) |

---

## Quick start

### Prerequisites

Node 20+, pnpm 9+, and either Docker or nothing at all (see below).

```bash
pnpm install
cp .env.example .env            # then set the two JWT secrets
```

Generate secrets:

```bash
openssl rand -base64 48
```

### With Docker

```bash
pnpm infra:up                   # Postgres 16, Redis 7, MinIO
pnpm prisma:deploy
pnpm seed                       # prints a random admin password ONCE
pnpm dev                        # API :3001, web :3000
```

### Without Docker

The repository ships a Postgres-compiled-to-WASM server, so everything runs on a
machine with no Postgres and no Docker:

Run these in **two separate terminals**, each left open — both commands are
long-running:

```bash
# terminal 1 - the database. --dir persists it across restarts.
node scripts/pglite-server.mjs --port 5432 --dir ./.pgdata
```

```bash
# terminal 2 - migrate, seed, run. The seed prints an admin password ONCE.
pnpm prisma:deploy && pnpm seed && pnpm dev
```

`prisma:deploy` and `seed` are one-time; after that terminal 2 is just
`pnpm dev`.

If terminal 1 reports the port or the data directory is already in use, a
server is already running — use it rather than starting a second. PGlite is a
single-process engine and two servers on one data directory will corrupt it.

Then open <http://localhost:3000> and sign in with the admin email from `.env`
and the password the seed printed.

### Verify it works

```bash
pnpm test                       # 313 tests, no database needed
pnpm typecheck                  # all four projects
python3 scripts/verify-constraints.py
node scripts/apply-migrations-check.mjs
```

End-to-end tests need a database:

```bash
# with PGlite, pgbouncer=true is required (see docs/testing-strategy.md §7)
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/postgres?schema=public&sslmode=disable&pgbouncer=true&connection_limit=1"
pnpm --filter @dnd/api test:e2e # 100 tests, phases 1 to 3 in order
```

---

## What Phases 1 to 3 do

Sign in as the seeded admin and you can run the whole raw-material path:

1. **Raw Material Master** — create a material, configure its unit conversions
2. **Vendor Management** — create a supplier
3. **Purchase Orders** → new → add lines → send for approval
4. **Purchase Approvals** → approve
5. **Record delivery** → enter fabric roll by roll; lengths validate live
6. **Inspect** → accept and reject; a partial rejection splits the roll
7. **Raw Material Stock** → see the balance per material, lot and location
8. **Material Movements** → the append-only ledger, every change explained
9. **Fabric Rolls** → per-roll lengths, with a live reconciliation banner
10. **Barcode Printing** → Code 128 or QR labels as a PDF
11. **Inventory Alerts** → computed live from the ledger, not a cached flag

…and then plan and release production against it:

12. **BOM Master** → new → add material lines; the gross-per-unit figure
    updates as you type
13. **Send for approval** → **Approve** — the version becomes immutable
14. **Manufacturing Orders** → new → enter a size breakdown
15. **Material readiness** → required / available / reserved elsewhere /
    short, and how many garments current stock actually covers
16. **Reserve material** → a claim on specific lots, not a movement
17. **Material Requirements** → run MRP across several orders at once
18. **Purchase Suggestions** → raise a requisition from what is still uncovered
19. **Release to floor** → freezes the BOM into a snapshot the order keeps.
    Revise the BOM afterwards and the released order does not move.

…and then run it on the floor:

20. **Create batches** → the released order says so itself until you do
21. **Batch Tracking** → the whole route, and where the batch actually is
22. **Release into route** → quantity enters the first step
23. **Scan Station** → scan a batch, see what it is and what can be done here,
    record it. Queued on the device and marked *pending* until the server
    confirms — never reported as done before then.
24. **Cutting / Embroidery / Stitching / Washing / Finishing** → each stage's
    work queue: in hand, ready to hand on, out in rework
25. **Scan History** → every scan, accepted and refused

The seed creates **no stock and no production records** — the specification
forbids mock transactions, and seeded stock would make every dashboard figure a
fiction. Receive a purchase order to get real ledger rows.

---

## Repository layout

```
apps/
  api/            NestJS — REST, OpenAPI, Prisma, BullMQ
    prisma/       schema.prisma, migrations, seed
    src/modules/  auth admin products materials inventory purchasing bom mrp
                  manufacturing production barcodes dashboard health
    test/         phase1/2/3.e2e-spec.ts, phase-sequencer.js
  web/            Next.js App Router
    src/app/      routes; (app) is the authenticated shell
    src/components/ui       DataTable, primitives, dialogs
    src/components/app      sidebar, topbar, auth context
packages/
  domain/         pure business logic — no framework, no database. 285 tests.
  contracts/      Zod schemas, 69 permissions, 15 roles, navigation map
docker/           compose + Dockerfiles
docs/             15 documents (start with inventory-accounting.md)
scripts/          offline verification helpers
```

### The two shared packages

**`@dnd/domain`** holds everything that must not be wrong: decimal arithmetic,
the ledger state machine, BOM explosion, MRP, the manufacturing order lifecycle,
the production stage ledger, QC verdicts, push outcome classification.
Framework-free, so 285 tests covering every boundary condition run in under a
second.

**`@dnd/contracts`** holds the Zod schemas used by *both* sides. The API
validates requests with them and generates its OpenAPI document from them; the
web forms validate against the same objects. A field cannot drift between client
and server because there is only one definition of it.

---

## Documentation

Fifteen documents in `docs/`. If you read one, read the first.

| Document | What it covers |
|---|---|
| **[inventory-accounting.md](docs/inventory-accounting.md)** | **The rules that make stock figures trustworthy. Start here.** |
| [PRD.md](docs/PRD.md) | Scope, users, the 23 invariants, acceptance criteria status |
| [manufacturing-architecture.md](docs/manufacturing-architecture.md) | Layering, transactions, locking, decimal discipline, error contract |
| [module-map.md](docs/module-map.md) | Every screen, its API, its permission, its build status |
| [database-erd.md](docs/database-erd.md) | 88 tables, the constraints that encode business rules |
| [production-workflows.md](docs/production-workflows.md) | Stage ledger — why quantities are never summed across stages |
| [bom-mrp-design.md](docs/bom-mrp-design.md) | Explosion, wastage, size grading, shortage, frozen snapshots |
| [barcode-architecture.md](docs/barcode-architecture.md) | Identity strategy, check characters, idempotent scanning |
| [shopify-integration.md](docs/shopify-integration.md) | Contract + **what must be verified before building** |
| [unicommerce-integration.md](docs/unicommerce-integration.md) | The only outward write + **its verification checklist** |
| [security-and-permissions.md](docs/security-and-permissions.md) | 69 permissions, 15 roles, what is *not* implemented |
| [ui-design-system.md](docs/ui-design-system.md) | Tokens, components, honest navigation |
| [testing-strategy.md](docs/testing-strategy.md) | 414 tests, and the defects they found |
| [implementation-roadmap.md](docs/implementation-roadmap.md) | What remains in phase 3, then phases 4–6 |
| [decisions.md](docs/decisions.md) | 28 decisions with reasoning and rejected alternatives |

---

## The ideas worth knowing

### Stock is a ledger, not a number

`material_balances` has exactly one writer: `LedgerService`. Every change is an
append-only double-entry movement, so one query answers "is the ledger intact?":

```sql
SELECT SUM("onHandQty") FROM material_balances WHERE "rawMaterialId" = $1;
-- must be exactly 0, always
```

Virtual counter-accounts (supplier, consumed, scrap, adjustment) are what make
that hold, exactly as liability accounts do in financial accounting.

### Issuing is not consuming

The specification's central failure mode is *the same material deducted twice as
it moves between stages*. Here, issuing fabric to cutting is a **transfer** —
owned quantity unchanged. Only `CONSUMPTION` and `WASTAGE` retire stock, and each
is bounded by what was actually issued to that department.

### Six stock quantities, kept distinct

On hand, issuable, reserved, available, issued-to-production, QC hold. Conflating
any two is how a planner promises the same 200 m twice, so every figure in the UI
is labelled with its definition.

### A released order keeps the recipe it was released against

Releasing copies the BOM version into `MoBomSnapshotLine` in the same
transaction that pins it. Costing, issue limits and wastage analysis all read
the snapshot, so revising a BOM cannot rewrite the history of orders already on
the floor — and the variance report never compares today's actuals against a
plan that did not exist when the work was done.

### A scan is never reported as done before it has landed

The scan station holds a scan on the device until the server confirms it, and
the stage counters on screen come from the server only. An operator told "done"
for a scan that never landed produces a discrepancy nobody can trace; one told
to retry produces a second scan, which is safe because the idempotency key was
minted at the moment of the physical scan. See [decisions.md](docs/decisions.md) §27.

### Quantities are never summed across stages

Cutting 100, stitching 85, finishing 60, QC 50 means **50 garments exist** and 50
are in progress — not 295. Batch totals come from the route's endpoints, never
from adding stage counters.

### Decimals everywhere, strings on the wire

A JSON number is an IEEE-754 double. Quantities cross the wire as decimal
strings, enforced globally so no endpoint can emit a float by accident.

### Honest about what is not built

42 planned screens render **disabled** with their phase, not as links to empty
pages. The dashboard reports `available: false` for modules that do not exist,
rather than a zero that reads as a measurement.

---

## Before production

Named gaps, from [security-and-permissions.md](docs/security-and-permissions.md) §12
and [implementation-roadmap.md](docs/implementation-roadmap.md) §8:

- **Concurrency tests against real Postgres.** The row-locking design is
  load-bearing and unverified under contention — PGlite serves one connection.
- **Browser tests for client-side auth state.** `apps/web` has no automated
  tests. A sign-in redirect loop shipped past all 312 of them because every
  layer below the browser was correct — see
  [testing-strategy.md](docs/testing-strategy.md) §6a.
- **Department and location restrictions.** Schema supports them; no guard reads
  them yet.
- **MFA** for Super Admin and Production Head.
- **Session revocation.** A stolen access token is valid for ≤15 minutes.
- **Automated backups with a rehearsed restore.** A backup never restored is not
  a backup.
- **Error monitoring.** Structured logs exist; nothing aggregates them.
- **Integration API verification** before phases 4–5. The checklists are in the
  two integration documents, and the Unicommerce one must be answered before any
  code is written — it is the only path that writes to real sellable inventory.

---

## Commands

```bash
pnpm dev                  # API + web
pnpm dev:api              # API only, :3001
pnpm dev:web              # web only, :3000
pnpm build                # all four projects
pnpm test                 # all test suites
pnpm typecheck            # all four projects

pnpm infra:up             # Postgres, Redis, MinIO
pnpm infra:down
pnpm prisma:migrate       # create a migration (dev)
pnpm prisma:deploy        # apply migrations
pnpm seed                 # master data, idempotent

pnpm --filter @dnd/domain test       # 285 domain tests
pnpm verify                          # typecheck + tests + both database checks
pnpm --filter @dnd/api test:e2e      # 100 end-to-end tests
pnpm --filter @dnd/api prisma:studio # browse the database
```

API documentation runs at <http://localhost:3001/api/docs>.
