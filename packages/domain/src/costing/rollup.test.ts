import { describe, expect, it } from 'vitest';
import { analyseWastage, rollUpCosts, type CostEntry } from './rollup';

const entries: CostEntry[] = [
  { costCategory: 'MATERIAL', isPlanned: true, amount: '64443.75' },
  { costCategory: 'MATERIAL', isPlanned: false, amount: '66800.00' },
  { costCategory: 'CUTTING', isPlanned: true, amount: '2500' },
  { costCategory: 'CUTTING', isPlanned: false, amount: '2400' },
  { costCategory: 'STITCHING', isPlanned: true, amount: '12000' },
  { costCategory: 'STITCHING', isPlanned: false, amount: '13500' },
  { costCategory: 'OVERHEAD', isPlanned: true, amount: '5000' },
  { costCategory: 'OVERHEAD', isPlanned: false, amount: '5000' },
];

describe('rollUpCosts', () => {
  const s = rollUpCosts(entries, '95');

  it('totals planned and actual separately', () => {
    expect(s.plannedTotal.toFixed()).toBe('83943.75');
    expect(s.actualTotal.toFixed(2)).toBe('87700.00');
    expect(s.varianceAmount.toFixed()).toBe('3756.25');
  });

  it('reports variance per category', () => {
    const byCat = Object.fromEntries(s.byCategory.map((c) => [c.costCategory, c]));
    expect(byCat.MATERIAL!.varianceAmount.toFixed()).toBe('2356.25');
    expect(byCat.CUTTING!.varianceAmount.toFixed(2)).toBe('-100.00');
    expect(byCat.OVERHEAD!.varianceAmount.toFixed(2)).toBe('0.00');
    expect(byCat.OVERHEAD!.variancePct!.toFixed()).toBe('0');
  });

  it('loads the cost of rejected garments onto the accepted ones', () => {
    // 100 released, 95 accepted: the unit cost is actual / 95, not / 100.
    expect(s.costPerAcceptedUnit!.toFixed()).toBe(
      s.actualTotal.dividedBy(95).toDecimalPlaces(6).toFixed(),
    );
    const per100 = s.actualTotal.dividedBy(100);
    expect(s.costPerAcceptedUnit!.greaterThan(per100)).toBe(true);
  });

  it('returns null unit cost when nothing was accepted', () => {
    expect(rollUpCosts(entries, '0').costPerAcceptedUnit).toBeNull();
  });

  it('reports a null percentage rather than dividing by zero', () => {
    const only = rollUpCosts([{ costCategory: 'JOB_WORK', isPlanned: false, amount: '500' }], '10');
    expect(only.byCategory[0]!.variancePct).toBeNull();
    expect(only.variancePct).toBeNull();
  });

  it('orders categories canonically', () => {
    expect(s.byCategory.map((c) => c.costCategory)).toEqual(['MATERIAL', 'CUTTING', 'STITCHING', 'OVERHEAD']);
  });
});

describe('analyseWastage - BOM variance', () => {
  it('compares the frozen BOM standard against actual consumption', () => {
    const rows = analyseWastage([
      { rawMaterialId: 'fab', standardQty: '262.5', actualQty: '271.8' },
      { rawMaterialId: 'lin', standardQty: '123.6', actualQty: '120.0' },
      { rawMaterialId: 'btn', standardQty: '850', actualQty: '850' },
    ]);
    const byId = Object.fromEntries(rows.map((r) => [r.rawMaterialId, r]));
    expect(byId.fab!.varianceQty.toFixed()).toBe('9.3');
    expect(byId.fab!.isOverConsumption).toBe(true);
    expect(byId.fab!.variancePct!.toFixed(4)).toBe('3.5429');
    expect(byId.lin!.isOverConsumption).toBe(false);
    expect(byId.btn!.varianceQty.toFixed()).toBe('0');
  });

  it('handles a zero standard without dividing by zero', () => {
    const [r] = analyseWastage([{ rawMaterialId: 'x', standardQty: '0', actualQty: '5' }]);
    expect(r!.variancePct).toBeNull();
    expect(r!.isOverConsumption).toBe(true);
  });
});
