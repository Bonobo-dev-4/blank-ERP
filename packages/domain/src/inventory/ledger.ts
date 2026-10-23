import { Decimal, dec, qty, type DecimalLike } from '../decimal';
import { ERR, IllegalStateError, InvariantViolation, ValidationError } from '../errors';
import { isOwned, type LocationKind, type LocationRef } from './locations';

export const MOVEMENT_TYPES = [
  'OPENING_BALANCE',
  'PURCHASE_INWARD',
  'QC_RELEASE',
  'QC_REJECT',
  'SUPPLIER_RETURN',
  'ISSUE_TO_PRODUCTION',
  'RETURN_FROM_PRODUCTION',
  'TRANSFER',
  'ISSUE_TO_JOB_WORKER',
  'RETURN_FROM_JOB_WORKER',
  'CONSUMPTION',
  'WASTAGE',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'STOCK_COUNT_GAIN',
  'STOCK_COUNT_LOSS',
] as const;

export type MovementType = (typeof MOVEMENT_TYPES)[number];

export interface MovementRule {
  /** Location kinds this movement may debit. */
  readonly sourceKinds: readonly LocationKind[];
  /** Location kinds this movement may credit. */
  readonly destinationKinds: readonly LocationKind[];
  /**
   * True when the movement is allowed to draw on quantity that a manufacturing
   * order has reserved (the caller must supply the matching reservation cover).
   */
  readonly consumesReservation: boolean;
  /** True when the movement must cite an authorising document. */
  readonly requiresReference: boolean;
  /** True when an elevated permission is required (stock created/destroyed). */
  readonly elevated: boolean;
}

/**
 * The movement state machine.
 *
 * This table is the single place that decides which inventory transitions
 * exist. Note what it makes impossible by construction:
 *
 *  - Nothing may be sourced from a SINK. Material that has been consumed into a
 *    garment or scrapped cannot be un-consumed; a mistake is corrected with an
 *    explicit reversing movement, which leaves both entries in the audit trail.
 *  - ISSUE_TO_PRODUCTION credits a PHYSICAL department location, it does not
 *    credit a SINK. Issuing is a *transfer*; owned quantity is unchanged. Only
 *    CONSUMPTION and WASTAGE retire stock. That split is what stops the same
 *    metre of fabric being deducted again at every stage it passes through.
 *  - PURCHASE_INWARD may only credit QUALITY_HOLD, so received goods cannot
 *    reach an issuable location without passing inspection.
 */
export const MOVEMENT_RULES: Readonly<Record<MovementType, MovementRule>> = {
  OPENING_BALANCE: {
    sourceKinds: ['COUNTERPARTY'], destinationKinds: ['PHYSICAL'],
    consumesReservation: false, requiresReference: false, elevated: true,
  },
  PURCHASE_INWARD: {
    sourceKinds: ['COUNTERPARTY'], destinationKinds: ['QUALITY_HOLD'],
    consumesReservation: false, requiresReference: true, elevated: false,
  },
  QC_RELEASE: {
    sourceKinds: ['QUALITY_HOLD'], destinationKinds: ['PHYSICAL'],
    consumesReservation: false, requiresReference: true, elevated: false,
  },
  QC_REJECT: {
    sourceKinds: ['QUALITY_HOLD'], destinationKinds: ['BLOCKED'],
    consumesReservation: false, requiresReference: true, elevated: false,
  },
  SUPPLIER_RETURN: {
    sourceKinds: ['BLOCKED', 'QUALITY_HOLD'], destinationKinds: ['COUNTERPARTY'],
    consumesReservation: false, requiresReference: true, elevated: false,
  },
  ISSUE_TO_PRODUCTION: {
    sourceKinds: ['PHYSICAL'], destinationKinds: ['PRODUCTION_FLOOR'],
    consumesReservation: true, requiresReference: true, elevated: false,
  },
  RETURN_FROM_PRODUCTION: {
    sourceKinds: ['PRODUCTION_FLOOR'], destinationKinds: ['PHYSICAL'],
    consumesReservation: false, requiresReference: true, elevated: false,
  },
  TRANSFER: {
    sourceKinds: ['PHYSICAL', 'PRODUCTION_FLOOR', 'IN_TRANSIT', 'BLOCKED'],
    destinationKinds: ['PHYSICAL', 'PRODUCTION_FLOOR', 'IN_TRANSIT', 'BLOCKED'],
    consumesReservation: false, requiresReference: false, elevated: false,
  },
  ISSUE_TO_JOB_WORKER: {
    sourceKinds: ['PHYSICAL', 'PRODUCTION_FLOOR'], destinationKinds: ['JOB_WORKER'],
    consumesReservation: true, requiresReference: true, elevated: false,
  },
  RETURN_FROM_JOB_WORKER: {
    sourceKinds: ['JOB_WORKER'], destinationKinds: ['PHYSICAL', 'PRODUCTION_FLOOR'],
    consumesReservation: false, requiresReference: true, elevated: false,
  },
  CONSUMPTION: {
    sourceKinds: ['PRODUCTION_FLOOR', 'JOB_WORKER'], destinationKinds: ['SINK'],
    consumesReservation: true, requiresReference: true, elevated: false,
  },
  WASTAGE: {
    sourceKinds: ['PRODUCTION_FLOOR', 'JOB_WORKER'], destinationKinds: ['SINK'],
    consumesReservation: true, requiresReference: true, elevated: false,
  },
  ADJUSTMENT_IN: {
    sourceKinds: ['COUNTERPARTY'], destinationKinds: ['PHYSICAL', 'BLOCKED'],
    consumesReservation: false, requiresReference: true, elevated: true,
  },
  ADJUSTMENT_OUT: {
    sourceKinds: ['PHYSICAL', 'BLOCKED'], destinationKinds: ['COUNTERPARTY'],
    consumesReservation: false, requiresReference: true, elevated: true,
  },
  STOCK_COUNT_GAIN: {
    sourceKinds: ['COUNTERPARTY'], destinationKinds: ['PHYSICAL'],
    consumesReservation: false, requiresReference: true, elevated: true,
  },
  STOCK_COUNT_LOSS: {
    sourceKinds: ['PHYSICAL'], destinationKinds: ['COUNTERPARTY'],
    consumesReservation: false, requiresReference: true, elevated: true,
  },
};

export interface BalanceSnapshot {
  readonly onHandQty: DecimalLike;
  readonly reservedQty: DecimalLike;
}

export interface BalanceDelta {
  readonly locationId: string;
  readonly onHandDelta: Decimal;
  readonly reservedDelta: Decimal;
}

export interface MovementPlanInput {
  readonly movementType: MovementType;
  readonly baseQty: DecimalLike;
  readonly source: LocationRef;
  readonly destination: LocationRef;
  /** Current balance at the source for this (material, lot, location). */
  readonly sourceBalance?: BalanceSnapshot | null;
  /**
   * Quantity of this movement that is covered by an active reservation held by
   * the authorising manufacturing order. Only meaningful for movement types
   * whose rule sets consumesReservation.
   */
  readonly reservationCoverQty?: DecimalLike;
  /** Present when the movement cites an authorising document. */
  readonly hasReference?: boolean;
}

export interface MovementPlan {
  readonly movementType: MovementType;
  readonly baseQty: Decimal;
  readonly deltas: readonly BalanceDelta[];
  /** How much of the quantity was drawn from reserved stock. */
  readonly reservationConsumedQty: Decimal;
}

/**
 * Validate a proposed movement and compute the exact balance deltas it implies.
 *
 * Pure: it touches no database. The service layer locks the affected balance
 * rows, calls this, then applies the returned deltas and writes the ledger row
 * inside one transaction.
 */
export function planMovement(input: MovementPlanInput): MovementPlan {
  const rule = MOVEMENT_RULES[input.movementType];
  if (!rule) {
    throw new ValidationError('UNKNOWN_MOVEMENT_TYPE', `Unknown movement type ${input.movementType}`, {
      movementType: input.movementType,
    });
  }

  const baseQty = qty(input.baseQty);
  if (!baseQty.isFinite() || baseQty.lessThanOrEqualTo(0)) {
    throw new ValidationError(ERR.NON_POSITIVE_QTY, 'Movement quantity must be greater than zero', {
      baseQty: baseQty.toFixed(),
    });
  }

  if (input.source.id === input.destination.id) {
    throw new ValidationError(
      ERR.SAME_SOURCE_AND_DESTINATION,
      'Source and destination locations must differ',
      { locationId: input.source.id },
    );
  }

  if (!rule.sourceKinds.includes(input.source.kind)) {
    throw new IllegalStateError(
      'MOVEMENT_SOURCE_NOT_ALLOWED',
      `${input.movementType} cannot take stock from a ${input.source.kind} location`,
      { movementType: input.movementType, sourceKind: input.source.kind, allowed: rule.sourceKinds },
    );
  }

  if (!rule.destinationKinds.includes(input.destination.kind)) {
    throw new IllegalStateError(
      'MOVEMENT_DESTINATION_NOT_ALLOWED',
      `${input.movementType} cannot put stock into a ${input.destination.kind} location`,
      {
        movementType: input.movementType,
        destinationKind: input.destination.kind,
        allowed: rule.destinationKinds,
      },
    );
  }

  if (rule.requiresReference && input.hasReference === false) {
    throw new ValidationError(
      'MOVEMENT_REFERENCE_REQUIRED',
      `${input.movementType} must cite an authorising document`,
      { movementType: input.movementType },
    );
  }

  let reservationConsumedQty = new Decimal(0);

  // Stock checks apply only when debiting a location that holds owned stock.
  // Virtual counter-accounts are allowed to go negative: that is what makes
  // them counter-accounts.
  if (isOwned(input.source.kind)) {
    const bal = input.sourceBalance;
    if (!bal) {
      throw new InvariantViolation(
        ERR.INSUFFICIENT_STOCK,
        'No stock exists at the source location for this material and lot',
        { locationId: input.source.id, requestedQty: baseQty.toFixed() },
      );
    }
    const onHand = qty(bal.onHandQty);
    const reserved = qty(bal.reservedQty);
    const unreserved = onHand.minus(reserved);

    // Physical stock is the hard ceiling regardless of reservations.
    if (baseQty.greaterThan(onHand)) {
      throw new InvariantViolation(
        ERR.INSUFFICIENT_STOCK,
        'Movement quantity exceeds physical stock at the source location',
        {
          locationId: input.source.id,
          requestedQty: baseQty.toFixed(),
          onHandQty: onHand.toFixed(),
        },
      );
    }

    if (rule.consumesReservation) {
      const cover = Decimal.min(qty(input.reservationCoverQty ?? 0), reserved);
      const availableToThisOrder = unreserved.plus(cover);
      if (baseQty.greaterThan(availableToThisOrder)) {
        throw new InvariantViolation(
          ERR.INSUFFICIENT_UNRESERVED_STOCK,
          'Movement quantity exceeds unreserved stock plus this order’s reservation',
          {
            locationId: input.source.id,
            requestedQty: baseQty.toFixed(),
            onHandQty: onHand.toFixed(),
            reservedQty: reserved.toFixed(),
            reservationCoverQty: cover.toFixed(),
            availableToThisOrder: availableToThisOrder.toFixed(),
          },
        );
      }
      // Draw from unreserved stock first, then from this order's reservation.
      reservationConsumedQty = Decimal.max(baseQty.minus(unreserved), 0);
      reservationConsumedQty = Decimal.min(reservationConsumedQty, cover);
    } else if (baseQty.greaterThan(unreserved)) {
      throw new InvariantViolation(
        ERR.INSUFFICIENT_UNRESERVED_STOCK,
        'Movement quantity exceeds unreserved stock at the source location',
        {
          locationId: input.source.id,
          requestedQty: baseQty.toFixed(),
          onHandQty: onHand.toFixed(),
          reservedQty: reserved.toFixed(),
          availableQty: unreserved.toFixed(),
        },
      );
    }
  }

  const deltas: BalanceDelta[] = [
    {
      locationId: input.source.id,
      onHandDelta: baseQty.negated(),
      reservedDelta: reservationConsumedQty.negated(),
    },
    {
      locationId: input.destination.id,
      onHandDelta: baseQty,
      reservedDelta: new Decimal(0),
    },
  ];

  return {
    movementType: input.movementType,
    baseQty,
    deltas,
    reservationConsumedQty: qty(reservationConsumedQty),
  };
}

/**
 * The ledger integrity invariant: for one material, the signed sum of every
 * balance across every location (including the virtual counter-accounts) is
 * exactly zero. Used by the reconciliation job and by tests.
 */
export function assertLedgerBalanced(
  balances: readonly { readonly locationId: string; readonly onHandQty: DecimalLike }[],
  context: Record<string, unknown> = {},
): void {
  const total = balances.reduce<Decimal>((acc, b) => acc.plus(dec(b.onHandQty)), new Decimal(0));
  if (!qty(total).isZero()) {
    throw new InvariantViolation(
      ERR.LEDGER_NOT_BALANCED,
      'Ledger is not balanced: signed balances across all locations must sum to zero',
      { ...context, total: qty(total).toFixed(), locationCount: balances.length },
    );
  }
}

/** Net quantity the organisation owns: owned location kinds only. */
export function ownedQuantity(
  balances: readonly { readonly kind: LocationKind; readonly onHandQty: DecimalLike }[],
): Decimal {
  return qty(
    balances
      .filter((b) => isOwned(b.kind))
      .reduce<Decimal>((acc, b) => acc.plus(dec(b.onHandQty)), new Decimal(0)),
  );
}
