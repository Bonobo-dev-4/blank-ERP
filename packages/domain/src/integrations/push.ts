import { Decimal, clampNonNegative, qty, type DecimalLike } from '../decimal';
import { ConfigurationError, ERR, IllegalStateError, InvariantViolation } from '../errors';

export const PUSH_JOB_STATUSES = [
  'DRAFT',
  'READY',
  'PENDING',
  'PROCESSING',
  'SUCCESS',
  'PARTIAL_SUCCESS',
  'FAILED',
  'RECONCILIATION_REQUIRED',
  'RECONCILED',
  'CANCELLED',
] as const;
export type PushJobStatus = (typeof PUSH_JOB_STATUSES)[number];

export const PUSH_OPERATION_KINDS = [
  'GRN_AGAINST_PURCHASE_ORDER',
  'INVENTORY_ADJUSTMENT',
  'INVENTORY_OVERRIDE',
] as const;
export type PushOperationKind = (typeof PUSH_OPERATION_KINDS)[number];

/**
 * Legal push job transitions.
 *
 * Note what is deliberately absent: there is no edge from
 * RECONCILIATION_REQUIRED straight back to PENDING. An uncertain outcome - the
 * API timed out after the request may already have landed - can only leave
 * that state through RECONCILED, after something has actually read the
 * external system's inventory. Retrying blind is exactly how inventory gets
 * credited twice.
 */
export const PUSH_TRANSITIONS: Readonly<Record<PushJobStatus, readonly PushJobStatus[]>> = {
  DRAFT: ['READY', 'CANCELLED'],
  READY: ['PENDING', 'DRAFT', 'CANCELLED'],
  PENDING: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'RECONCILIATION_REQUIRED'],
  PARTIAL_SUCCESS: ['RECONCILIATION_REQUIRED', 'RECONCILED'],
  FAILED: ['READY', 'CANCELLED', 'RECONCILIATION_REQUIRED'],
  RECONCILIATION_REQUIRED: ['RECONCILED'],
  RECONCILED: ['READY'],
  SUCCESS: [],
  CANCELLED: [],
};

export function assertPushTransition(from: PushJobStatus, to: PushJobStatus): void {
  const allowed = PUSH_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new IllegalStateError(
      'INVALID_PUSH_TRANSITION',
      `A push job cannot move from ${from} to ${to}`,
      { from, to, allowed },
    );
  }
}

export interface PushCandidate {
  readonly finishedInwardLineId: string;
  readonly productVariantId: string;
  readonly inwardNo?: string;
  readonly acceptedQty: DecimalLike;
  /** Quantity of this line already accepted by the external system. */
  readonly pushedQty: DecimalLike;
  /** Resolved external SKU; null means the mapping is missing. */
  readonly externalSku?: string | null;
}

export interface FacilityTarget {
  readonly id: string;
  readonly externalCode: string;
  readonly displayName: string;
  readonly isPushEnabled: boolean;
}

/** Quantity of an inward line still eligible to be pushed externally. */
export function eligiblePushQty(c: PushCandidate): Decimal {
  return clampNonNegative(qty(c.acceptedQty).minus(qty(c.pushedQty)));
}

export interface PushLinePlan {
  readonly finishedInwardLineId: string;
  readonly productVariantId: string;
  readonly externalSku: string;
  readonly qty: Decimal;
}

export interface BlockedPushLine {
  readonly finishedInwardLineId: string;
  readonly code: string;
  readonly message: string;
}

export interface PushPreview {
  readonly facility: FacilityTarget;
  readonly operationKind: PushOperationKind;
  readonly lines: readonly PushLinePlan[];
  readonly totalQty: Decimal;
  readonly blockedLines: readonly BlockedPushLine[];
  readonly requiresFacilityChangeApproval: boolean;
}

export interface PushPreviewInput {
  readonly candidates: readonly PushCandidate[];
  readonly requestedQtyByLine?: Readonly<Record<string, DecimalLike>>;
  readonly facility: FacilityTarget;
  readonly operationKind: PushOperationKind;
  /** The facility the inward records were originally destined for. */
  readonly originalFacilityId?: string | null;
  readonly externalWritesEnabled: boolean;
}

/**
 * Build the preview an operator confirms before anything is sent externally.
 *
 * Everything that could go wrong is surfaced here rather than at submit time:
 * unmapped SKUs, a facility that has not been approved for pushes, quantities
 * that exceed what is still eligible, and a destination that differs from the
 * one the inward was raised against.
 */
export function previewPush(input: PushPreviewInput): PushPreview {
  if (!input.externalWritesEnabled) {
    throw new ConfigurationError(
      ERR.EXTERNAL_WRITES_DISABLED,
      'External inventory writes are disabled for this environment',
      {},
    );
  }
  if (!input.facility.isPushEnabled) {
    throw new ConfigurationError(
      ERR.FACILITY_PUSH_DISABLED,
      `Facility ${input.facility.displayName} is not approved for inventory pushes`,
      { facilityId: input.facility.id, externalCode: input.facility.externalCode },
    );
  }

  const lines: PushLinePlan[] = [];
  const blocked: BlockedPushLine[] = [];

  for (const c of input.candidates) {
    const eligible = eligiblePushQty(c);
    const requested = input.requestedQtyByLine?.[c.finishedInwardLineId];
    const want = requested != null ? qty(requested) : eligible;

    if (!c.externalSku) {
      blocked.push({
        finishedInwardLineId: c.finishedInwardLineId,
        code: ERR.SKU_NOT_MAPPED,
        message: 'This SKU has no external mapping; map it before pushing inventory',
      });
      continue;
    }
    if (want.lessThanOrEqualTo(0)) {
      blocked.push({
        finishedInwardLineId: c.finishedInwardLineId,
        code: 'NOTHING_ELIGIBLE',
        message: 'This inward line has already been fully pushed',
      });
      continue;
    }
    if (want.greaterThan(eligible)) {
      blocked.push({
        finishedInwardLineId: c.finishedInwardLineId,
        code: ERR.PUSH_EXCEEDS_ACCEPTED,
        message: `Requested ${want.toFixed()} exceeds the ${eligible.toFixed()} still eligible on this line`,
      });
      continue;
    }
    lines.push({
      finishedInwardLineId: c.finishedInwardLineId,
      productVariantId: c.productVariantId,
      externalSku: c.externalSku,
      qty: want,
    });
  }

  const total = lines.reduce<Decimal>((a, l) => a.plus(l.qty), new Decimal(0));
  const facilityChanged =
    input.originalFacilityId != null && input.originalFacilityId !== input.facility.id;

  return {
    facility: input.facility,
    operationKind: input.operationKind,
    lines,
    totalQty: qty(total),
    blockedLines: blocked,
    requiresFacilityChangeApproval: facilityChanged,
  };
}

/**
 * Final guard immediately before the external call, inside the transaction
 * that locks the inward lines. Re-checks the quantity ceiling because the
 * preview may be minutes old and another operator may have pushed in between.
 */
export function assertPushableNow(c: PushCandidate, requestedQty: DecimalLike): void {
  const want = qty(requestedQty);
  const eligible = eligiblePushQty(c);
  if (want.greaterThan(eligible)) {
    throw new InvariantViolation(
      ERR.PUSH_EXCEEDS_ACCEPTED,
      'Push quantity exceeds the quantity still eligible on this inward line',
      {
        finishedInwardLineId: c.finishedInwardLineId,
        requestedQty: want.toFixed(),
        eligibleQty: eligible.toFixed(),
        acceptedQty: qty(c.acceptedQty).toFixed(),
        pushedQty: qty(c.pushedQty).toFixed(),
      },
    );
  }
}

export interface ExternalCallOutcome {
  readonly httpStatus?: number | null;
  /** Parsed from the response BODY, not inferred from the status code. */
  readonly businessSuccess?: boolean | null;
  readonly externalReference?: string | null;
  readonly errorCode?: string | null;
  readonly errorMessage?: string | null;
  /** True for a timeout, aborted socket, or any ambiguous transport failure. */
  readonly transportUncertain?: boolean;
}

/**
 * Interpret an external response.
 *
 * Two rules the specification is emphatic about, both encoded here:
 *
 *  - HTTP 200 is not success. Enterprise APIs commonly return 200 with a
 *    `successful: false` body and an error list. Only an explicitly parsed
 *    business-level success counts.
 *  - A timeout is not a failure. The request may well have been applied. That
 *    outcome goes to RECONCILIATION_REQUIRED, and the only way out is to read
 *    the external inventory and compare.
 */
export function classifyPushOutcome(outcome: ExternalCallOutcome): {
  readonly status: PushJobStatus;
  readonly reason: string;
} {
  if (outcome.transportUncertain) {
    return {
      status: 'RECONCILIATION_REQUIRED',
      reason:
        'The call did not return a definite outcome; the quantity may or may not have been credited externally. Reconcile against external inventory before any retry.',
    };
  }
  if (outcome.businessSuccess === true) {
    return { status: 'SUCCESS', reason: 'External system confirmed the posting at business level' };
  }
  if (outcome.businessSuccess === false) {
    return {
      status: 'FAILED',
      reason: outcome.errorMessage ?? 'External system rejected the posting',
    };
  }
  return {
    status: 'RECONCILIATION_REQUIRED',
    reason:
      'The response could not be interpreted as a business-level success or failure; reconcile before retrying',
  };
}

export interface ReconciliationVerdict {
  readonly varianceQty: Decimal;
  readonly isMatched: boolean;
  readonly recommendation: 'MARK_RECONCILED' | 'RETRY_SHORTFALL' | 'INVESTIGATE_OVERAGE';
}

/**
 * Compare ERP and external quantities after an uncertain push.
 *
 * An overage is never "fixed" automatically: it means inventory was credited
 * more than once, and silently adjusting it down would hide a real integration
 * defect. It is raised for investigation instead.
 */
export function reconcile(input: {
  readonly erpQty: DecimalLike;
  readonly externalQty: DecimalLike;
}): ReconciliationVerdict {
  const erp = qty(input.erpQty);
  const ext = qty(input.externalQty);
  const variance = qty(ext.minus(erp));
  if (variance.isZero()) {
    return { varianceQty: variance, isMatched: true, recommendation: 'MARK_RECONCILED' };
  }
  return {
    varianceQty: variance,
    isMatched: false,
    recommendation: variance.lessThan(0) ? 'RETRY_SHORTFALL' : 'INVESTIGATE_OVERAGE',
  };
}

/**
 * Choose the external operation for an inward.
 *
 * The specification is explicit that a stock adjustment must not stand in for
 * proper purchase-order receiving. So the decision is driven by whether the
 * inward is linked to an external purchase order, and an adjustment against a
 * PO-linked inward is refused rather than quietly substituted.
 */
export function resolvePushOperation(input: {
  readonly hasExternalPurchaseOrder: boolean;
  readonly requestedKind?: PushOperationKind | null;
  readonly adjustmentApprovedByUserId?: string | null;
}): PushOperationKind {
  if (input.hasExternalPurchaseOrder) {
    if (input.requestedKind && input.requestedKind !== 'GRN_AGAINST_PURCHASE_ORDER') {
      throw new IllegalStateError(
        'PO_RECEIVING_REQUIRED',
        'This inward is linked to an external purchase order and must be received through the PO/GRN workflow, not an inventory adjustment',
        { requestedKind: input.requestedKind },
      );
    }
    return 'GRN_AGAINST_PURCHASE_ORDER';
  }
  const kind = input.requestedKind ?? 'INVENTORY_ADJUSTMENT';
  if (kind === 'INVENTORY_OVERRIDE' && !input.adjustmentApprovedByUserId) {
    throw new IllegalStateError(
      'OVERRIDE_REQUIRES_APPROVAL',
      'Overwriting external inventory requires an explicit approval',
      {},
    );
  }
  return kind;
}
