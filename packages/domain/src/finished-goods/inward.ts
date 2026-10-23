import { Decimal, clampNonNegative, qty, type DecimalLike } from '../decimal';
import { ERR, InvariantViolation, ValidationError } from '../errors';

export interface InwardEligibility {
  readonly productionBatchId: string;
  readonly batchNo?: string;
  /** Quantity QC has approved on this batch. */
  readonly qcPassedQty: DecimalLike;
  /** Quantity already inwarded from this batch in earlier (partial) inwards. */
  readonly alreadyInwardedQty: DecimalLike;
}

/**
 * Quantity still eligible for finished goods inward.
 *
 * Worked example from the specification: an order of 100 with 90 QC-approved,
 * 50 inwarded on the first pass, leaves 40 eligible - not 50, and not 100.
 */
export function eligibleInwardQty(e: InwardEligibility): Decimal {
  return clampNonNegative(qty(e.qcPassedQty).minus(qty(e.alreadyInwardedQty)));
}

export interface InwardLineRequest {
  readonly productionBatchId: string;
  readonly productVariantId: string;
  readonly acceptedQty: DecimalLike;
  readonly rejectedQty?: DecimalLike;
  readonly unitIds?: readonly string[];
}

export interface InwardLinePlan {
  readonly productionBatchId: string;
  readonly productVariantId: string
  readonly acceptedQty: Decimal;
  readonly rejectedQty: Decimal;
  readonly unitIds: readonly string[];
}

/**
 * Validate one finished goods inward line against the batch's QC position.
 *
 * Partial inward is fully supported; what is refused is inward that exceeds
 * QC-approved-and-not-yet-inwarded quantity. Together with the batch-level
 * `pb_inwarded_within_qc_passed` database constraint, this is what stops a
 * rejected garment reaching sellable stock.
 */
export function planInwardLine(
  request: InwardLineRequest,
  eligibility: InwardEligibility,
): InwardLinePlan {
  const accepted = qty(request.acceptedQty);
  if (accepted.lessThanOrEqualTo(0)) {
    throw new ValidationError(ERR.NON_POSITIVE_QTY, 'Accepted quantity must be greater than zero', {
      productionBatchId: request.productionBatchId, acceptedQty: accepted.toFixed(),
    });
  }
  const eligible = eligibleInwardQty(eligibility);
  if (accepted.greaterThan(eligible)) {
    throw new InvariantViolation(
      ERR.INWARD_EXCEEDS_QC_PASSED,
      'Inward quantity exceeds the QC-approved quantity not yet inwarded',
      {
        productionBatchId: request.productionBatchId,
        batchNo: eligibility.batchNo,
        requestedQty: accepted.toFixed(),
        eligibleQty: eligible.toFixed(),
        qcPassedQty: qty(eligibility.qcPassedQty).toFixed(),
        alreadyInwardedQty: qty(eligibility.alreadyInwardedQty).toFixed(),
      },
    );
  }

  const unitIds = request.unitIds ?? [];
  if (unitIds.length > 0) {
    const unique = new Set(unitIds);
    if (unique.size !== unitIds.length) {
      throw new ValidationError('DUPLICATE_UNIT_IDS', 'The same unit was listed more than once', {
        productionBatchId: request.productionBatchId, unitCount: unitIds.length, uniqueCount: unique.size,
      });
    }
    if (!accepted.equals(new Decimal(unitIds.length))) {
      throw new InvariantViolation(
        'UNIT_COUNT_MISMATCH',
        'For a unit-tracked batch the accepted quantity must equal the number of units listed',
        {
          productionBatchId: request.productionBatchId,
          acceptedQty: accepted.toFixed(),
          unitCount: unitIds.length,
        },
      );
    }
  }

  return {
    productionBatchId: request.productionBatchId,
    productVariantId: request.productVariantId,
    acceptedQty: accepted,
    rejectedQty: qty(request.rejectedQty ?? 0),
    unitIds,
  };
}

/**
 * The finished goods lifecycle states the specification asks to be kept
 * distinct. Conflating any two of these is how double-counting starts.
 */
export interface FinishedGoodsPosition {
  /** Completed the final production stage. */
  readonly producedQty: Decimal;
  /** Approved by final QC. */
  readonly qcPassedQty: Decimal;
  /** Recorded into ERP finished goods stock. */
  readonly inwardedQty: Decimal;
  /** Inwarded but not yet accepted by the external system. */
  readonly pendingExternalSyncQty: Decimal;
  /** Confirmed accepted by the external system's business response. */
  readonly externallyAcceptedQty: Decimal;
  /** Verified against the external system's own inventory figures. */
  readonly reconciledQty: Decimal;
}

export function summariseFinishedGoods(input: {
  readonly producedQty: DecimalLike;
  readonly qcPassedQty: DecimalLike;
  readonly inwardedQty: DecimalLike;
  readonly pushedQty: DecimalLike;
  readonly reconciledQty: DecimalLike;
}): FinishedGoodsPosition {
  const inwarded = qty(input.inwardedQty);
  const pushed = qty(input.pushedQty);
  return {
    producedQty: qty(input.producedQty),
    qcPassedQty: qty(input.qcPassedQty),
    inwardedQty: inwarded,
    pendingExternalSyncQty: clampNonNegative(inwarded.minus(pushed)),
    externallyAcceptedQty: pushed,
    reconciledQty: qty(input.reconciledQty),
  };
}
