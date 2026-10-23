import { describe, expect, it } from 'vitest';
import { IllegalStateError } from '../errors';
import {
  consumptionForSize, diffBomVersions, explodeBom, snapshotBom, wastageFor,
  type BomItemInput, type BomVersionInput,
} from './explode';

// DASH AND DOT KURTA, SKU DD-KRT-001-M, exactly as the specification states it.
const KURTA_ITEMS: BomItemInput[] = [
  { lineNo: 1, rawMaterialId: 'fab', materialCode: 'FAB-001', materialName: 'Main Fabric',
    consumptionQty: '2.5', uom: 'METER', wastageBasis: 'PERCENT_OF_CONSUMPTION', wastageValue: '5',
    unitCost: '245.50', productionStageCode: 'CUTTING',
    sizeOverrides: { XS: '2.30', S: '2.40', M: '2.50', L: '2.65', XL: '2.75', XXL: '2.85' } },
  { lineNo: 2, rawMaterialId: 'lin', materialCode: 'LIN-001', materialName: 'Lining',
    consumptionQty: '1.2', uom: 'METER', wastageBasis: 'PERCENT_OF_CONSUMPTION', wastageValue: '3', unitCost: '85' },
  { lineNo: 3, rawMaterialId: 'btn', materialCode: 'BTN-001', materialName: 'Buttons',
    consumptionQty: '8', uom: 'PIECE', wastageBasis: 'FIXED_PER_UNIT', wastageValue: '0.5', unitCost: '3.25' },
  { lineNo: 4, rawMaterialId: 'thr', materialCode: 'THR-001', materialName: 'Thread',
    consumptionQty: '1', uom: 'PIECE', wastageBasis: 'NONE', wastageValue: '0', unitCost: '18' },
  { lineNo: 5, rawMaterialId: 'lbl', materialCode: 'LBL-001', materialName: 'Brand Label',
    consumptionQty: '1', uom: 'PIECE', wastageBasis: 'NONE', wastageValue: '0', unitCost: '4.5' },
  { lineNo: 6, rawMaterialId: 'care', materialCode: 'LBL-002', materialName: 'Care Label',
    consumptionQty: '1', uom: 'PIECE', wastageBasis: 'NONE', wastageValue: '0', unitCost: '2' },
  { lineNo: 7, rawMaterialId: 'pkg', materialCode: 'PKG-001', materialName: 'Packaging',
    consumptionQty: '1', uom: 'SET', wastageBasis: 'NONE', wastageValue: '0', unitCost: '22' },
];

const BOM: BomVersionInput = { id: 'bv1', version: 1, status: 'APPROVED', baseQuantity: '1', items: KURTA_ITEMS };

describe('explodeBom - the specification worked example', () => {
  const result = explodeBom(BOM, [{ size: 'M', quantity: '100' }]);
  const byId = Object.fromEntries(result.requirements.map((r) => [r.rawMaterialId, r]));

  it('computes 100 x 2.5 m = 250 m net for the main fabric', () => {
    expect(byId.fab!.netRequiredQty.toFixed()).toBe('250');
  });

  it('adds a 5% wastage allowance of 12.5 m', () => {
    expect(byId.fab!.wastageQty.toFixed()).toBe('12.5');
  });

  it('arrives at a gross requirement of 262.5 m', () => {
    expect(byId.fab!.grossRequiredQty.toFixed()).toBe('262.5');
  });

  it('explodes every other line of the kurta BOM', () => {
    expect(byId.lin!.netRequiredQty.toFixed()).toBe('120');
    expect(byId.lin!.grossRequiredQty.toFixed()).toBe('123.6');
    expect(byId.btn!.netRequiredQty.toFixed()).toBe('800');
    expect(byId.btn!.grossRequiredQty.toFixed()).toBe('850');   // 800 + 0.5 x 100
    expect(byId.thr!.grossRequiredQty.toFixed()).toBe('100');
    expect(byId.pkg!.grossRequiredQty.toFixed()).toBe('100');
  });

  it('keeps the BOM line order', () => {
    expect(result.requirements.map((r) => r.rawMaterialId))
      .toEqual(['fab', 'lin', 'btn', 'thr', 'lbl', 'care', 'pkg']);
  });

  it('costs the requirement from the line unit costs', () => {
    // 262.5 x 245.50 = 64,443.75 for the fabric alone.
    expect(byId.fab!.estimatedCost.toFixed()).toBe('64443.75');
    expect(result.totalMaterialCost.greaterThan(0)).toBe(true);
    expect(result.costPerUnit.toFixed()).toBe(
      result.totalMaterialCost.dividedBy(100).toDecimalPlaces(6).toFixed(),
    );
  });
});

describe('explodeBom - size-wise consumption', () => {
  it('uses the size override for each demand line', () => {
    expect(consumptionForSize(KURTA_ITEMS[0]!, 'XXL').toFixed()).toBe('2.85');
    expect(consumptionForSize(KURTA_ITEMS[0]!, 'M').toFixed()).toBe('2.5');
    // No override configured for this size: fall back to the base figure.
    expect(consumptionForSize(KURTA_ITEMS[0]!, 'XXXL').toFixed()).toBe('2.5');
    expect(consumptionForSize(KURTA_ITEMS[1]!, 'XXL').toFixed()).toBe('1.2');
  });

  it('does not average sizes: 50 M + 50 XXL needs 267.5 m net, not 250', () => {
    const r = explodeBom(BOM, [
      { size: 'M', quantity: '50' },
      { size: 'XXL', quantity: '50' },
    ]);
    const fab = r.requirements.find((x) => x.rawMaterialId === 'fab')!;
    // 50 x 2.50 + 50 x 2.85 = 125 + 142.5 = 267.5
    expect(fab.netRequiredQty.toFixed()).toBe('267.5');
    expect(fab.grossRequiredQty.toFixed()).toBe('280.875');
    expect(r.plannedQty.toFixed()).toBe('100');
  });

  it('charges a per-order wastage allowance once, not once per size line', () => {
    const item: BomItemInput = { lineNo: 1, rawMaterialId: 'm', consumptionQty: '1', uom: 'METER',
      wastageBasis: 'FIXED_PER_ORDER', wastageValue: '10' };
    const bom: BomVersionInput = { id: 'b', version: 1, status: 'APPROVED', baseQuantity: '1', items: [item] };
    const r = explodeBom(bom, [{ size: 'S', quantity: '40' }, { size: 'M', quantity: '60' }]);
    expect(r.requirements[0]!.netRequiredQty.toFixed()).toBe('100');
    expect(r.requirements[0]!.wastageQty.toFixed()).toBe('10');
  });
});

describe('wastageFor', () => {
  const base: BomItemInput = { lineNo: 1, rawMaterialId: 'm', consumptionQty: '1', uom: 'METER',
    wastageBasis: 'NONE', wastageValue: '0' };

  it('handles every basis', () => {
    expect(wastageFor({ ...base, wastageBasis: 'PERCENT_OF_CONSUMPTION', wastageValue: '5' }, '250', '100').toFixed()).toBe('12.5');
    expect(wastageFor({ ...base, wastageBasis: 'FIXED_PER_UNIT', wastageValue: '0.5' }, '800', '100').toFixed()).toBe('50');
    expect(wastageFor({ ...base, wastageBasis: 'FIXED_PER_ORDER', wastageValue: '10' }, '250', '100').toFixed()).toBe('10');
    expect(wastageFor({ ...base, wastageBasis: 'NONE', wastageValue: '99' }, '250', '100').toFixed()).toBe('0');
  });

  it('rejects a negative allowance', () => {
    expect(() => wastageFor({ ...base, wastageBasis: 'PERCENT_OF_CONSUMPTION', wastageValue: '-5' }, '250', '100')).toThrow();
  });
});

describe('explodeBom - guards', () => {
  it('refuses to drive production from an unapproved BOM', () => {
    for (const status of ['DRAFT', 'PENDING_APPROVAL', 'SUPERSEDED', 'ARCHIVED'] as const) {
      expect(() => explodeBom({ ...BOM, status }, [{ quantity: '10' }])).toThrow(IllegalStateError);
    }
  });

  it('allows an unapproved BOM only for an explicit what-if preview', () => {
    const r = explodeBom({ ...BOM, status: 'DRAFT' }, [{ quantity: '10' }], { requireApproved: false });
    expect(r.plannedQty.toFixed()).toBe('10');
  });

  it('refuses an empty BOM and a zero order quantity', () => {
    expect(() => explodeBom({ ...BOM, items: [] }, [{ quantity: '10' }])).toThrow(/no material lines/);
    expect(() => explodeBom(BOM, [{ quantity: '0' }])).toThrow(/greater than zero/);
  });

  it('scales correctly when the BOM is written per dozen', () => {
    const perDozen: BomVersionInput = { id: 'b', version: 1, status: 'APPROVED', baseQuantity: '12',
      items: [{ lineNo: 1, rawMaterialId: 'fab', consumptionQty: '30', uom: 'METER', wastageBasis: 'NONE', wastageValue: '0' }] };
    // 30 m per 12 garments = 2.5 m each, so 100 garments need 250 m.
    expect(explodeBom(perDozen, [{ quantity: '100' }]).requirements[0]!.netRequiredQty.toFixed()).toBe('250');
  });
});

describe('BOM snapshot and revision safety', () => {
  it('freezes per-unit figures a released order can rely on', () => {
    const explosion = explodeBom(BOM, [{ size: 'M', quantity: '100' }]);
    const snap = snapshotBom(BOM, explosion);
    const fab = snap.find((l) => l.rawMaterialId === 'fab')!;
    expect(fab.consumptionQtyPerUnit.toFixed()).toBe('2.5');
    expect(fab.wastageQtyPerUnit.toFixed()).toBe('0.125');
    expect(fab.grossQtyPerUnit.toFixed()).toBe('2.625');
    expect(fab.plannedQty.toFixed()).toBe('262.5');
    expect(fab.unitCost.toFixed()).toBe('245.5');
  });

  it('a later master BOM revision does not change the frozen snapshot', () => {
    const explosion = explodeBom(BOM, [{ size: 'M', quantity: '100' }]);
    const snapshot = snapshotBom(BOM, explosion);

    // Version 2 raises fabric consumption and wastage after the order shipped.
    const v2: BomVersionInput = {
      ...BOM, id: 'bv2', version: 2,
      items: KURTA_ITEMS.map((i) => i.rawMaterialId === 'fab'
        ? { ...i, consumptionQty: '2.7', wastageValue: '8' } : i),
    };
    const v2Explosion = explodeBom(v2, [{ quantity: '100' }]);

    // The new version computes a different number...
    expect(v2Explosion.requirements.find((r) => r.rawMaterialId === 'fab')!.grossRequiredQty.toFixed()).toBe('291.6');
    // ...while the snapshot the released order carries is untouched.
    expect(snapshot.find((l) => l.rawMaterialId === 'fab')!.plannedQty.toFixed()).toBe('262.5');
  });

  it('diffs two versions line by line', () => {
    const v2: BomVersionInput = {
      ...BOM, id: 'bv2', version: 2,
      items: [
        ...KURTA_ITEMS.filter((i) => i.rawMaterialId !== 'care')
          .map((i) => i.rawMaterialId === 'fab' ? { ...i, consumptionQty: '2.7' } : i),
        { lineNo: 8, rawMaterialId: 'zip', consumptionQty: '1', uom: 'PIECE', wastageBasis: 'NONE', wastageValue: '0' },
      ],
    };
    const diff = Object.fromEntries(diffBomVersions(BOM, v2).map((d) => [d.rawMaterialId, d]));
    expect(diff.fab!.change).toBe('CHANGED');
    expect(diff.fab!.fromGrossPerUnit!.toFixed()).toBe('2.625');
    expect(diff.fab!.toGrossPerUnit!.toFixed()).toBe('2.835');
    expect(diff.care!.change).toBe('REMOVED');
    expect(diff.zip!.change).toBe('ADDED');
    expect(diff.btn!.change).toBe('UNCHANGED');
  });
});
