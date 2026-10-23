import { Decimal, clampNonNegative, qty, type DecimalLike } from '../decimal';
import { ERR, InvariantViolation, ValidationError } from '../errors';

export const INSPECTION_RESULTS = ['PASS', 'FAIL', 'REWORK', 'HOLD'] as const;
export type InspectionResult = (typeof INSPECTION_RESULTS)[number];

export const DEFECT_CATEGORIES = [
  'STITCHING',
  'EMBROIDERY',
  'FABRIC',
  'COLOR_VARIATION',
  'MEASUREMENT',
  'FINISHING',
  'DAMAGE',
  'OTHER',
] as const;
export type DefectCategory = (typeof DEFECT_CATEGORIES)[number];

export interface QcVerdict {
  readonly inspectedQty: DecimalLike;
  readonly passedQty?: DecimalLike;
  readonly failedQty?: DecimalLike;
  readonly reworkQty?: DecimalLike;
  readonly holdQty?: DecimalLike;
}

export interface QcVerdictPlan {
  readonly inspectedQty: Decimal;
  readonly passedQty: Decimal;
  readonly failedQty: Decimal;
  readonly reworkQty: Decimal;
  readonly holdQty: Decimal;
  readonly result: InspectionResult;
  /** Quantity that may now enter sellable finished goods. */
  readonly sellableQty: Decimal;
}

/**
 * Validate a QC verdict and derive the headline result.
 *
 * The split must account for exactly the inspected quantity: an inspector who
 * checks 50 garments must say what happened to all 50. Allowing the split to
 * fall short would silently strand quantity in a state nothing reports on.
 *
 * Only `passedQty` becomes sellable. FAIL, REWORK and HOLD quantities stay out
 * of finished goods entirely, which is how "rejected units cannot become
 * sellable inventory" is enforced at the arithmetic level.
 */
export function planQcVerdict(verdict: QcVerdict): QcVerdictPlan {
  const inspected = qty(verdict.inspectedQty);
  if (inspected.lessThanOrEqualTo(0)) {
    throw new ValidationError(ERR.NON_POSITIVE_QTY, 'Inspected quantity must be greater than zero', {
      inspectedQty: inspected.toFixed(),
    });
  }
  const passed = qty(verdict.passedQty ?? 0);
  const failed = qty(verdict.failedQty ?? 0);
  const rework = qty(verdict.reworkQty ?? 0);
  const hold = qty(verdict.holdQty ?? 0);

  for (const [name, v] of [['passedQty', passed], ['failedQty', failed], ['reworkQty', rework], ['holdQty', hold]] as const) {
    if (v.lessThan(0)) {
      throw new ValidationError(ERR.NON_POSITIVE_QTY, `${name} cannot be negative`, { [name]: v.toFixed() });
    }
  }

  const total = passed.plus(failed).plus(rework).plus(hold);
  if (!qty(total).equals(inspected)) {
    throw new InvariantViolation(
      ERR.QC_SPLIT_MISMATCH,
      'Pass, fail, rework and hold quantities must add up to exactly the inspected quantity',
      {
        inspectedQty: inspected.toFixed(),
        submittedTotal: qty(total).toFixed(),
        passedQty: passed.toFixed(),
        failedQty: failed.toFixed(),
        reworkQty: rework.toFixed(),
        holdQty: hold.toFixed(),
      },
    );
  }

  let result: InspectionResult;
  if (passed.equals(inspected)) result = 'PASS';
  else if (failed.equals(inspected)) result = 'FAIL';
  else if (hold.greaterThan(0) && passed.isZero() && failed.isZero() && rework.isZero()) result = 'HOLD';
  else if (rework.greaterThan(0)) result = 'REWORK';
  else result = 'FAIL';

  return { inspectedQty: inspected, passedQty: passed, failedQty: failed, reworkQty: rework, holdQty: hold, result, sellableQty: passed };
}

/** Defect quantities may not exceed the quantity that actually failed. */
export function assertDefectsConsistent(
  plan: QcVerdictPlan,
  defects: readonly { readonly category: DefectCategory; readonly qty: DecimalLike }[],
): void {
  const notPassed = plan.failedQty.plus(plan.reworkQty).plus(plan.holdQty);
  const defectTotal = defects.reduce<Decimal>((a, d) => a.plus(qty(d.qty)), new Decimal(0));
  // One garment can carry several defects, so the total may exceed the garment
  // count; what it may not do is exist with nothing having failed.
  if (qty(defectTotal).greaterThan(0) && notPassed.lessThanOrEqualTo(0)) {
    throw new InvariantViolation(
      ERR.QC_SPLIT_MISMATCH,
      'Defects were recorded but no quantity was failed, reworked or held',
      { defectTotal: qty(defectTotal).toFixed(), notPassedQty: notPassed.toFixed() },
    );
  }
}

export interface BatchQcPosition {
  readonly finishedQty: DecimalLike;
  readonly qcPassedQty: DecimalLike;
  readonly inwardedQty: DecimalLike;
}

/** Quantity that has finished production but has not yet been inspected. */
export function pendingQcQty(p: BatchQcPosition): Decimal {
  return clampNonNegative(qty(p.finishedQty).minus(qty(p.qcPassedQty)));
}

/**
 * Guard applied before recording a QC verdict: inspection cannot cover more
 * garments than production has actually finished and left uninspected.
 */
export function assertInspectableQty(p: BatchQcPosition, inspectedQty: DecimalLike): void {
  const want = qty(inspectedQty);
  const pending = pendingQcQty(p);
  if (want.greaterThan(pending)) {
    throw new InvariantViolation(
      ERR.STAGE_OUTCOME_EXCEEDS_RECEIVED,
      'Inspected quantity exceeds the finished quantity awaiting inspection',
      {
        inspectedQty: want.toFixed(),
        pendingQcQty: pending.toFixed(),
        finishedQty: qty(p.finishedQty).toFixed(),
        qcPassedQty: qty(p.qcPassedQty).toFixed(),
      },
    );
  }
}
