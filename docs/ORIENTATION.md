# Start here

A brief for anyone — or any assistant — picking this codebase up cold. It is
deliberately short and points at the detail rather than repeating it.

## What this is

A manufacturing and inventory ERP for **DASH AND DOT**, a premium Indian
fashion brand. pnpm monorepo:

| Package | What it holds |
|---|---|
| `apps/api` | NestJS 11 + Prisma 6 + PostgreSQL 16 |
| `apps/web` | Next.js 15 App Router |
| `packages/domain` | Framework-free business rules. **382 tests.** Read this first. |
| `packages/contracts` | Zod schemas, permissions, and the navigation map |

**Shopify and Unicommerce are integrated, not replaced.** Shopify is the
commerce platform; Unicommerce runs the warehouse and fulfils orders.

```
Shopify  --products, orders, order status-->  ERP  --products-->  Unicommerce
Shopify  <--inventory---------------------    ERP  <--inventory, shipping--
```

Both pulls are built. **Neither push is** — see "What is deliberately not
built" below.

## The rules that are load-bearing

These look like style and are not. Each has caused a real bug here.

1. **Quantities never sum across stages.** Cut 100, stitch 85, finish 60 is 60
   garments, not 245 — a garment passes through every stage.
2. **Issue is not consume.** Issuing is a transfer; only CONSUMPTION and
   WASTAGE retire stock.
3. **`LedgerService` is the only writer of `material_balances`**, and finished
   goods follow the same pattern a floor up: a balance moves only alongside a
   movement row that explains it.
4. **Header figures are derived from lines, never maintained in parallel.**
   `ManufacturingOrder.completedQty` exists and *nothing advances it* —
   production writes stage-task counters. Derive from the last route step.
5. **Decimal strings on the wire.** JSON numbers are IEEE-754 doubles.
6. **An incomplete stock search must never conclude "manufacture."** Five of
   seventeen Unicommerce facilities are invisible to the service account, so
   "not found" is not "does not exist".

## Guards that will reject your change

`packages/contracts` tests enforce delivery honesty:

- nothing may be marked `BUILT` in an undelivered phase
- a `PARTIAL` item must carry a description explaining the gap
- `PHASE_DEPENDENCIES` gates which phases may be marked delivered

These have caught real over-claiming. **Do not weaken them to make a change
pass** — fix the claim instead.

## What is deliberately not built

The Shopify and Unicommerce clients **refuse write paths structurally**: the
transport raises before a request is sent. The specification forbids live
external inventory changes without explicit authorisation.

Outstanding, all of it a decision rather than missing code:

- inventory push to Unicommerce — needs a service account, a non-cleartext
  transport, and a sandbox facility
- product push to Unicommerce, and inventory push back to Shopify

Also: **Unicommerce exposes no purchase-order READ endpoint** to this account.
Six documented paths return 404 while `create` responds. `/orders/bulk-po`
says so rather than rendering an empty table.

## Running it

```bash
pnpm install
pnpm -r build
./scripts/dev-restart.sh     # starts PGlite + API, in the order PGlite needs
cd apps/web && pnpm dev
```

The dev database is **PGlite** (Postgres as WASM) at `./.pgdata`. It serves
**one connection at a time**: run Prisma CLI only with the API stopped, and
expect it to wedge under sustained transaction churn. `docker/docker-compose.yml`
defines real Postgres 16 and is the better option wherever Docker is available.

## Where the reasoning lives

Design decisions are written down with their rejected alternatives. Read these
before changing behaviour in their area:

- `docs/decisions.md` — 31 architecture decision records
- `docs/shopify-integration.md` — verified endpoints, and what the live store
  actually emits
- `docs/unicommerce-integration.md` — the 17-facility master, the endpoint map,
  and three traps in it
- `docs/testing-strategy.md`

Commit messages carry the same reasoning; `git log` is a usable history here.

## Open questions only the business can answer

- Where does **bulk manufacturing demand** come from? Ruled out: marketplace
  orders, Unicommerce POs. `shopify_draft_order` remains the candidate.
- When Shopify and Unicommerce disagree about stock, **which is authoritative?**
  Working assumption: Unicommerce for stock, Shopify for demand. Unconfirmed.
- What is Shopify sales channel `402708955137`? It is 42% of recent orders and
  nothing names it.

## House style

- The UI is **monochrome on purpose**. Severity is carried by form — solid fill
  for "act now", outline for "waiting", a rule down the edge of a row needing
  attention — and every state sits beside a word. Do not reintroduce colour to
  "make status clearer"; it would be a regression.
- Comments explain **why**, not what.
- Empty states say what to do next. Errors say what happened and how to fix it.
- Every visible action must work or be clearly marked unavailable. No dummy
  buttons, no fake figures.
