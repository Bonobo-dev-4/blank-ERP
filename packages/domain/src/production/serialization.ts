import { Decimal, qty, type DecimalLike } from '../decimal';
import { ERR, InvariantViolation, ValidationError } from '../errors';
import { buildUnitCode } from './barcode';

export interface SerialisationPlanInput {
  readonly moNo: string;
  readonly batchSequence: number;
  readonly batchId: string;
  /** Units already serialised for this batch. */
  readonly existingUnitCount: number;
  /** Quantity eligible to be serialised (normally completed at the cutting step). */
  readonly eligibleQty: DecimalLike;
  readonly requestedCount: number;
}

export interface PlannedUnit {
  readonly serialNo: string;
  readonly barcode: string;
  readonly unitSequence: number;
}

/**
 * Turn a quantity-tracked batch into individually serialised garments.
 *
 * Serialisation is where "a batch of 100" becomes 100 identifiable things. The
 * count is bounded by the eligible quantity so a batch can never produce more
 * serials than garments - which is the failure the specification warns about:
 * a batch of 100 must not be representable as one finished unit, and one batch
 * scan must not be counted as 100 completed garments.
 */
export function planSerialisation(input: SerialisationPlanInput): PlannedUnit[] {
  if (!Number.isInteger(input.requestedCount) || input.requestedCount < 1) {
    throw new ValidationError('INVALID_UNIT_COUNT', 'Requested unit count must be a positive integer', {
      requestedCount: input.requestedCount,
    });
  }
  const eligible = qty(input.eligibleQty);
  const total = new Decimal(input.existingUnitCount).plus(input.requestedCount);
  if (total.greaterThan(eligible)) {
    throw new InvariantViolation(
      'SERIALISATION_EXCEEDS_ELIGIBLE',
      'Serialising this many units would exceed the quantity eligible for serialisation',
      {
        batchId: input.batchId,
        existingUnitCount: input.existingUnitCount,
        requestedCount: input.requestedCount,
        eligibleQty: eligible.toFixed(),
      },
    );
  }

  const units: PlannedUnit[] = [];
  for (let i = 1; i <= input.requestedCount; i += 1) {
    const seq = input.existingUnitCount + i;
    const barcode = buildUnitCode(input.moNo, input.batchSequence, seq);
    units.push({ serialNo: barcode, barcode, unitSequence: seq });
  }
  return units;
}

export interface BatchSplitPlan {
  readonly parentBatchId: string;
  readonly childQuantities: readonly Decimal[];
}

/**
 * Split a batch so several operators or job workers can work in parallel.
 * The children must account for exactly the parent quantity - splitting is a
 * partition, never a way to create or lose garments.
 */
export function planBatchSplit(
  parentBatchId: string,
  parentQty: DecimalLike,
  childQuantities: readonly DecimalLike[],
): BatchSplitPlan {
  if (childQuantities.length < 2) {
    throw new ValidationError('INVALID_SPLIT', 'A split must produce at least two batches', {
      parentBatchId, childCount: childQuantities.length,
    });
  }
  const children = childQuantities.map((q) => qty(q));
  if (children.some((c) => c.lessThanOrEqualTo(0))) {
    throw new ValidationError(ERR.NON_POSITIVE_QTY, 'Every split quantity must be greater than zero', {
      parentBatchId, childQuantities: children.map((c) => c.toFixed()),
    });
  }
  const total = children.reduce<Decimal>((a, c) => a.plus(c), new Decimal(0));
  const parent = qty(parentQty);
  if (!qty(total).equals(parent)) {
    throw new InvariantViolation(
      'SPLIT_QUANTITY_MISMATCH',
      'Split quantities must add up to exactly the parent batch quantity',
      { parentBatchId, parentQty: parent.toFixed(), splitTotal: qty(total).toFixed() },
    );
  }
  return { parentBatchId, childQuantities: children };
}
