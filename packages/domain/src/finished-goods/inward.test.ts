import { describe, expect, it } from 'vitest';
import { InvariantViolation, ValidationError } from '../errors';
import { eligibleInwardQty, planInwardLine, summariseFinishedGoods } from './inward';

describe('finished goods inward - the specification example', () => {
  // MO of 100, QC approved 90, first inward 50, second inward 40.
  const base = { productionBatchId: 'b1', batchNo: 'BATCH-000001', qcPassedQty: '90' };

  it('offers 90 eligible before any inward', () => {
    expect(eligibleInwardQty({ ...base, alreadyInwardedQty: '0' }).toFixed()).toBe('90');
  });

  it('allows the first partial inward of 50', () => {
    const plan = planInwardLine(
      { productionBatchId: 'b1', productVariantId: 'v1', acceptedQty: '50' },
      { ...base, alreadyInwardedQty: '0' },
    );
    expect(plan.acceptedQty.toFixed()).toBe('50');
  });

  it('then offers 40 eligible, not 50 and not 100', () => {
    expect(eligibleInwardQty({ ...base, alreadyInwardedQty: '50' }).toFixed()).toBe('40');
  });

  it('allows the second inward of exactly 40', () => {
    expect(planInwardLine(
      { productionBatchId: 'b1', productVariantId: 'v1', acceptedQty: '40' },
      { ...base, alreadyInwardedQty: '50' },
    ).acceptedQty.toFixed()).toBe('40');
  });

  it('refuses a third inward once the QC-approved quantity is exhausted', () => {
    expect(() => planInwardLine(
      { productionBatchId: 'b1', productVariantId: 'v1', acceptedQty: '1' },
      { ...base, alreadyInwardedQty: '90' },
    )).toThrow(InvariantViolation);
  });

  it('refuses to inward the 10 garments QC never approved', () => {
    expect(() => planInwardLine(
      { productionBatchId: 'b1', productVariantId: 'v1', acceptedQty: '100' },
      { ...base, alreadyInwardedQty: '0' },
    )).toThrow(/exceeds the QC-approved quantity/);
  });

  it('refuses a non-positive inward', () => {
    expect(() => planInwardLine(
      { productionBatchId: 'b1', productVariantId: 'v1', acceptedQty: '0' },
      { ...base, alreadyInwardedQty: '0' },
    )).toThrow(ValidationError);
  });
});

describe('unit-tracked inward', () => {
  const elig = { productionBatchId: 'b1', qcPassedQty: '10', alreadyInwardedQty: '0' };

  it('requires the unit count to match the accepted quantity', () => {
    expect(() => planInwardLine(
      { productionBatchId: 'b1', productVariantId: 'v1', acceptedQty: '3', unitIds: ['u1', 'u2'] },
      elig,
    )).toThrow(/must equal the number of units/);
  });

  it('rejects the same unit listed twice', () => {
    expect(() => planInwardLine(
      { productionBatchId: 'b1', productVariantId: 'v1', acceptedQty: '2', unitIds: ['u1', 'u1'] },
      elig,
    )).toThrow(/listed more than once/);
  });

  it('accepts a matching set of unique units', () => {
    const plan = planInwardLine(
      { productionBatchId: 'b1', productVariantId: 'v1', acceptedQty: '3', unitIds: ['u1', 'u2', 'u3'] },
      elig,
    );
    expect(plan.unitIds).toEqual(['u1', 'u2', 'u3']);
  });
});

describe('finished goods lifecycle states stay distinct', () => {
  it('separates produced, QC passed, inwarded, pending sync and reconciled', () => {
    const s = summariseFinishedGoods({
      producedQty: '100', qcPassedQty: '90', inwardedQty: '50', pushedQty: '30', reconciledQty: '30',
    });
    expect(s.producedQty.toFixed()).toBe('100');
    expect(s.qcPassedQty.toFixed()).toBe('90');
    expect(s.inwardedQty.toFixed()).toBe('50');
    expect(s.pendingExternalSyncQty.toFixed()).toBe('20');
    expect(s.externallyAcceptedQty.toFixed()).toBe('30');
    expect(s.reconciledQty.toFixed()).toBe('30');
  });
});
