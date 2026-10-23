# Barcode Architecture

Code generation and scan validation implemented and tested in
`packages/domain/src/production/barcode.ts` (19 tests). Minting, resolution and
label printing implemented in `apps/api/src/modules/barcodes`. The scan station
arrives in phase 3.

---

## 1. The identity strategy

**The printed symbol carries only a short, stable identifier.** No JSON, no
quantities, no stage, no SKU.

Three reasons, in order of how badly each would hurt:

1. **Context changes.** A label printed when a batch was at cutting would still
   claim `stage: CUTTING` three weeks later. The server is the only honest source
   of a batch's current state. An operator trusting a stale label is worse than
   one who has to scan.
2. **Density.** An embedded JSON payload produces a Code 128 symbol too wide to
   print on a garment tag and too error-prone for a cheap USB scanner under
   factory lighting.
3. **Mutability.** Quantities get split, merged and reworked. An identifier does
   not.

So all context is resolved server-side through `BarcodesService.resolve()`, which
is the single place an unknown or revoked barcode is refused.

## 2. Code format

Human-readable, because operators read codes aloud over the noise of a stitching
floor and type them in when a scanner fails.

```
BAT-2026000125-B01-K
│   │          │   └── check character
│   │          └────── batch sequence
│   └───────────────── compacted MO number
└───────────────────── kind prefix
```

| Kind | Prefix | Example |
|---|---|---|
| Material lot | `LOT` | `LOT-000042-7` |
| Fabric roll | `ROL` | `ROL-ROLL000013-M` |
| Production batch | `BAT` | `BAT-2026000125-B01-K` |
| Production unit | `UNT` | `UNT-2026000125-B01-U0042-R` |
| Goods receipt | `GRN` | `GRN-000007-W` |
| Finished goods carton | `CTN` | |

### Check character

Mod-30 over a Crockford-style alphabet that **omits `0`, `O`, `1`, `I` and `L`**
— the characters that survive a bad thermal print and a tired human least well.

It catches the single most common shop-floor failure: a code read aloud and typed
in with one character wrong. Cheap to compute, no dependency.

### Normalisation

Scanners add whitespace and casing varies, so every scanned string goes through
`normaliseScannedCode()` before anything else:

```ts
'  bat-2026000125-b01-k \n'  →  'BAT-2026000125-B01-K'
```

## 3. The four barcode families

| Family | Minted when | Identifies | Used at |
|---|---|---|---|
| **Material lot** | Goods receipt line created | One lot of one material | Receiving, issue, stock count |
| **Fabric roll** | Receipt line with roll detail; or roll split at inspection | One physical roll | Roll issue to cutting, roll return |
| **Batch / unit** | Batch created; units serialised | A quantity, or one garment | Every production stage |
| **Finished goods** | FG inward | A carton or inward reference | FG inward, dispatch |

Phase 1 mints lot, roll and receipt barcodes automatically — no operator action
is needed for a delivery to become scannable.

## 4. Scan validation

`assertScannable()` runs before any quantity is touched:

```ts
assertScannable(resolution, scannedCode, expectedKinds);
```

| Failure | Code | Meaning |
|---|---|---|
| Not in the database | `BARCODE_UNKNOWN` | Not a code this system issued |
| `isActive = false` | `BARCODE_REVOKED` | Revoked and reprinted — a found old label |
| Wrong family for the screen | `BARCODE_WRONG_KIND` | A roll barcode scanned at a stage terminal |

The revoked check matters: a damaged label gets reissued, and the old one is
often still lying on the bench. Without this, scanning it would post work twice.

## 5. Reprinting

`BarcodesService.reissue()` revokes the old code and mints a replacement with a
`-R<n>` suffix:

```
ROL-ROLL000013-M      → isActive = false, revokedAt, revokeReason
ROL-ROLL000013-M-R1   → new active code, same entity
```

The old code still **resolves** for history, so the audit trail stays intact, but
it can no longer be scanned. A damaged label does not strand a fabric roll, and a
found old label cannot be used to post work twice.

## 6. Label printing

Server-rendered PDF, laid out for **70 × 37 mm thermal stock, three across** —
what a typical garment unit uses.

Each label carries:

- the Code 128 symbol (or QR, selectable)
- a bold title: material code, roll number or GRN number
- up to three context lines read from the database **at print time**
- the code in monospace underneath, for the scanner-has-failed case

Because the context is read at print time, a label cannot assert a quantity or a
shade that has since changed. `printCount` and `lastPrintedAt` are tracked, and
printing is audited.

Images render through `bwip-js` (pure JS, Code 128 and QR) into `pdfkit`. Both
dependency-light and deterministic, so a label looks the same on every machine.

## 7. Idempotent scanning

The shop floor runs barcode terminals on factory wifi. A scan that times out gets
retried — by the device, or by an operator who did not see a confirmation. Without
protection, one physical event becomes two ledger entries.

Every scan submission carries a **client-generated idempotency key**:

```
BarcodeScanEvent.idempotencyKey        unique per organisation
ProductionStageMovement.idempotencyKey unique per organisation
MaterialMovement.idempotencyKey        unique per organisation
```

Two layers, as elsewhere in the system:

1. `IdempotencyRecord` returns the stored result for a replayed key with the same
   payload, and **409s** a replayed key with a *different* payload — the client
   has reused a key for a different operation, and silently accepting either
   answer would be wrong.
2. The unique index on the movement row refuses the duplicate even if the first
   layer were bypassed.

### Every scan is recorded, including the rejected ones

`BarcodeScanEvent` stores accepted, rejected and duplicate-ignored attempts, with
operator, device, session and timestamp. That gives:

- a complete audit trail of what was scanned where
- operator productivity data
- the diagnostic trail when an operator says "it didn't work" — the rejected scan
  and its validation message are both there

## 8. Scan workflow *(phase 3)*

```
operator signs in (employee code + PIN on a shared terminal)
  → selects a production stage
  → scans a batch or unit barcode
  → server resolves: MO, batch/unit, SKU, current stage, allowed next stage
  → operator enters received / completed / rejected / rework + remarks
  → server validates against the stage ledger and records the movement
```

Two scan kinds, matching the specification:

- **`STAGE_COMPLETE`** at stage N — records what the stage did with what it holds
- **`STAGE_RECEIVE`** at stage N+1 — pulls from stage N's completed-not-forwarded
  pool, bounded by `availableToForward`

Keeping receipt as a separate scan is what makes the handover auditable from both
sides: cutting says it finished 95, stitching says it accepted 95, and the two
events are independently recorded.

### Design requirements for the station

- Full-screen focus mode; large touch targets (`.scan-mode` tokens exist in
  `globals.css`)
- Audio and visual feedback per scan — an operator must not have to read the
  screen to know a scan landed
- Duplicate-scan prevention, visible rather than silent
- Offline queue **only with explicit reconciliation**: a queued scan is held
  locally with its idempotency key and replayed, and the operator is shown that
  it is pending rather than told it succeeded

## 9. Batch versus unit tracking

The specification is emphatic: *a batch containing 100 garments must not be
represented as a single finished unit*, and *100 completed units must not be
counted because a single batch barcode was scanned once*.

Both are handled by the same mechanism: **the operator always states the
quantity**. Scanning a batch barcode identifies the batch; it does not assert how
many garments were completed. `planStageOutcome()` then bounds that quantity by
the stage's WIP.

With `trackingMode = UNIT`, a unit scan creates a stage movement of qty 1 linked
to the unit *and* updates the batch counters through the same code path, so
unit-level and batch-level figures cannot disagree. Serialisation itself is
bounded by eligible quantity, so a batch can never produce more serials than
garments.

## 10. Test coverage

| Property | Cases |
|---|---|
| Code generation, stability, uniqueness | 6 |
| Payload-free symbols | 1 |
| Normalisation and malformed input | 2 |
| Check character catches a typo | 1 |
| Sequence bounds | 3 |
| Scan validation: unknown, revoked, wrong kind | 4 |
| Serialisation bounds | 4 |
| Batch split partitioning | 4 |
