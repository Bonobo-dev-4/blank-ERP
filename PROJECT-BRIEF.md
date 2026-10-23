# DASH AND DOT ERP — project brief

Context for anyone working on this codebase, human or AI. Paste it whole into
ChatGPT or Claude at the start of a session, or point an agent at the file.

Written to be self-contained: it says what the system is, the rules that are
load-bearing, the decisions already made, and the traps that have cost real
time. It does **not** repeat the detailed reasoning — that lives in `docs/`
and in the commit history, and you should read those before changing behaviour
in their area.

---

## 1. What this is

A manufacturing and inventory ERP for **DASH AND DOT**, a premium Indian
fashion brand. pnpm monorepo:

| Package | Holds |
|---|---|
| `apps/api` | NestJS 11, Prisma 6, PostgreSQL 16 |
| `apps/web` | Next.js 15, App Router |
| `packages/domain` | Framework-free business rules. **382 tests. Read first.** |
| `packages/contracts` | Zod schemas, permissions, the navigation map |

**Shopify and Unicommerce are integrated, not replaced.** Shopify is the
commerce platform. Unicommerce runs the warehouse and fulfils orders. The ERP
sits in the middle:

```
Shopify  --products, orders, order status-->  ERP  --products-->  Unicommerce
Shopify  <--inventory---------------------    ERP  <--inventory, shipping--
```

Both pulls are built. **Neither push is** — see §4.

Phases 1–6 are marked delivered; 59 of 64 screens built.

---

## 2. Rules that are load-bearing

These look like style and are not. Each has caused a real bug here.

1. **Quantities never sum across stages.** Cut 100, stitch 85, finish 60 is 60
   garments, not 245 — a garment passes through every stage.
2. **Issue is not consume.** Issuing is a transfer; only CONSUMPTION and
   WASTAGE retire stock.
3. **`LedgerService` is the only writer of `material_balances`.** Finished
   goods follow the same pattern a floor up: a balance moves only alongside a
   movement row that explains it.
4. **Header figures are derived from lines, never maintained in parallel.**
   `ManufacturingOrder.completedQty` exists and *nothing advances it* —
   production writes stage-task counters. Derive from the last route step.
5. **Decimal strings on the wire.** JSON numbers are IEEE-754 doubles.
6. **An incomplete stock search must never conclude "manufacture."** Five of
   seventeen Unicommerce facilities are invisible to the service account, so
   "not found" is not "does not exist". Those lines go to a NEEDS_CHECK state.

---

## 3. Guards that will reject your change

Tests in `packages/contracts` enforce delivery honesty:

- nothing may be marked `BUILT` in an undelivered phase
- a `PARTIAL` item must carry a description explaining the gap
- `PHASE_DEPENDENCIES` gates which phases may be marked delivered

These have caught real over-claiming. **Do not weaken them to make a change
pass** — fix the claim instead.

---

## 4. External writes are gated. Do not enable them.

The Shopify and Unicommerce clients **refuse write paths structurally** — the
transport raises before a request is sent. The specification forbids live
external inventory changes without explicit authorisation.

Outstanding, and each is a business decision rather than missing code:

- **inventory push to Unicommerce** — needs a service account, a transport
  that is not cleartext, and a sandbox facility to rehearse the
  uncertain-outcome path in
- **product push to Unicommerce**
- **inventory push back to Shopify**

**Do not set `INTEGRATION_ALLOW_EXTERNAL_WRITES` or remove the transport guards
unless the owner asks for it explicitly, in that request.**

Related finding: Unicommerce exposes **no purchase-order READ endpoint** to
this account. Six documented paths return 404 while `create` responds. So bulk
POs can be written but not read, and `/orders/bulk-po` says exactly that rather
than rendering an empty table.

---

## 5. Decisions already made — do not reopen

- **Two exposed secrets are knowingly not being rotated.** The risk was
  explained in full and the owner declined, twice, because rotation would
  break a dependent integration. Treat it as settled: do not re-raise it
  unprompted, do not append warnings about it to unrelated work, and never
  rotate anything unilaterally.
- **The UI is monochrome on purpose** — see §7.
- Never echo secrets into chat, logs, commits or files. `.env` is gitignored
  and has stayed clean through every commit. Keep it that way.

---

## 6. Running it

```bash
pnpm install
pnpm -r build
./scripts/dev-restart.sh     # PGlite + API, in the order PGlite needs
cd apps/web && pnpm dev
```

The dev database is **PGlite** — Postgres compiled to WASM, at `./.pgdata`.
**It serves one connection at a time**, and that causes three recurring
problems:

- running the Prisma CLI while the API is up fails with `P1001` — stop the API
  first
- killing the API mid-connection leaves PGlite listening but refusing every
  connect; the API then dies at boot with "Can't reach database server"
- sustained transaction churn wedges it outright. An import opening a
  transaction per row will take it down; bulk-load per page instead

`scripts/dev-restart.sh` recovers it in the right order: stop the client first,
clear `.pgdata/postmaster.pid`, restart the server.

**The real fix is Docker.** `docker/docker-compose.yml` already defines
Postgres 16 correctly. Use it wherever Docker is available — for real volumes
(5,700+ products) PGlite is the wrong tool.

---

## 7. House style

- **Monochrome UI, deliberately.** Severity is carried by *form*, not hue: a
  solid ink chip means act now, an outline means waiting, grey means normal, a
  row needing attention carries a rule down its edge, and quantity lost is
  struck through. Every state also sits beside a **word**.
  **Do not reintroduce red/green/amber "to make status clearer"** — it is a
  regression. Monochrome plus a label is more legible for colour-blind
  operators, under factory lighting, and on cheap tablets.
- The navigation signature is a **sliding slab**: one solid block marks what is
  active and moves to what you pick — down the nav rail, and as a tab underline
  (`apps/web/src/components/ui/tabs.tsx`). Reuse it for new tabbed screens.
- Type: Instrument Sans (display), Inter (UI), IBM Plex Mono (figures).
- Comments explain **why**, not what.
- Empty states say what to do next. Errors say what happened and how to fix it.
- **Every visible action must work or be clearly marked unavailable.** No dummy
  buttons, no fake figures, no mock transactions.

---

## 8. Where the reasoning lives

Design decisions are written down with their rejected alternatives:

- `docs/decisions.md` — 31 architecture decision records
- `docs/shopify-integration.md` — verified endpoints, and what the live store
  actually emits
- `docs/unicommerce-integration.md` — the 17-facility master, the endpoint map,
  and three traps in it
- `docs/testing-strategy.md`

Commit messages carry the same reasoning; `git log` is a usable history here.

---

## 9. Open questions only the business can answer

- **Where does bulk manufacturing demand come from?** Ruled out: marketplace
  orders (Nykaa and Myntra arrive through the normal sale-order feed, ~3% of
  volume) and Unicommerce purchase orders (unreadable, §4).
  `shopify_draft_order` remains the candidate.
- **When Shopify and Unicommerce disagree about stock, which is
  authoritative?** Working assumption: Unicommerce for stock (it fulfils, and
  writes `unicommerce complete` tags back to Shopify), Shopify for demand.
  Unconfirmed.
- **What is Shopify sales channel `402708955137`?** It is 42% of recent orders
  and nothing names it. Currently defaults to ONLINE — a default, not a
  decision.
- **Is a bespoke in-store sale POS or CUSTOM?** Sidestepped for now by
  recording `isCustomised` separately from `channel`, so the answer can change
  without re-importing.
