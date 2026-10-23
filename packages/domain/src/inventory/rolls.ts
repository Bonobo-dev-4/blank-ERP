import { Decimal, clampNonNegative, qty, type DecimalLike } from '../decimal';
import { ERR, IllegalStateError, InvariantViolation, ValidationError } from '../errors';

export const FABRIC_ROLL_STATUSES = [
  'RECEIVED',
  'QC_PENDING',
  'AVAILABLE',
  'PARTIALLY_ISSUED',
  'ISSUED',
  'EXHAUSTED',
  'BLOCKED',
  'RETURNED_TO_SUPPLIER',
] as const;

export type FabricRollStatus = (typeof FABRIC_ROLL_STATUSES)[number];

/** Statuses from which fabric may be issued to cutting. */
const ISSUABLE_STATUSES: readonly FabricRollStatus[] = ['AVAILABLE', 'PARTIALLY_ISSUED'];

export interface RollState {
  readonly id: string;
  readonly rollNo?: string;
  readonly originalLength: DecimalLike;
  readonly currentLength: DecimalLike;
  readonly reservedLength: DecimalLike;
  readonly status: FabricRollStatus;
  readonly shade?: string | null;
  readonly width?: DecimalLike | null;
}

/** Length on the roll that is not committed to a manufacturing order. */
export function rollAvailableLength(roll: RollState): Decimal {
  return clampNonNegative(qty(roll.currentLength).minus(qty(roll.reservedLength)));
}

/**
 * Derive the status a roll should now carry from its lengths.
 *
 * Status is a projection of length, never set by hand: that way a roll cannot
 * report AVAILABLE with zero metres left, or EXHAUSTED with 12 m on it.
 * BLOCKED and RETURNED_TO_SUPPLIER are administrative and are preserved.
 */
export function deriveRollStatus(roll: RollState): FabricRollStatus {
  if (roll.status === 'BLOCKED' || roll.status === 'RETURNED_TO_SUPPLIER') return roll.status;
  if (roll.status === 'QC_PENDING' || roll.status === 'RECEIVED') return roll.status;

  const current = qty(roll.currentLength);
  const original = qty(roll.originalLength);
  if (current.lessThanOrEqualTo(0)) return 'EXHAUSTED';
  if (current.lessThan(original)) return 'PARTIALLY_ISSUED';
  return 'AVAILABLE';
}

export interface RollIssuePlan {
  readonly rollId: string;
  readonly issuedLength: Decimal;
  readonly newCurrentLength: Decimal;
  readonly newReservedLength: Decimal;
  readonly newStatus: FabricRollStatus;
}

/**
 * Issue a length off a roll.
 *
 * `reservationCoverLength` is the part of the request already committed to the
 * requesting order; it is released from the roll's reservation as it is issued,
 * so the reservation is not double counted once the fabric has physically gone.
 */
export function planRollIssue(
  roll: RollState,
  requestedLength: DecimalLike,
  reservationCoverLength: DecimalLike = 0,
): RollIssuePlan {
  const want = qty(requestedLength);
  if (want.lessThanOrEqualTo(0)) {
    throw new ValidationError(ERR.NON_POSITIVE_QTY, 'Issued length must be greater than zero', {
      rollId: roll.id, requestedLength: want.toFixed(),
    });
  }
  if (!ISSUABLE_STATUSES.includes(roll.status)) {
    throw new IllegalStateError(
      ERR.ROLL_NOT_ISSUABLE,
      `Roll ${roll.rollNo ?? roll.id} is ${roll.status} and cannot be issued`,
      { rollId: roll.id, status: roll.status, issuableStatuses: ISSUABLE_STATUSES },
    );
  }

  const current = qty(roll.currentLength);
  const reserved = qty(roll.reservedLength);
  if (want.greaterThan(current)) {
    throw new InvariantViolation(
      ERR.ROLL_LENGTH_EXCEEDED,
      'Issued length exceeds the length physically remaining on the roll',
      { rollId: roll.id, requestedLength: want.toFixed(), currentLength: current.toFixed() },
    );
  }

  const cover = Decimal.min(qty(reservationCoverLength), reserved);
  const unreserved = current.minus(reserved);
  const claimable = unreserved.plus(cover);
  if (want.greaterThan(claimable)) {
    throw new InvariantViolation(
      ERR.ROLL_LENGTH_EXCEEDED,
      'Issued length exceeds unreserved roll length plus this order’s reservation',
      {
        rollId: roll.id,
        requestedLength: want.toFixed(),
        currentLength: current.toFixed(),
        reservedLength: reserved.toFixed(),
        reservationCoverLength: cover.toFixed(),
      },
    );
  }

  const fromReservation = Decimal.min(Decimal.max(want.minus(unreserved), 0), cover);
  const newCurrent = qty(current.minus(want));
  const newReserved = qty(reserved.minus(fromReservation));
  const next: RollState = { ...roll, currentLength: newCurrent, reservedLength: newReserved };

  return {
    rollId: roll.id,
    issuedLength: want,
    newCurrentLength: newCurrent,
    newReservedLength: newReserved,
    newStatus: deriveRollStatus(next),
  };
}

/**
 * Return unused fabric to a roll.
 *
 * The return is capped at the roll's original length, which is what stops a
 * partial return from quietly inventing fabric: you can only put back what came
 * off, never more than the roll ever held.
 */
export function planRollReturn(roll: RollState, returnedLength: DecimalLike): RollIssuePlan {
  const back = qty(returnedLength);
  if (back.lessThanOrEqualTo(0)) {
    throw new ValidationError(ERR.NON_POSITIVE_QTY, 'Returned length must be greater than zero', {
      rollId: roll.id, returnedLength: back.toFixed(),
    });
  }
  const current = qty(roll.currentLength);
  const original = qty(roll.originalLength);
  const newCurrent = qty(current.plus(back));
  if (newCurrent.greaterThan(original)) {
    throw new InvariantViolation(
      ERR.ROLL_LENGTH_EXCEEDED,
      'Returning this length would make the roll longer than it was received',
      {
        rollId: roll.id,
        returnedLength: back.toFixed(),
        currentLength: current.toFixed(),
        originalLength: original.toFixed(),
      },
    );
  }
  const next: RollState = { ...roll, currentLength: newCurrent };
  return {
    rollId: roll.id,
    issuedLength: back.negated(),
    newCurrentLength: newCurrent,
    newReservedLength: qty(roll.reservedLength),
    newStatus: deriveRollStatus(next),
  };
}

export interface RollSelection {
  readonly rolls: readonly { readonly rollId: string; readonly length: Decimal }[];
  readonly selectedLength: Decimal;
  readonly shortfallLength: Decimal;
  readonly shadesUsed: readonly string[];
}

/**
 * Pick rolls to cover a required length.
 *
 * Prefers to finish partially-used rolls before opening a full one, which is
 * how a cutting room actually works: it minimises the number of short remnants
 * left in the rack.
 */
export function selectRollsForLength(
  requiredLength: DecimalLike,
  rolls: readonly RollState[],
  options: { readonly requiredShade?: string | null; readonly minimumWidth?: DecimalLike | null } = {},
): RollSelection {
  const want = qty(requiredLength);
  const eligible = rolls
    .filter((r) => ISSUABLE_STATUSES.includes(r.status))
    .filter((r) => rollAvailableLength(r).greaterThan(0))
    .filter((r) => !options.requiredShade || r.shade === options.requiredShade)
    .filter((r) => {
      if (options.minimumWidth == null) return true;
      return r.width != null && qty(r.width).greaterThanOrEqualTo(qty(options.minimumWidth));
    })
    .sort((a, b) => {
      // Partially-issued rolls first, then shortest remaining length.
      const pa = a.status === 'PARTIALLY_ISSUED' ? 0 : 1;
      const pb = b.status === 'PARTIALLY_ISSUED' ? 0 : 1;
      if (pa !== pb) return pa - pb;
      const cmp = rollAvailableLength(a).comparedTo(rollAvailableLength(b));
      if (cmp !== 0) return cmp;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  const picked: { rollId: string; length: Decimal }[] = [];
  const shades = new Set<string>();
  let remaining = want;
  for (const roll of eligible) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const take = Decimal.min(rollAvailableLength(roll), remaining);
    picked.push({ rollId: roll.id, length: qty(take) });
    if (roll.shade) shades.add(roll.shade);
    remaining = remaining.minus(take);
  }

  const selected = qty(want.minus(Decimal.max(remaining, 0)));
  return {
    rolls: picked,
    selectedLength: selected,
    shortfallLength: clampNonNegative(want.minus(selected)),
    shadesUsed: [...shades].sort(),
  };
}

/**
 * Shade-mix guard. A batch drawing fabric from more than one shade needs an
 * explicit approval; without one this refuses rather than producing garments
 * with mismatched panels.
 */
export function assertShadeMixAllowed(
  shadesUsed: readonly string[],
  approval: { readonly approved: boolean; readonly approvedByUserId?: string | null } = { approved: false },
): void {
  if (shadesUsed.length <= 1) return;
  if (approval.approved && approval.approvedByUserId) return;
  throw new IllegalStateError(
    ERR.SHADE_MIX_NOT_APPROVED,
    'This allocation mixes fabric shades, which requires an approved exception',
    { shadesUsed },
  );
}
