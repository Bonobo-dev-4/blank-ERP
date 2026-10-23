import { Decimal, amount, clampNonNegative, qty, rate, type DecimalLike } from '../decimal';
import { ERR, InvariantViolation, ValidationError } from '../errors';

export const PURCHASE_ORDER_STATUSES = [
  'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED',
  'RECEIVED', 'CLOSED', 'CANCELLED',
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export interface PurchaseLineState {
  readonly id: string;
  readonly lineNo: number;
  readonly rawMaterialId: string;
  readonly orderedBaseQty: DecimalLike;
  readonly receivedBaseQty: DecimalLike;
  readonly acceptedBaseQty: DecimalLike;
  readonly rejectedBaseQty: DecimalLike;
}

export interface ReceiptTolerance {
  /** Percentage above the ordered quantity a receipt may exceed. */
  readonly overReceiptTolerancePct: DecimalLike;
  /** Percentage below ordered that still counts as fully delivered. */
  readonly underReceiptTolerancePct: DecimalLike;
}

/** Quantity still outstanding on a purchase line. */
export function pendingReceiptQty(line: PurchaseLineState): Decimal {
  return clampNonNegative(qty(line.orderedBaseQty).minus(qty(line.receivedBaseQty)));
}

/** Maximum quantity that may ever be received against a line. */
export function maxReceivableQty(line: PurchaseLineState, tol: ReceiptTolerance): Decimal {
  const ordered = qty(line.orderedBaseQty);
  const over = qty(tol.overReceiptTolerancePct);
  return qty(ordered.plus(ordered.times(over).dividedBy(100)));
}

/**
 * Validate a receipt quantity against the purchase line and its tolerance.
 *
 * Partial delivery is normal and fully supported: the specification's example
 * of 500 m ordered, 300 m received, 200 m remaining needs no special handling.
 * What is bounded is over-receipt, which can only exceed the ordered quantity
 * by the configured tolerance.
 */
export function assertReceivable(
  line: PurchaseLineState,
  receiveBaseQty: DecimalLike,
  tol: ReceiptTolerance,
): void {
  const want = qty(receiveBaseQty);
  if (want.lessThanOrEqualTo(0)) {
    throw new ValidationError(ERR.NON_POSITIVE_QTY, 'Received quantity must be greater than zero', {
      purchaseItemId: line.id, receiveBaseQty: want.toFixed(),
    });
  }
  const alreadyReceived = qty(line.receivedBaseQty);
  const ceiling = maxReceivableQty(line, tol);
  if (alreadyReceived.plus(want).greaterThan(ceiling)) {
    throw new InvariantViolation(
      ERR.RECEIPT_EXCEEDS_TOLERANCE,
      'Receiving this quantity would exceed the ordered quantity plus the agreed over-receipt tolerance',
      {
        purchaseItemId: line.id,
        lineNo: line.lineNo,
        requestedQty: want.toFixed(),
        receivedBaseQty: alreadyReceived.toFixed(),
        orderedBaseQty: qty(line.orderedBaseQty).toFixed(),
        maxReceivableQty: ceiling.toFixed(),
        overReceiptTolerancePct: qty(tol.overReceiptTolerancePct).toFixed(),
      },
    );
  }
}

export interface InspectionSplit {
  readonly receivedBaseQty: DecimalLike;
  readonly acceptedBaseQty: DecimalLike;
  readonly rejectedBaseQty: DecimalLike;
}

/**
 * Inspection splits a received quantity into accepted and rejected. It must
 * account for the whole receipt: material cannot stay in limbo at QC hold with
 * nothing saying what happened to it.
 */
export function assertInspectionSplit(split: InspectionSplit, context: Record<string, unknown> = {}): void {
  const received = qty(split.receivedBaseQty);
  const accepted = qty(split.acceptedBaseQty);
  const rejected = qty(split.rejectedBaseQty);
  if (accepted.lessThan(0) || rejected.lessThan(0)) {
    throw new ValidationError(ERR.NON_POSITIVE_QTY, 'Accepted and rejected quantities cannot be negative', {
      ...context, acceptedBaseQty: accepted.toFixed(), rejectedBaseQty: rejected.toFixed(),
    });
  }
  if (!qty(accepted.plus(rejected)).equals(received)) {
    throw new InvariantViolation(
      ERR.INSPECTION_SPLIT_MISMATCH,
      'Accepted plus rejected quantity must equal the received quantity',
      {
        ...context,
        receivedBaseQty: received.toFixed(),
        acceptedBaseQty: accepted.toFixed(),
        rejectedBaseQty: rejected.toFixed(),
      },
    );
  }
}

export interface PoClosureAssessment {
  readonly status: PurchaseOrderStatus;
  readonly canAutoClose: boolean;
  readonly reason: string;
  readonly fullyReceivedLineCount: number;
  readonly openLineCount: number;
}

/**
 * Decide the status a purchase order should now carry.
 *
 * A PO is NOT closed just because some stock arrived. It reaches RECEIVED only
 * when every line is satisfied within the agreed under-receipt tolerance;
 * short deliveries leave it PARTIALLY_RECEIVED so a buyer has to make an
 * explicit decision to close it short.
 */
export function assessPoClosure(
  lines: readonly PurchaseLineState[],
  tol: ReceiptTolerance,
): PoClosureAssessment {
  if (lines.length === 0) {
    return { status: 'APPROVED', canAutoClose: false, reason: 'Purchase order has no lines', fullyReceivedLineCount: 0, openLineCount: 0 };
  }

  const under = qty(tol.underReceiptTolerancePct);
  let fullyReceived = 0;
  let anyReceived = false;

  for (const line of lines) {
    const ordered = qty(line.orderedBaseQty);
    const received = qty(line.receivedBaseQty);
    if (received.greaterThan(0)) anyReceived = true;
    const minimumAcceptable = qty(ordered.minus(ordered.times(under).dividedBy(100)));
    if (received.greaterThanOrEqualTo(minimumAcceptable)) fullyReceived += 1;
  }

  const openLines = lines.length - fullyReceived;
  if (fullyReceived === lines.length) {
    return {
      status: 'RECEIVED',
      canAutoClose: true,
      reason: 'Every line is satisfied within the agreed under-receipt tolerance',
      fullyReceivedLineCount: fullyReceived,
      openLineCount: 0,
    };
  }
  if (anyReceived) {
    return {
      status: 'PARTIALLY_RECEIVED',
      canAutoClose: false,
      reason: `${openLines} of ${lines.length} lines are still short; closing early requires an explicit decision`,
      fullyReceivedLineCount: fullyReceived,
      openLineCount: openLines,
    };
  }
  return {
    status: 'APPROVED',
    canAutoClose: false,
    reason: 'Nothing has been received yet',
    fullyReceivedLineCount: 0,
    openLineCount: openLines,
  };
}

/**
 * Weighted-average cost after a costed inward.
 *
 * Kept in decimal throughout: averaging in floating point is how a material's
 * cost slowly drifts away from the sum of what was actually paid for it.
 */
export function newWeightedAverageCost(input: {
  readonly existingQty: DecimalLike;
  readonly existingAvgCost: DecimalLike;
  readonly incomingQty: DecimalLike;
  readonly incomingUnitCost: DecimalLike;
}): Decimal {
  const q0 = qty(input.existingQty);
  const c0 = rate(input.existingAvgCost);
  const q1 = qty(input.incomingQty);
  const c1 = rate(input.incomingUnitCost);
  const totalQty = q0.plus(q1);
  if (totalQty.lessThanOrEqualTo(0)) return c1;
  return rate(q0.times(c0).plus(q1.times(c1)).dividedBy(totalQty));
}

/**
 * Landed unit cost: the line rate plus its share of freight, apportioned by
 * value so an expensive fabric carries more of the freight than a bag of
 * buttons shipped alongside it.
 */
export function landedUnitCost(input: {
  readonly lineQty: DecimalLike;
  readonly lineRate: DecimalLike;
  readonly freightAmount?: DecimalLike;
  readonly receiptTotalValue?: DecimalLike;
}): Decimal {
  const q = qty(input.lineQty);
  const r = rate(input.lineRate);
  if (q.lessThanOrEqualTo(0)) return r;
  const freight = amount(input.freightAmount ?? 0);
  const totalValue = amount(input.receiptTotalValue ?? 0);
  if (freight.lessThanOrEqualTo(0) || totalValue.lessThanOrEqualTo(0)) return r;
  const lineValue = q.times(r);
  const share = amount(freight.times(lineValue).dividedBy(totalValue));
  return rate(r.plus(share.dividedBy(q)));
}
