import { describe, expect, it } from 'vitest';
import { ConfigurationError, IllegalStateError, InvariantViolation } from '../errors';
import {
  assertPushTransition, assertPushableNow, classifyPushOutcome, eligiblePushQty,
  previewPush, reconcile, resolvePushOperation, type FacilityTarget, type PushCandidate,
} from './push';

const facility: FacilityTarget = {
  id: 'f1', externalCode: 'THE_DHAN_MILL', displayName: 'The Dhan Mill', isPushEnabled: true,
};

const candidate = (over: Partial<PushCandidate> = {}): PushCandidate => ({
  finishedInwardLineId: 'l1', productVariantId: 'v1', inwardNo: 'FGI-000001',
  acceptedQty: '50', pushedQty: '0', externalSku: 'DD-KRT-001-M',
  ...over,
});

describe('push eligibility', () => {
  it('counts only the quantity not already accepted externally', () => {
    expect(eligiblePushQty(candidate()).toFixed()).toBe('50');
    expect(eligiblePushQty(candidate({ pushedQty: '30' })).toFixed()).toBe('20');
    expect(eligiblePushQty(candidate({ pushedQty: '50' })).toFixed()).toBe('0');
  });

  it('prevents a repeated push from double-crediting inventory', () => {
    const fullyPushed = candidate({ pushedQty: '50' });
    const preview = previewPush({
      candidates: [fullyPushed], facility, operationKind: 'INVENTORY_ADJUSTMENT', externalWritesEnabled: true,
    });
    expect(preview.lines).toHaveLength(0);
    expect(preview.blockedLines[0]!.code).toBe('NOTHING_ELIGIBLE');
    expect(() => assertPushableNow(fullyPushed, '50')).toThrow(InvariantViolation);
  });

  it('allows a partial push and then only the remainder', () => {
    expect(() => assertPushableNow(candidate(), '30')).not.toThrow();
    expect(() => assertPushableNow(candidate({ pushedQty: '30' }), '20')).not.toThrow();
    expect(() => assertPushableNow(candidate({ pushedQty: '30' }), '21')).toThrow(/exceeds the quantity still eligible/);
  });
});

describe('previewPush - mapping and facility guards', () => {
  it('blocks a line whose SKU has no external mapping', () => {
    const preview = previewPush({
      candidates: [candidate({ externalSku: null })], facility,
      operationKind: 'INVENTORY_ADJUSTMENT', externalWritesEnabled: true,
    });
    expect(preview.lines).toHaveLength(0);
    expect(preview.blockedLines[0]!.code).toBe('SKU_NOT_MAPPED');
  });

  it('refuses to push to a facility that has not been approved', () => {
    expect(() => previewPush({
      candidates: [candidate()], facility: { ...facility, isPushEnabled: false },
      operationKind: 'INVENTORY_ADJUSTMENT', externalWritesEnabled: true,
    })).toThrow(ConfigurationError);
  });

  it('refuses any external write when the environment forbids it', () => {
    expect(() => previewPush({
      candidates: [candidate()], facility,
      operationKind: 'INVENTORY_ADJUSTMENT', externalWritesEnabled: false,
    })).toThrow(/External inventory writes are disabled/);
  });

  it('flags a changed destination facility for approval', () => {
    const preview = previewPush({
      candidates: [candidate()], facility, operationKind: 'INVENTORY_ADJUSTMENT',
      originalFacilityId: 'f-other', externalWritesEnabled: true,
    });
    expect(preview.requiresFacilityChangeApproval).toBe(true);
  });

  it('does not flag approval when the facility is unchanged', () => {
    const preview = previewPush({
      candidates: [candidate()], facility, operationKind: 'INVENTORY_ADJUSTMENT',
      originalFacilityId: 'f1', externalWritesEnabled: true,
    });
    expect(preview.requiresFacilityChangeApproval).toBe(false);
    expect(preview.totalQty.toFixed()).toBe('50');
  });

  it('blocks a requested quantity above what is eligible', () => {
    const preview = previewPush({
      candidates: [candidate({ pushedQty: '40' })], requestedQtyByLine: { l1: '20' },
      facility, operationKind: 'INVENTORY_ADJUSTMENT', externalWritesEnabled: true,
    });
    expect(preview.blockedLines[0]!.code).toBe('PUSH_EXCEEDS_ACCEPTED');
  });
});

describe('interpreting the external response', () => {
  it('does not treat HTTP 200 as success', () => {
    const r = classifyPushOutcome({ httpStatus: 200, businessSuccess: false, errorMessage: 'SKU not found in facility' });
    expect(r.status).toBe('FAILED');
    expect(r.reason).toBe('SKU not found in facility');
  });

  it('accepts only an explicit business-level success', () => {
    expect(classifyPushOutcome({ httpStatus: 200, businessSuccess: true }).status).toBe('SUCCESS');
  });

  it('does not treat a timeout as a failure', () => {
    const r = classifyPushOutcome({ transportUncertain: true });
    expect(r.status).toBe('RECONCILIATION_REQUIRED');
    expect(r.reason).toMatch(/may or may not have been credited/);
  });

  it('treats an uninterpretable response as uncertain, not successful', () => {
    expect(classifyPushOutcome({ httpStatus: 200 }).status).toBe('RECONCILIATION_REQUIRED');
  });
});

describe('push job state machine', () => {
  it('will not retry an uncertain posting without reconciling first', () => {
    expect(() => assertPushTransition('RECONCILIATION_REQUIRED', 'PENDING')).toThrow(IllegalStateError);
    expect(() => assertPushTransition('RECONCILIATION_REQUIRED', 'READY')).toThrow(IllegalStateError);
    // The only way out is through reconciliation.
    expect(() => assertPushTransition('RECONCILIATION_REQUIRED', 'RECONCILED')).not.toThrow();
    expect(() => assertPushTransition('RECONCILED', 'READY')).not.toThrow();
  });

  it('allows a definite failure to be retried directly', () => {
    expect(() => assertPushTransition('FAILED', 'READY')).not.toThrow();
  });

  it('treats a successful push as terminal', () => {
    expect(() => assertPushTransition('SUCCESS', 'READY')).toThrow(IllegalStateError);
  });
});

describe('reconciliation after an uncertain posting', () => {
  it('marks matched quantities reconciled', () => {
    const v = reconcile({ erpQty: '50', externalQty: '50' });
    expect(v.isMatched).toBe(true);
    expect(v.recommendation).toBe('MARK_RECONCILED');
  });

  it('asks for the shortfall to be retried when the posting never landed', () => {
    const v = reconcile({ erpQty: '50', externalQty: '0' });
    expect(v.varianceQty.toFixed()).toBe('-50');
    expect(v.recommendation).toBe('RETRY_SHORTFALL');
  });

  it('raises an overage for investigation instead of silently correcting it', () => {
    const v = reconcile({ erpQty: '50', externalQty: '100' });
    expect(v.varianceQty.toFixed()).toBe('50');
    expect(v.recommendation).toBe('INVESTIGATE_OVERAGE');
  });
});

describe('choosing the external operation', () => {
  it('uses PO receiving when the inward is linked to an external PO', () => {
    expect(resolvePushOperation({ hasExternalPurchaseOrder: true })).toBe('GRN_AGAINST_PURCHASE_ORDER');
  });

  it('refuses to substitute a stock adjustment for PO receiving', () => {
    expect(() => resolvePushOperation({
      hasExternalPurchaseOrder: true, requestedKind: 'INVENTORY_ADJUSTMENT',
    })).toThrow(/must be received through the PO\/GRN workflow/);
  });

  it('allows an adjustment for stock with no external PO', () => {
    expect(resolvePushOperation({ hasExternalPurchaseOrder: false })).toBe('INVENTORY_ADJUSTMENT');
  });

  it('requires an approval to overwrite external inventory', () => {
    expect(() => resolvePushOperation({
      hasExternalPurchaseOrder: false, requestedKind: 'INVENTORY_OVERRIDE',
    })).toThrow(/requires an explicit approval/);
    expect(resolvePushOperation({
      hasExternalPurchaseOrder: false, requestedKind: 'INVENTORY_OVERRIDE', adjustmentApprovedByUserId: 'u1',
    })).toBe('INVENTORY_OVERRIDE');
  });
});
