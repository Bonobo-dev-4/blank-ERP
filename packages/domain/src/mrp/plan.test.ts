import { describe, expect, it } from 'vitest';
import type { ExplodedRequirement } from '../bom/explode';
import { Decimal } from '../decimal';
import { aggregateMrpLines, maxProducibleQty, roundPurchaseQty, runMrp } from './plan';

const req = (over: Partial<ExplodedRequirement> = {}): ExplodedRequirement => ({
  rawMaterialId: 'fab', materialCode: 'FAB-001', materialName: 'Main Fabric', uom: 'METER',
  productionStageId: null, productionStageCode: 'CUTTING',
  netRequiredQty: new Decimal('250'), wastageQty: new Decimal('12.5'),
  grossRequiredQty: new Decimal('262.5'), unitCost: new Decimal('245.50'),
  estimatedCost: new Decimal('64443.75'),
  ...over,
});

describe('runMrp - the specification worked example', () => {
  const result = runMrp([req()], [{ rawMaterialId: 'fab', availableQty: '180' }], '100');
  const line = result.lines[0]!;

  it('reports a shortage of 82.5 m against 262.5 required and 180 available', () => {
    expect(line.grossRequiredQty.toFixed()).toBe('262.5');
    expect(line.availableQty.toFixed()).toBe('180');
    expect(line.shortageQty.toFixed()).toBe('82.5');
  });

  it('values the shortage and flags the run as not production ready', () => {
    expect(line.shortageValue.toFixed()).toBe('20253.75'); // 82.5 x 245.50
    expect(result.isProductionReady).toBe(false);
    expect(result.shortageLineCount).toBe(1);
    expect(result.blockingMaterialIds).toEqual(['fab']);
  });

  it('suggests buying exactly the uncovered shortage', () => {
    expect(line.suggestedPurchaseQty.toFixed()).toBe('82.5');
  });
});

describe('runMrp - open purchase orders are supply, not stock', () => {
  it('does not let an open PO reduce the shortage figure', () => {
    const r = runMrp(
      [req()],
      [{ rawMaterialId: 'fab', availableQty: '180', openPurchaseQty: '100',
         expectedArrivalDate: new Date('2026-11-01') }],
      '100',
      { requiredByDate: new Date('2026-11-15') },
    );
    const line = r.lines[0]!;
    // The shortage is still measured against physical stock...
    expect(line.shortageQty.toFixed()).toBe('82.5');
    // ...but the incoming quantity is reported, and it covers the gap in time.
    expect(line.openPurchaseQty.toFixed()).toBe('100');
    expect(line.uncoveredShortageQty.toFixed()).toBe('0');
    expect(line.readiness).toBe('PARTIALLY_AVAILABLE');
    expect(line.suggestedPurchaseQty.toFixed()).toBe('0');
    expect(r.isProductionReady).toBe(false);
  });

  it('flags incoming supply that arrives after production needs it', () => {
    const r = runMrp(
      [req()],
      [{ rawMaterialId: 'fab', availableQty: '180', openPurchaseQty: '100',
         expectedArrivalDate: new Date('2026-12-20') }],
      '100',
      { requiredByDate: new Date('2026-11-15') },
    );
    expect(r.lines[0]!.arrivesLate).toBe(true);
    expect(r.lines[0]!.readiness).toBe('SHORT_AND_LATE');
    expect(r.blockingMaterialIds).toEqual(['fab']);
  });

  it('still asks for the part an open PO does not cover', () => {
    const r = runMrp([req()], [{ rawMaterialId: 'fab', availableQty: '180', openPurchaseQty: '50' }], '100');
    expect(r.lines[0]!.uncoveredShortageQty.toFixed()).toBe('32.5');
    expect(r.lines[0]!.suggestedPurchaseQty.toFixed()).toBe('32.5');
  });
});

describe('runMrp - reservations held by other orders', () => {
  it('reports stock promised elsewhere separately from availability', () => {
    // 500 m exists but 320 is reserved for other orders: 180 is available.
    const r = runMrp([req()], [{ rawMaterialId: 'fab', availableQty: '180', reservedElsewhereQty: '320' }], '100');
    expect(r.lines[0]!.availableQty.toFixed()).toBe('180');
    expect(r.lines[0]!.reservedElsewhereQty.toFixed()).toBe('320');
    expect(r.lines[0]!.shortageQty.toFixed()).toBe('82.5');
  });

  it('is production ready when stock fully covers the gross requirement', () => {
    const r = runMrp([req()], [{ rawMaterialId: 'fab', availableQty: '300' }], '100');
    expect(r.lines[0]!.shortageQty.toFixed()).toBe('0');
    expect(r.lines[0]!.readiness).toBe('READY');
    expect(r.isProductionReady).toBe(true);
  });

  it('treats a material with no supply row at all as fully short', () => {
    const r = runMrp([req()], [], '100');
    expect(r.lines[0]!.shortageQty.toFixed()).toBe('262.5');
  });
});

describe('roundPurchaseQty', () => {
  it('respects a supplier minimum order quantity', () => {
    expect(roundPurchaseQty('12', { minimumOrderQty: '50' }).toFixed()).toBe('50');
    expect(roundPurchaseQty('80', { minimumOrderQty: '50' }).toFixed()).toBe('80');
  });

  it('rounds up to a purchasable increment', () => {
    // Fabric sold in 25 m rolls: 82.5 m needs 4 rolls.
    expect(roundPurchaseQty('82.5', { orderMultiple: '25' }).toFixed()).toBe('100');
    expect(roundPurchaseQty('100', { orderMultiple: '25' }).toFixed()).toBe('100');
  });

  it('is zero when nothing is short', () => {
    expect(roundPurchaseQty('0', { minimumOrderQty: '50' }).toFixed()).toBe('0');
    expect(roundPurchaseQty('-10').toFixed()).toBe('0');
  });
});

describe('maxProducibleQty - authorised partial release', () => {
  const fabric = req();
  const buttons = req({
    rawMaterialId: 'btn', materialCode: 'BTN-001',
    netRequiredQty: new Decimal('800'), wastageQty: new Decimal('50'),
    grossRequiredQty: new Decimal('850'), unitCost: new Decimal('3.25'),
  });

  it('answers "we wanted 100, how many can we start today?"', () => {
    // 180 m of fabric at 2.625 m per garment = 68 garments.
    const n = maxProducibleQty([fabric], [{ rawMaterialId: 'fab', availableQty: '180' }], '100');
    expect(n.toFixed()).toBe('68');
  });

  it('is limited by the scarcest material', () => {
    const n = maxProducibleQty(
      [fabric, buttons],
      [{ rawMaterialId: 'fab', availableQty: '180' }, { rawMaterialId: 'btn', availableQty: '170' }],
      '100',
    );
    // Buttons: 170 / 8.5 per garment = 20.
    expect(n.toFixed()).toBe('20');
  });

  it('never exceeds the quantity actually wanted', () => {
    const n = maxProducibleQty([fabric], [{ rawMaterialId: 'fab', availableQty: '99999' }], '100');
    expect(n.toFixed()).toBe('100');
  });

  it('is zero when nothing is available', () => {
    expect(maxProducibleQty([fabric], [], '100').toFixed()).toBe('0');
  });

  it('floors to whole garments', () => {
    // 200 m / 2.625 = 76.19 -> 76, not 76.19.
    expect(maxProducibleQty([fabric], [{ rawMaterialId: 'fab', availableQty: '200' }], '100').toFixed()).toBe('76');
  });
});

describe('aggregateMrpLines - all-store demand aggregation', () => {
  it('adds requirements but counts the same stock only once', () => {
    const runA = runMrp([req()], [{ rawMaterialId: 'fab', availableQty: '180' }], '100');
    const runB = runMrp(
      [req({ netRequiredQty: new Decimal('125'), wastageQty: new Decimal('6.25'), grossRequiredQty: new Decimal('131.25') })],
      [{ rawMaterialId: 'fab', availableQty: '180' }],
      '50',
    );
    const agg = aggregateMrpLines([runA, runB]);
    expect(agg).toHaveLength(1);
    expect(agg[0]!.grossRequiredQty.toFixed()).toBe('393.75');
    expect(agg[0]!.availableQty.toFixed()).toBe('180');
    expect(agg[0]!.shortageQty.toFixed()).toBe('213.75');
  });
});
