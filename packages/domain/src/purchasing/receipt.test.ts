import { describe, expect, it } from 'vitest';
import { InvariantViolation, ValidationError } from '../errors';
import {
  assertInspectionSplit, assertReceivable, assessPoClosure, landedUnitCost,
  maxReceivableQty, newWeightedAverageCost, pendingReceiptQty, type PurchaseLineState,
} from './receipt';

const line = (over: Partial<PurchaseLineState> = {}): PurchaseLineState => ({
  id: 'pi1', lineNo: 1, rawMaterialId: 'fab',
  orderedBaseQty: '500', receivedBaseQty: '0', acceptedBaseQty: '0', rejectedBaseQty: '0',
  ...over,
});

const noTol = { overReceiptTolerancePct: '0', underReceiptTolerancePct: '0' };

describe('partial delivery - the specification example', () => {
  it('receives 300 of 500 and leaves 200 outstanding', () => {
    expect(() => assertReceivable(line(), '300', noTol)).not.toThrow();
    expect(pendingReceiptQty(line({ receivedBaseQty: '300' })).toFixed()).toBe('200');
  });

  it('does not close the purchase order while quantity is outstanding', () => {
    const a = assessPoClosure([line({ receivedBaseQty: '300' })], noTol);
    expect(a.status).toBe('PARTIALLY_RECEIVED');
    expect(a.canAutoClose).toBe(false);
    expect(a.openLineCount).toBe(1);
  });

  it('closes once the remaining 200 arrives', () => {
    const a = assessPoClosure([line({ receivedBaseQty: '500' })], noTol);
    expect(a.status).toBe('RECEIVED');
    expect(a.canAutoClose).toBe(true);
  });

  it('stays open when one line of several is short', () => {
    const a = assessPoClosure([
      line({ id: 'a', receivedBaseQty: '500' }),
      line({ id: 'b', lineNo: 2, orderedBaseQty: '100', receivedBaseQty: '60' }),
    ], noTol);
    expect(a.status).toBe('PARTIALLY_RECEIVED');
    expect(a.fullyReceivedLineCount).toBe(1);
  });

  it('is still APPROVED when nothing has arrived', () => {
    expect(assessPoClosure([line()], noTol).status).toBe('APPROVED');
  });
});

describe('receipt tolerance', () => {
  const tol = { overReceiptTolerancePct: '2', underReceiptTolerancePct: '1' };

  it('permits over-receipt up to the agreed tolerance', () => {
    expect(maxReceivableQty(line(), tol).toFixed()).toBe('510');
    expect(() => assertReceivable(line(), '510', tol)).not.toThrow();
    expect(() => assertReceivable(line(), '511', tol)).toThrow(InvariantViolation);
  });

  it('counts cumulative receipts against the ceiling', () => {
    expect(() => assertReceivable(line({ receivedBaseQty: '500' }), '11', tol)).toThrow(/over-receipt tolerance/);
    expect(() => assertReceivable(line({ receivedBaseQty: '500' }), '10', tol)).not.toThrow();
  });

  it('treats a delivery inside the under-receipt tolerance as complete', () => {
    // 1% under tolerance on 500 means 495 counts as fully delivered.
    expect(assessPoClosure([line({ receivedBaseQty: '495' })], tol).status).toBe('RECEIVED');
    expect(assessPoClosure([line({ receivedBaseQty: '494' })], tol).status).toBe('PARTIALLY_RECEIVED');
  });

  it('rejects a non-positive receipt', () => {
    expect(() => assertReceivable(line(), '0', noTol)).toThrow(ValidationError);
  });
});

describe('inspection split', () => {
  it('requires accepted plus rejected to equal what was received', () => {
    expect(() => assertInspectionSplit({ receivedBaseQty: '300', acceptedBaseQty: '280', rejectedBaseQty: '20' })).not.toThrow();
    expect(() => assertInspectionSplit({ receivedBaseQty: '300', acceptedBaseQty: '280', rejectedBaseQty: '10' })).toThrow(InvariantViolation);
    expect(() => assertInspectionSplit({ receivedBaseQty: '300', acceptedBaseQty: '300', rejectedBaseQty: '20' })).toThrow(InvariantViolation);
  });

  it('rejects negative quantities', () => {
    expect(() => assertInspectionSplit({ receivedBaseQty: '300', acceptedBaseQty: '310', rejectedBaseQty: '-10' })).toThrow(ValidationError);
  });
});

describe('costing on inward', () => {
  it('computes a weighted average cost in decimal', () => {
    // 100 m at 200 plus 300 m at 240 = 48,000 / 400 = 230
    expect(newWeightedAverageCost({
      existingQty: '100', existingAvgCost: '200', incomingQty: '300', incomingUnitCost: '240',
    }).toFixed()).toBe('230');
  });

  it('adopts the incoming cost when there is no existing stock', () => {
    expect(newWeightedAverageCost({
      existingQty: '0', existingAvgCost: '0', incomingQty: '100', incomingUnitCost: '245.5',
    }).toFixed()).toBe('245.5');
  });

  it('apportions freight by line value', () => {
    // Line is 300 m at 200 = 60,000 of a 100,000 receipt carrying 5,000 freight.
    // Share = 3,000, over 300 m = 10/m, so landed cost is 210.
    expect(landedUnitCost({
      lineQty: '300', lineRate: '200', freightAmount: '5000', receiptTotalValue: '100000',
    }).toFixed()).toBe('210');
  });

  it('falls back to the line rate when there is no freight', () => {
    expect(landedUnitCost({ lineQty: '300', lineRate: '200' }).toFixed()).toBe('200');
  });
});
