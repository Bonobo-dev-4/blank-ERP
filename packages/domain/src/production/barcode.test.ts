import { describe, expect, it } from 'vitest';
import { IllegalStateError, ValidationError } from '../errors';
import {
  assertScannable, buildBatchCode, buildRollCode, buildUnitCode, checkCharacter,
  isWellFormedBarcode, kindOf, normaliseScannedCode,
} from './barcode';
import { planBatchSplit, planSerialisation } from './serialization';

describe('barcode codes', () => {
  it('builds a readable batch code from the MO number', () => {
    const code = buildBatchCode('DD-MFG-2026-000125', 1);
    expect(code.startsWith('BAT-')).toBe(true);
    expect(code).toContain('B01');
    expect(isWellFormedBarcode(code)).toBe(true);
    expect(kindOf(code)).toBe('PRODUCTION_BATCH');
  });

  it('builds unit codes that are unique per unit and stable per input', () => {
    const a = buildUnitCode('DD-MFG-2026-000125', 1, 1);
    const b = buildUnitCode('DD-MFG-2026-000125', 1, 2);
    expect(a).not.toBe(b);
    expect(a).toBe(buildUnitCode('DD-MFG-2026-000125', 1, 1));
    expect(kindOf(a)).toBe('PRODUCTION_UNIT');
  });

  it('carries only an identifier, never a payload', () => {
    const code = buildBatchCode('DD-MFG-2026-000125', 1);
    // No quantity, stage or SKU is embedded: all context is resolved server-side.
    expect(code).not.toMatch(/\{|\}|:|CUTTING|100/);
    expect(code.length).toBeLessThan(40);
  });

  it('normalises what a scanner actually sends', () => {
    expect(normaliseScannedCode('  bat-000125-b01-k \n')).toBe('BAT-000125-B01-K');
  });

  it('has a check character that catches a single mistyped character', () => {
    const body = '000125-B01';
    const good = checkCharacter(body);
    const bad = checkCharacter('000125-B02');
    expect(good).not.toBe(bad);
  });

  it('bounds batch and unit sequences', () => {
    expect(() => buildBatchCode('MO-1', 0)).toThrow(ValidationError);
    expect(() => buildBatchCode('MO-1', 1000)).toThrow(ValidationError);
    expect(() => buildUnitCode('MO-1', 1, 0)).toThrow(ValidationError);
  });

  it('rejects malformed scans', () => {
    for (const bad of ['', 'HELLO', '12345', '{"mo":"1"}']) {
      expect(isWellFormedBarcode(bad)).toBe(false);
    }
    expect(isWellFormedBarcode(buildRollCode('ROLL-000001'))).toBe(true);
  });
});

describe('assertScannable', () => {
  const ok = { code: 'BAT-000125-B01-K', kind: 'PRODUCTION_BATCH' as const, isActive: true };

  it('accepts a known, active barcode of the expected kind', () => {
    expect(() => assertScannable(ok, ok.code, ['PRODUCTION_BATCH'])).not.toThrow();
  });

  it('refuses an unknown barcode', () => {
    expect(() => assertScannable(null, 'BAT-999999-B01-K')).toThrow(/not known to the system/);
  });

  it('refuses a revoked and reprinted barcode', () => {
    expect(() => assertScannable({ ...ok, isActive: false, revokedAt: new Date() }, ok.code))
      .toThrow(IllegalStateError);
  });

  it('refuses the wrong kind of barcode for the screen', () => {
    expect(() => assertScannable(ok, ok.code, ['FABRIC_ROLL']))
      .toThrow(/expects a FABRIC_ROLL barcode/);
  });
});

describe('serialisation - a batch of 100 is not one unit', () => {
  it('creates one identifier per garment', () => {
    const units = planSerialisation({
      moNo: 'DD-MFG-2026-000125', batchSequence: 1, batchId: 'b1',
      existingUnitCount: 0, eligibleQty: '100', requestedCount: 100,
    });
    expect(units).toHaveLength(100);
    expect(new Set(units.map((u) => u.barcode)).size).toBe(100);
    expect(units[0]!.unitSequence).toBe(1);
    expect(units[99]!.unitSequence).toBe(100);
  });

  it('continues numbering from the units that already exist', () => {
    const units = planSerialisation({
      moNo: 'DD-MFG-2026-000125', batchSequence: 1, batchId: 'b1',
      existingUnitCount: 60, eligibleQty: '100', requestedCount: 40,
    });
    expect(units[0]!.unitSequence).toBe(61);
    expect(units).toHaveLength(40);
  });

  it('never serialises more units than there are garments', () => {
    expect(() => planSerialisation({
      moNo: 'MO-1', batchSequence: 1, batchId: 'b1',
      existingUnitCount: 95, eligibleQty: '100', requestedCount: 6,
    })).toThrow(/exceed the quantity eligible/);
  });

  it('rejects a non-integer or non-positive count', () => {
    for (const n of [0, -1, 2.5]) {
      expect(() => planSerialisation({
        moNo: 'MO-1', batchSequence: 1, batchId: 'b1',
        existingUnitCount: 0, eligibleQty: '100', requestedCount: n,
      })).toThrow(ValidationError);
    }
  });
});

describe('batch splitting across operators', () => {
  it('partitions the parent quantity exactly', () => {
    const plan = planBatchSplit('b1', '100', ['40', '35', '25']);
    expect(plan.childQuantities.map((q) => q.toFixed())).toEqual(['40', '35', '25']);
  });

  it('refuses a split that loses or invents garments', () => {
    expect(() => planBatchSplit('b1', '100', ['40', '35'])).toThrow(/add up to exactly/);
    expect(() => planBatchSplit('b1', '100', ['60', '50'])).toThrow(/add up to exactly/);
  });

  it('refuses a degenerate split', () => {
    expect(() => planBatchSplit('b1', '100', ['100'])).toThrow(/at least two batches/);
    expect(() => planBatchSplit('b1', '100', ['100', '0'])).toThrow(ValidationError);
  });

  it('handles fractional-free decimal splits', () => {
    const plan = planBatchSplit('b1', '7', ['3', '2', '2']);
    expect(plan.childQuantities).toHaveLength(3);
  });
});
