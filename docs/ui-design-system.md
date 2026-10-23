# UI Design System

Implemented. Tokens in `apps/web/src/app/globals.css`, components in
`apps/web/src/components/`.

---

## 1. Who this interface is for

Three very different contexts, and the design has to serve all three:

| Context | Device | Session | What matters |
|---|---|---|---|
| Office | Desktop, 1440px+ | Hours | Density, comparison across rows, keyboard |
| Shop floor | Tablet, often grubby, often gloved | Seconds | Large targets, unambiguous feedback |
| Warehouse | Tablet or laptop at a bench | Minutes | Fast data entry, few round trips |

The office context dominates the visual language because that is where most of
the hours are spent. The shop floor gets dedicated screens rather than a
responsive squeeze of a desktop layout.

## 2. Design position

**Restrained to the point of plainness, so that colour means something.**

This interface is read for eight hours at a stretch under factory lighting.
Surfaces stay near-white; type is small and dense; borders are faint. Colour is
reserved for meaning — a status, a shortage, a rejection. Colour that decorates
competes with colour that warns, and a warning that competes is a warning that
gets missed.

The dark navigation rail is the one strong visual element. It anchors the layout
and keeps the working area visually quiet.

## 3. Tokens

```css
/* Neutral surfaces — the interface spends most of its area here */
--color-canvas:        oklch(0.985 0.002 250);
--color-surface:       oklch(1     0     0  );
--color-surface-muted: oklch(0.972 0.003 250);
--color-line:          oklch(0.915 0.005 250);
--color-line-strong:   oklch(0.855 0.008 250);

/* Text — three weights, no more */
--color-ink:        oklch(0.22 0.014 258);
--color-ink-muted:  oklch(0.49 0.012 258);
--color-ink-subtle: oklch(0.62 0.011 258);

/* The dark rail */
--color-rail:          oklch(0.235 0.018 262);
--color-rail-hover:    oklch(0.295 0.022 262);
--color-rail-active:   oklch(0.355 0.030 262);

/* One brand ink, used sparingly */
--color-brand:        oklch(0.47 0.14 262);
--color-brand-strong: oklch(0.40 0.15 262);
--color-brand-soft:   oklch(0.955 0.02 262);

/* Semantic status — each with a soft background for badges */
--color-ok / ok-soft          green
--color-warn / warn-soft      amber
--color-danger / danger-soft  red
--color-info / info-soft      blue
```

`oklch` throughout, because it is perceptually uniform: `ok` and `warn` at the
same lightness actually *look* equally prominent, which matters when a status
column is scanned down rather than read.

### Typography

**13px base.** Unusually small for a web application, and deliberate: compact
data tables are the whole point of this interface, and the useful comparison is
between rows. Fitting four more rows on screen beats generous padding.

```
11px   table headers, metadata, badges
12px   secondary text, hints
12.5px table body, form labels
13px   base, primary values
14-17px headings
22px   dashboard stat figures
```

System font stack — no webfont. A font that has not loaded is a factory tablet
showing a blank table.

### Tabular figures everywhere a quantity appears

```css
.num { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum'; }
```

Decimal points line up down a column, so `1,250.00` and `125.00` are
*visually* different lengths and a wrong order of magnitude is obvious at a
glance. This is applied through the `.num` class and the table's `meta.numeric`
column flag, not by hand.

## 4. The component set

### `DataTable`

The single table component. Every grid in the application goes through it, so
sorting, searching, pagination, CSV export and empty states behave identically
everywhere.

- Compact rows, sticky header, `overflow-x: auto` on its own container so the
  **page** never scrolls sideways
- Server-side pagination with page-size control
- Debounced search (250 ms), resetting to page one
- Column `meta: { align, numeric }` drives alignment and tabular figures
- CSV export of loaded rows
- `onRowClick` for navigation; rows show a pointer and a brand-tinted hover

### `StatusBadge`

**One shared status-to-colour mapping**, centralised deliberately. If `REJECTED`
were amber on one screen and red on another, operators would stop trusting the
colour and start reading every label — which defeats the point of having them.

Covers every enum the system uses: approval states, receipt states, inspection
results, stock alert levels, roll statuses, sync states, location kinds,
severities.

### `ErrorPanel`

Shows the API's machine-readable code **and the actual numbers** from `details`:

```
Movement quantity exceeds unreserved stock at the source location
INSUFFICIENT_UNRESERVED_STOCK

Requested qty     300.0000
On hand qty       500.0000
Reserved qty      450.0000
Available qty      50.0000

[Try again]                              ref 7f3a…
```

A storekeeper shown those numbers can fix the problem. One shown "Conflict" has
to find a developer. The `requestId` is displayed so they can quote one number.

### `Stat`

A labelled figure with a **hint that carries the definition**. That matters a
lot here: "available" and "on hand" are different numbers, and a tile that shows
one while the reader assumes the other causes over-promising. Optional `href` so
clicking a number opens the underlying records.

### `ConfirmDialog`

For elevated actions. `consequence` is a **required** prop, not optional:

> *"This abandons 200.0000 of outstanding quantity across 3 lines. The order can
> no longer take deliveries."*

The way to make an action deliberate is to state in words what will happen, not
to add a second button.

### `Button` variants

| Variant | Use |
|---|---|
| `primary` | The main action |
| `default` | Secondary |
| `ghost` | Tertiary, icon buttons |
| `danger` | Destructive |
| **`elevated`** | **Creates or destroys value** — amber, visually distinct |

`elevated` exists so an operator notices *before* clicking a stock adjustment,
not after.

### `QtyInput`

`inputMode="decimal"` for a numeric keypad on tablets, right-aligned, tabular
figures, and the value is kept as a **string** all the way to the API. Never
parsed to a float in between — that is how a 4-decimal fabric length loses its
last digit.

## 5. Layout

```
┌──────────┬──────────────────────────────────────────────┐
│          │ Topbar: breadcrumb · phase · refresh · user  │
│  Dark    ├──────────────────────────────────────────────┤
│  rail    │                                              │
│  240px   │  Page: header + actions, then content        │
│          │                                              │
└──────────┴──────────────────────────────────────────────┘
```

Rail collapses to a drawer below `lg`. Breadcrumbs are derived from the
navigation map by longest-prefix match, so a detail page shows
`Purchase Orders › Detail` rather than a raw UUID.

The refresh button invalidates every query at once — useful when a storekeeper
has just posted something on another terminal.

## 6. Honest navigation

The specification requires that every visible action either works or is clearly
marked unavailable.

| Status | Sidebar rendering |
|---|---|
| Built | Normal link |
| Partial | Link + amber dot, tooltip naming what is missing |
| **Planned** | **Disabled, greyed, `P3` phase chip, cursor `not-allowed`** |

Reaching a planned route by URL gives a page stating the phase, what that phase
covers, and that the schema and contracts already exist. Not an empty table that
looks like a data problem.

The dashboard does the same at the data level: production, demand and
finished-goods sections report `available: false` with their phase, rather than a
zero that reads as a measurement.

42 planned routes have such a page. The build-status summary is shown on the
dashboard, so the honesty is quantified rather than asserted.

## 7. Form conventions

- `Field` wraps label, control, hint and error consistently
- `required` shows a red asterisk; `hint` carries units or an explanation
- **All field errors at once.** A goods receipt has dozens of line fields, and
  making a storekeeper resubmit once per mistake is how data entry gets abandoned
  for a paper notebook
- Validated with the **same Zod schema the API uses**, imported from
  `@dnd/contracts`. Client validation is for speed of feedback only; the server
  validates independently, so the two cannot drift
- One idempotency key per form opening, so a double-click replays rather than
  duplicates

### Live validation where it prevents rework

The receive and inspect dialogs validate continuously rather than on submit:

- Roll lengths must add up to the received quantity — shown as
  `290.00 of 300.00 m` in a badge that turns red
- Accepted + rejected must equal received, per line
- A rejected length on a roll-tracked line must be allocated to specific rolls

All three would otherwise be a server rejection *after* the storekeeper has typed
twenty lengths.

## 8. Data presentation rules

**Quantities always carry their unit.** `262.50 m`, not `262.50`.

**Indian number formatting.** `1,25,000` via `Intl` with `en-IN`, and compact
money in the units the business uses: `₹1.73 L`, `₹2.40 Cr`.

**Codes are monospaced.** SKUs, lot codes, barcodes, document numbers — through
`CodeCell`, so they are visually distinct from prose and comparable character by
character.

**Two-line cells** via `StackedCell`: a primary identifier with context
underneath, which fits far more information per row than extra columns.

**Decimals are never parsed back into arithmetic.** The server owns the numbers;
the browser displays them.

## 9. Shop-floor mode

Tokens exist and the scan station in phase 3 uses them:

```css
.scan-mode { font-size: 16px; }
.scan-mode input { font-size: 20px; }
```

Requirements for that screen: full-bleed, large touch targets, audio **and**
visual scan feedback (an operator must not have to read the screen to know a scan
landed), visible duplicate-scan prevention, and a pending state for queued
offline scans rather than a false success.

## 10. Accessibility

- Focus-visible outlines in the brand colour, never removed
- `aria-label` on every icon-only button
- Semantic tables with real `<th scope>` headers
- Status conveyed by **badge text as well as colour**, so it survives colour
  blindness and a bad tablet screen
- Dialogs via Radix: focus trap, escape, labelled title and description

Known gap: contrast at 11px `ink-subtle` on `surface-muted` is marginal against
WCAG AA. It is used only for non-essential metadata, but it should be measured
and raised.

## 11. Print

`@media print` hides navigation and switches to a white ground. Barcode labels
are **not** browser-printed — they are server-rendered PDFs laid out for 70 × 37 mm
thermal stock, because browser print margins cannot be relied on for a label that
has to align with a die-cut sheet.

## 12. What is not built

- Saved views (the `SavedView` table exists; no UI)
- Keyboard shortcuts beyond native tab order
- Bulk inline editing (Excel-like paste)
- Dark mode
- Virtualised rows for very large tables (server pagination covers it today)
