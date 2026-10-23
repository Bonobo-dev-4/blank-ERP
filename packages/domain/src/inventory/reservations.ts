import { Decimal, clampNonNegative, qty, type DecimalLike } from '../decimal';
import { ERR, InvariantViolation } from '../errors';
import { rowAvailable, type BalanceRow } from './availability';

export interface LotAttributes {
  readonly materialLotId: string;
  readonly shade?: string | null;
  readonly width?: DecimalLike | null;
  readonly receivedAt?: Date | null;
  readonly unitCost?: DecimalLike | null;
}

export interface AllocationConstraints {
  /**
   * Keep an entire manufacturing order on one shade. Mixing shades inside a
   * garment batch produces visibly mismatched panels, so it requires an
   * explicit approval rather than being a silent allocation decision.
   */
  readonly singleShade?: boolean;
  /** Only accept lots of this shade. */
  readonly requiredShade?: string | null;
  /** Only accept lots at least this wide (cut plans depend on usable width). */
  readonly minimumWidth?: DecimalLike | null;
}

export interface AllocationLine {
  readonly materialLotId: string;
  readonly locationId: string;
  readonly qty: Decimal;
}

export interface AllocationResult {
  readonly lines: readonly AllocationLine[];
  readonly allocatedQty: Decimal;
  /** Requested minus allocated: what must still be purchased or waived. */
  readonly shortfallQty: Decimal;
  /** Shades touched by the allocation; >1 means an approval is required. */
  readonly shadesUsed: readonly string[];
}

/**
 * Choose which lots and locations a reservation should draw from.
 *
 * Strategy is FEFO-ish for garments: oldest received lot first, so fabric does
 * not age in the rack while newer rolls are cut. Deterministic ordering also
 * means two planners running MRP on the same data get the same allocation.
 */
export function allocateFromStock(
  requestedQty: DecimalLike,
  rows: readonly BalanceRow[],
  lots: readonly LotAttributes[],
  constraints: AllocationConstraints = {},
): AllocationResult {
  const want = qty(requestedQty);
  if (want.lessThanOrEqualTo(0)) {
    return { lines: [], allocatedQty: new Decimal(0), shortfallQty: new Decimal(0), shadesUsed: [] };
  }

  const lotById = new Map(lots.map((l) => [l.materialLotId, l]));

  const eligible = rows
    .filter((r) => rowAvailable(r).greaterThan(0))
    .filter((r) => {
      const lot = lotById.get(r.materialLotId);
      if (constraints.requiredShade && lot?.shade !== constraints.requiredShade) return false;
      if (constraints.minimumWidth != null) {
        const w = lot?.width;
        if (w == null || qty(w).lessThan(qty(constraints.minimumWidth))) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const la = lotById.get(a.materialLotId);
      const lb = lotById.get(b.materialLotId);
      const ta = la?.receivedAt ? la.receivedAt.getTime() : Number.MAX_SAFE_INTEGER;
      const tb = lb?.receivedAt ? lb.receivedAt.getTime() : Number.MAX_SAFE_INTEGER;
      if (ta !== tb) return ta - tb;
      // Stable tiebreak so allocation is reproducible.
      return a.materialLotId < b.materialLotId ? -1 : a.materialLotId > b.materialLotId ? 1 : 0;
    });

  // When the order must stay on one shade, pick the single shade that can
  // satisfy the most of the request (preferring the oldest on a tie).
  let pool = eligible;
  if (constraints.singleShade && !constraints.requiredShade) {
    const byShade = new Map<string, BalanceRow[]>();
    for (const r of eligible) {
      const shade = lotById.get(r.materialLotId)?.shade ?? '';
      const list = byShade.get(shade);
      if (list) list.push(r);
      else byShade.set(shade, [r]);
    }
    let best: BalanceRow[] = [];
    let bestQty = new Decimal(-1);
    for (const list of byShade.values()) {
      const total = list.reduce<Decimal>((acc, r) => acc.plus(rowAvailable(r)), new Decimal(0));
      if (total.greaterThan(bestQty)) { bestQty = total; best = list; }
    }
    pool = best;
  }

  const lines: AllocationLine[] = [];
  const shades = new Set<string>();
  let remaining = want;

  for (const row of pool) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const take = Decimal.min(rowAvailable(row), remaining);
    if (take.lessThanOrEqualTo(0)) continue;
    lines.push({ materialLotId: row.materialLotId, locationId: row.location.id, qty: qty(take) });
    const shade = lotById.get(row.materialLotId)?.shade;
    if (shade) shades.add(shade);
    remaining = remaining.minus(take);
  }

  const allocated = qty(want.minus(remaining));
  return {
    lines,
    allocatedQty: allocated,
    shortfallQty: clampNonNegative(want.minus(allocated)),
    shadesUsed: [...shades].sort(),
  };
}

export interface ReservationState {
  readonly reservedQty: DecimalLike;
  readonly issuedQty: DecimalLike;
  readonly releasedQty: DecimalLike;
}

/** Quantity of a reservation still awaiting issue. */
export function openReservationQty(r: ReservationState): Decimal {
  return clampNonNegative(qty(r.reservedQty).minus(qty(r.issuedQty)).minus(qty(r.releasedQty)));
}

/**
 * Consume part of a reservation when material is issued against it.
 * Over-consuming a reservation is an invariant violation, not a warning.
 */
export function applyIssueToReservation(r: ReservationState, issueQty: DecimalLike): {
  readonly issuedQty: Decimal;
  readonly status: 'ACTIVE' | 'PARTIALLY_CONSUMED' | 'CONSUMED';
} {
  const want = qty(issueQty);
  const open = openReservationQty(r);
  if (want.greaterThan(open)) {
    throw new InvariantViolation(
      ERR.RESERVATION_EXCEEDS_ON_HAND,
      'Issue quantity exceeds the open quantity of this reservation',
      { requestedQty: want.toFixed(), openQty: open.toFixed() },
    );
  }
  const issued = qty(qty(r.issuedQty).plus(want));
  const total = qty(r.reservedQty);
  const consumedAll = issued.plus(qty(r.releasedQty)).greaterThanOrEqualTo(total);
  return {
    issuedQty: issued,
    status: consumedAll ? 'CONSUMED' : issued.greaterThan(0) ? 'PARTIALLY_CONSUMED' : 'ACTIVE',
  };
}
