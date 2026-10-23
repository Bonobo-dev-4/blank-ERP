# Manufacturing Architecture

## 1. Shape of the system

A modular monolith in a pnpm workspace. Four deployable or publishable units:

```
dash-and-dot-erp/
├── apps/
│   ├── api/          NestJS — REST + OpenAPI, Prisma, BullMQ workers
│   └── web/          Next.js App Router — operator and office UI
├── packages/
│   ├── domain/       Pure business logic. No framework, no database.
│   └── contracts/    Zod schemas + permission matrix + navigation map
├── docker/           Postgres 16, Redis 7, MinIO, Dockerfiles
├── docs/             This directory
└── scripts/          Offline verification helpers
```

A monolith rather than services, because the invariants in
[inventory-accounting.md](inventory-accounting.md) are **transactional across
module boundaries**. Receiving a delivery writes a GRN, creates lots, registers
fabric rolls, mints barcodes, updates purchase-order counters and posts ledger
movements. All of that commits or none of it does. Split across services, that
becomes a saga, and a half-applied saga in an inventory system means stock that
does not exist.

Module boundaries are enforced by discipline rather than by the network:
dependencies point inward (`api` → `domain`, `api` → `contracts`), and nothing
outside `LedgerService` may write a stock balance.

## 2. The layering that matters

```
┌──────────────────────────────────────────────────────────────┐
│  apps/web            React screens, forms, tables            │
│                      validates with @dnd/contracts           │
└───────────────────────────┬──────────────────────────────────┘
                            │ REST, decimal strings, idempotency keys
┌───────────────────────────▼──────────────────────────────────┐
│  apps/api  controllers   Zod validation, permission guards   │
│            services      transactions, row locks, audit      │
└───────────────────────────┬──────────────────────────────────┘
                            │ plain values in, deltas out
┌───────────────────────────▼──────────────────────────────────┐
│  packages/domain         arithmetic + invariants.            │
│                          No Prisma. No Nest. No HTTP.        │
└──────────────────────────────────────────────────────────────┘
```

### Why the domain package is framework-free

The quantity invariants are the part of this system that must not be wrong. Put
them in a service and they can only be tested by standing up a database, which
means they get tested thinly. Put them in pure functions and 255 cases run in
under a second, including every boundary condition and every illegal transition.

So services became thin: lock the rows, call the domain, persist the deltas it
returns, write the audit row. The interesting logic is all in one place that is
cheap to exercise.

This is why `LedgerService.postMovement` reads the way it does:

```ts
// 1. lock the affected balance rows, in deterministic order
await this.lockBalances(tx, materialId, lotId, locationIds);
// 2. read current state
const sourceBalance = await tx.materialBalance.findUnique({ ... });
// 3. validate + compute — pure, throws a domain error with real numbers
const plan = planMovement({ movementType, baseQty, source, destination, sourceBalance, ... });
// 4. apply exactly what the domain said
for (const delta of plan.deltas) await this.applyBalanceDelta(tx, delta);
// 5. write the immutable ledger row
await tx.materialMovement.create({ ... });
```

### Why contracts are shared

`packages/contracts` holds Zod schemas used by **both** sides: the API validates
requests with them and generates its OpenAPI document from them; the web forms
validate against the same objects. A field cannot drift between client and
server because there is only one definition of it.

The permission catalogue and the navigation map live there too, so the sidebar,
the guards and the seed all read the same source.

## 3. Backend module boundaries

| Module | Owns | Writes to |
|---|---|---|
| `auth` | Sign-in, tokens, session identity | `users`, `audit_logs` |
| `admin` | Users, roles, permissions, settings, audit | `users`, `roles`, `role_permissions`, `organizations` |
| `products` | Styles, SKUs, bundles, external mappings | `products`, `product_variants`, `external_product_mappings` |
| `materials` | Material master, UOM config, lots, locations, suppliers, fabric rolls | `raw_materials`, `material_lots`, `fabric_rolls`, `material_locations`, `suppliers`, `uom_conversions` |
| `inventory` | **The ledger.** Balances, movements, reservations, issues, consumption, adjustments | `material_movements`, `material_balances`, `material_reservations`, `material_issues`, `material_consumption` |
| `purchasing` | Requisitions, POs, receipts, inspection | `purchase_requisitions`, `raw_material_purchase_orders`, `raw_material_receipts` + ledger via `inventory` |
| `barcodes` | Identifier minting, resolution, label PDFs | `barcode_identifiers` |
| `dashboard` | Read-only aggregates | nothing |
| `health` | Liveness, readiness | nothing |

Phases 2–6 add: `bom`, `mrp`, `demand`, `manufacturing`, `production`,
`quality`, `finished-goods`, `integrations`, `forecasting`, `reporting`.

### The one hard rule

**`material_balances` has exactly one writer: `LedgerService`.**

Every other module that needs stock to move calls it with a transaction client.
That is what makes "no balance changes without a ledger movement" a structural
property rather than a convention someone can forget. `PurchasingService`,
`FabricRollsService` and `InventoryService` all go through it.

## 4. Transactions, locking and concurrency

### Isolation choice

`ReadCommitted` plus explicit `SELECT … FOR UPDATE` on the affected balance rows,
rather than `Serializable`.

Serializable would be simpler to reason about but would make two unrelated
materials serialise against each other. On a floor with a dozen simultaneous
issues, that is the difference between workable and unusable. Locking only the
rows a movement touches gives the same correctness for the rows that matter.

### Deadlock avoidance

Locks are taken in a deterministic order — balance rows sorted by `locationId` —
so two movements touching the same pair of locations queue instead of deadlocking:

```ts
const locationIds = [input.sourceLocationId, input.destinationLocationId].sort();
await this.lockBalances(tx, rawMaterialId, materialLotId, locationIds);
```

### Rows that do not exist yet

A balance row that has never existed cannot be locked. Creation is serialised by
the unique index on `(rawMaterialId, materialLotId, locationId)` and performed
with an upsert, so a race ends in one row, not two.

### Idempotency

Two independent layers:

1. **Request level** — `IdempotencyRecord` keyed on `(organizationId, scope, key)`.
   Same key and same payload returns the stored result. Same key with a
   *different* payload is a 409, because the client has reused a key for a
   different operation and silently accepting either answer would be wrong.
2. **Row level** — `material_movements.idempotencyKey` is unique per
   organisation. Even if the request layer were bypassed, the ledger itself
   refuses the duplicate.

A failed attempt releases the request key, because the operation did not take
effect and there is nothing to protect against repeating.

## 5. Decimal discipline

| Layer | Representation |
|---|---|
| Postgres | `NUMERIC(18,4)` quantities, `NUMERIC(18,6)` rates, `NUMERIC(18,2)` money |
| Prisma | `Prisma.Decimal` |
| Domain | `decimal.js` with 34-digit precision, `ROUND_HALF_UP` |
| Wire | **decimal strings** |
| Browser | strings, formatted with `Intl` for display only |

The wire format is the part people get wrong. A JSON number is an IEEE-754
double. `262.5` survives; a 6-decimal rate through enough round trips does not,
and the failure is silent. A global `DecimalSerializerInterceptor` converts every
Prisma Decimal in every response to a string, so no endpoint can emit a quantity
as a float even by accident.

Numbers are never parsed back into arithmetic in the browser. The server owns
them; the browser displays them.

## 6. Error contract

Domain errors carry a stable machine-readable `code` and a `details` object with
the actual numbers that failed the check, and both survive all the way to the UI:

```json
{
  "statusCode": 409,
  "code": "INSUFFICIENT_UNRESERVED_STOCK",
  "message": "Movement quantity exceeds unreserved stock at the source location",
  "details": {
    "locationId": "…",
    "requestedQty": "300.0000",
    "onHandQty": "500.0000",
    "reservedQty": "450.0000",
    "availableQty": "50.0000"
  },
  "path": "/api/inventory/issue",
  "requestId": "…"
}
```

A storekeeper shown those numbers can fix the problem. One shown "Conflict" has
to find a developer. HTTP status mapping:

| Domain error | Status | Meaning |
|---|---|---|
| `ValidationError` | 400 | Input not acceptable |
| `InvariantViolation` | 409 | Well-formed, but conflicts with current stock/production state |
| `IllegalStateError` | 422 | Not legal from the current state |
| `ConfigurationError` | 424 | A required configuration is missing |
| Violated CHECK constraint | 409 `INVARIANT_CONSTRAINT_VIOLATED` | A service check was bypassed — a bug, surfaced loudly |

## 7. Background processing

Redis + BullMQ, for work that must survive a restart and must not be duplicated:

| Queue | Job | Why queued |
|---|---|---|
| `integration.import` | Shopify / Unicommerce order and PO import | Rate-limited, long-running, retryable |
| `integration.push` | Unicommerce inventory push | Must be durable; a lost push is worse than a slow one |
| `integration.reconcile` | Read external inventory, compare, record variance | Scheduled and on-demand |
| `mrp.run` | MRP across many orders | CPU-bound, minutes long |
| `alerts.evaluate` | Alert rule evaluation | Scheduled |
| `labels.render` | Large label batches | Avoids tying up a request |

Redis runs with `appendonly yes`: losing a queued inventory push would be worse
than a slow restart.

Push jobs are **not** retried automatically on an uncertain outcome. See
[unicommerce-integration.md](unicommerce-integration.md) §6.

## 8. Authentication and authorisation

- Access token: JWT, 15 minutes, carries roles and resolved permissions
- Refresh token: 30 days
- Short TTL because permissions ride in the token: a revoked permission must
  stop working quickly without a database read on every request from every
  terminal
- `JwtAuthGuard` and `PermissionsGuard` are registered **globally**, so an
  endpoint is protected unless it opts out with `@Public()` — forgetting a guard
  fails closed
- `organizationId` comes from the verified token, never from a request parameter,
  which makes cross-organisation access unreachable by editing a URL

Details in [security-and-permissions.md](security-and-permissions.md).

## 9. Frontend architecture

- Next.js App Router. Route group `(app)` carries the authenticated shell.
- TanStack Query for all server state. No duplicate client cache.
- TanStack Table for every data grid, through one `DataTable` component.
- React Hook Form patterns + Zod from `@dnd/contracts`.
- Tailwind v4 with design tokens in `globals.css`.
- `/api/*` is proxied to the API by `next.config.ts`, so the browser sees one
  origin and CORS never enters development.

Client-side validation exists for speed of feedback only. The server validates
independently with the same schema, so the client is never the only thing
between bad data and the database.

## 10. What is verified, and how

| Property | How | Runs where |
|---|---|---|
| Quantity arithmetic and invariants | 255 unit tests, `packages/domain` | Anywhere, <1 s |
| Permission and navigation coherence | 26 tests, `packages/contracts` | Anywhere |
| Migrations apply | `scripts/apply-migrations-check.mjs` against PGlite | Anywhere |
| CHECK constraints reference real columns | `scripts/verify-constraints.py` | Anywhere, no DB |
| Constraints actually reject bad data | Raw SQL against PGlite | Anywhere |
| Full HTTP workflow | 31 end-to-end tests, real Postgres, real API | Needs a database |
| Type safety | `tsc` across 4 projects | Anywhere |

The end-to-end suite is what found the two model defects described in
[decisions.md](decisions.md) §4 and §5 — department stock counting as available,
and whole rolls moving on a partial rejection. Both were real bugs that unit
tests could not have caught, because both were about how modules compose.
