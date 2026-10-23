import { describe, expect, it } from 'vitest';
import { InvariantViolation, ValidationError } from '../errors';
import { assertDefectsConsistent, assertInspectableQty, pendingQcQty, planQcVerdict } from './qc';

describe('planQcVerdict', () => {
  it('accepts a full pass', () => {
    const p = planQcVerdict({ inspectedQty: '50', passedQty: '50' });
    expect(p.result).toBe('PASS');
    expect(p.sellableQty.toFixed()).toBe('50');
  });

  it('handles a partial approval', () => {
    // 60 inspected: 50 pass, 5 fail outright, 5 need rework.
    const p = planQcVerdict({ inspectedQty: '60', passedQty: '50', failedQty: '5', reworkQty: '5' });
    expect(p.result).toBe('REWORK');
    // Only the 50 that passed may become sellable stock.
    expect(p.sellableQty.toFixed()).toBe('50');
  });

  it('insists the verdict accounts for every garment inspected', () => {
    expect(() => planQcVerdict({ inspectedQty: '60', passedQty: '50' })).toThrow(InvariantViolation);
    expect(() => planQcVerdict({ inspectedQty: '60', passedQty: '50' })).toThrow(/add up to exactly/);
    expect(() => planQcVerdict({ inspectedQty: '50', passedQty: '45', failedQty: '10' })).toThrow(InvariantViolation);
  });

  it('classifies a total failure and a pure hold', () => {
    expect(planQcVerdict({ inspectedQty: '20', failedQty: '20' }).result).toBe('FAIL');
    expect(planQcVerdict({ inspectedQty: '20', holdQty: '20' }).result).toBe('HOLD');
  });

  it('never makes failed, reworked or held quantity sellable', () => {
    const p = planQcVerdict({ inspectedQty: '30', failedQty: '10', reworkQty: '10', holdQty: '10' });
    expect(p.sellableQty.toFixed()).toBe('0');
  });

  it('rejects a non-positive inspected quantity and negative splits', () => {
    expect(() => planQcVerdict({ inspectedQty: '0' })).toThrow(ValidationError);
    expect(() => planQcVerdict({ inspectedQty: '10', passedQty: '-1', failedQty: '11' })).toThrow(ValidationError);
  });
});

describe('inspectable quantity', () => {
  const pos = { finishedQty: '90', qcPassedQty: '50', inwardedQty: '40' };

  it('reports what is finished but not yet inspected', () => {
    expect(pendingQcQty(pos).toFixed()).toBe('40');
  });

  it('refuses to inspect more than production has finished', () => {
    expect(() => assertInspectableQty(pos, '41')).toThrow(InvariantViolation);
    expect(() => assertInspectableQty(pos, '40')).not.toThrow();
  });
});

describe('defect consistency', () => {
  it('allows several defects on the same garment', () => {
    const plan = planQcVerdict({ inspectedQty: '10', passedQty: '8', failedQty: '2' });
    expect(() => assertDefectsConsistent(plan, [
      { category: 'STITCHING', qty: '2' },
      { category: 'MEASUREMENT', qty: '1' },
    ])).not.toThrow();
  });

  it('refuses defects recorded against an all-pass verdict', () => {
    const plan = planQcVerdict({ inspectedQty: '10', passedQty: '10' });
    expect(() => assertDefectsConsistent(plan, [{ category: 'FABRIC', qty: '1' }]))
      .toThrow(/no quantity was failed/);
  });
});
