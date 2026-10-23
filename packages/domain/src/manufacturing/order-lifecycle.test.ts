import { describe, expect, it } from 'vitest';
import { Decimal } from '../decimal';
import { IllegalStateError, ValidationError } from '../errors';
import type { MrpLine } from '../mrp/plan';
import {
  MO_STATUSES, MO_TRANSITIONS, assertMoTransition, assessMoRelease,
  authoriseMoRelease, canTransitionMo, isMoEditable, isTerminalMoStatus,
  rollupMoQuantities, type MoStatus,
} from './order-lifecycle';

const line = (over: Partial<MrpLine> & { rawMaterialId: string }): MrpLine => ({
  materialCode: over.rawMaterialId,
  materialName: over.rawMaterialId,
  uom: 'METER',
  netRequiredQty: new Decimal(0),
  wastageQty: new Decimal(0),
  grossRequiredQty: new Decimal(0),
  availableQty: new Decimal(0),
  reservedElsewhereQty: new Decimal(0),
  openPurchaseQty: new Decimal(0),
  expectedArrivalDate: null,
  shortageQty: new Decimal(0),
  uncoveredShortageQty: new Decimal(0),
  suggestedPurchaseQty: new Decimal(0),
  unitCost: new Decimal(0),
  estimatedCost: new Decimal(0),
  shortageValue: new Decimal(0),
  readiness: 'READY',
  arrivesLate: false,
  ...over,
});

describe('manufacturing order status machine', () => {
  it('defines transitions for every status', () => {
    for (const status of MO_STATUSES) {
      expect(MO_TRANSITIONS[status]).toBeDefined();
    }
  });

  it('only ever names real statuses as targets', () => {
    const known = new Set<string>(MO_STATUSES);
    for (const status of MO_STATUSES) {
      for (const target of MO_TRANSITIONS[status]) {
        expect(known.has(target), `${status} -> ${target}`).toBe(true);
      }
    }
  });

  it('treats CLOSED and CANCELLED as terminal', () => {
    expect(isTerminalMoStatus('CLOSED')).toBe(true);
    expect(isTerminalMoStatus('CANCELLED')).toBe(true);
    for (const status of MO_STATUSES.filter((s) => s !== 'CLOSED' && s !== 'CANCELLED')) {
      expect(isTerminalMoStatus(status), `${status} should not be terminal`).toBe(false);
    }
  });

  it('never allows a released order back into planning', () => {
    // Release freezes the BOM snapshot. A path back would allow a second
    // release against a different BOM while material from the first is
    // already on the floor.
    const planning: MoStatus[] = ['DRAFT', 'PENDING_MATERIAL', 'MATERIAL_RESERVED'];
    for (const from of ['RELEASED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CLOSED'] as MoStatus[]) {
      for (const to of planning) {
        expect(canTransitionMo(from, to), `${from} must not return to ${to}`).toBe(false);
      }
    }
  });

  it('allows cancellation from every non-terminal status', () => {
    for (const status of MO_STATUSES.filter((s) => !isTerminalMoStatus(s))) {
      if (status === 'COMPLETED') continue; // completed work is closed, not cancelled
      expect(canTransitionMo(status, 'CANCELLED'), `${status} should be cancellable`).toBe(true);
    }
  });

  it('does not let a completed order be cancelled', () => {
    // The garments exist. Cancelling would erase a real physical outcome.
    expect(canTransitionMo('COMPLETED', 'CANCELLED')).toBe(false);
    expect(MO_TRANSITIONS.COMPLETED).toEqual(['CLOSED']);
  });

  it('allows hold and resume while active', () => {
    expect(canTransitionMo('RELEASED', 'ON_HOLD')).toBe(true);
    expect(canTransitionMo('IN_PROGRESS', 'ON_HOLD')).toBe(true);
    expect(canTransitionMo('ON_HOLD', 'RELEASED')).toBe(true);
    expect(canTransitionMo('ON_HOLD', 'IN_PROGRESS')).toBe(true);
  });

  it('throws with the allowed set when a transition is illegal', () => {
    expect(() => assertMoTransition('CLOSED', 'RELEASED')).toThrow(IllegalStateError);
    try {
      assertMoTransition('RELEASED', 'DRAFT');
    } catch (e) {
      const err = e as IllegalStateError;
      expect(err.code).toBe('MO_ILLEGAL_TRANSITION');
      expect(err.details).toMatchObject({ from: 'RELEASED', to: 'DRAFT' });
    }
  });

  it('permits editing only before release', () => {
    expect(isMoEditable('DRAFT')).toBe(true);
    expect(isMoEditable('PENDING_MATERIAL')).toBe(true);
    expect(isMoEditable('MATERIAL_RESERVED')).toBe(true);
    for (const status of ['RELEASED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CLOSED', 'CANCELLED'] as MoStatus[]) {
      expect(isMoEditable(status), `${status} must not be editable`).toBe(false);
    }
  });
});

describe('release assessment', () => {
  it('is clear when every material is covered', () => {
    const a = assessMoRelease([
      line({ rawMaterialId: 'fabric', grossRequiredQty: new Decimal('262.5'), availableQty: new Decimal('300') }),
    ], { fabric: true }, { plannedQty: 100 });

    expect(a.isClear).toBe(true);
    expect(a.requiresOverride).toBe(false);
    expect(a.shortages).toEqual([]);
  });

  it('reports the specification shortage figures', () => {
    // 100 kurtas, 2.5 m each + 5% wastage = 262.5 m required, 180 m available.
    const a = assessMoRelease([
      line({
        rawMaterialId: 'fabric',
        grossRequiredQty: new Decimal('262.5'),
        availableQty: new Decimal('180'),
        unitCost: new Decimal('250'),
      }),
    ], { fabric: true }, { plannedQty: 100 });

    expect(a.shortages).toHaveLength(1);
    expect(a.shortages[0].shortageQty.toFixed(4)).toBe('82.5000');
    expect(a.totalShortageValue.toFixed(2)).toBe('20625.00');
    expect(a.requiresOverride).toBe(true);
  });

  it('does not require an override for a non-critical shortage', () => {
    // Short of hang tags is not short of fabric. Blocking both identically
    // trains planners to use the override reflexively.
    const a = assessMoRelease([
      line({ rawMaterialId: 'fabric', grossRequiredQty: new Decimal('262.5'), availableQty: new Decimal('300') }),
      line({ rawMaterialId: 'tag', grossRequiredQty: new Decimal('100'), availableQty: new Decimal('0') }),
    ], { fabric: true, tag: false }, { plannedQty: 100 });

    expect(a.shortages).toHaveLength(1);
    expect(a.criticalShortages).toEqual([]);
    expect(a.isClear).toBe(true);
    expect(a.requiresOverride).toBe(false);
  });

  it('treats a material with no criticality flag as critical', () => {
    // Failing safe: wrongly blocking a release is recoverable, wrongly
    // starting one without fabric is not.
    const a = assessMoRelease([
      line({ rawMaterialId: 'unknown', grossRequiredQty: new Decimal('10'), availableQty: new Decimal('0') }),
    ], {}, { plannedQty: 10 });

    expect(a.criticalShortages).toHaveLength(1);
    expect(a.requiresOverride).toBe(true);
  });

  it('scales requirements down for a partial release', () => {
    // 262.5 m for 100 garments; releasing 50 needs 131.25 m, which 180 covers.
    const a = assessMoRelease([
      line({ rawMaterialId: 'fabric', grossRequiredQty: new Decimal('262.5'), availableQty: new Decimal('180') }),
    ], { fabric: true }, { plannedQty: 100, releaseQty: 50 });

    expect(a.isClear).toBe(true);
    expect(a.shortages).toEqual([]);
  });

  it('computes how many garments stock actually covers', () => {
    // 180 m available, 2.625 m per garment -> 68 whole garments.
    const a = assessMoRelease([
      line({ rawMaterialId: 'fabric', grossRequiredQty: new Decimal('262.5'), availableQty: new Decimal('180') }),
    ], { fabric: true }, { plannedQty: 100 });

    expect(a.maxProducibleQty.toFixed()).toBe('68');
  });

  it('takes the producible quantity from the tightest material', () => {
    const a = assessMoRelease([
      line({ rawMaterialId: 'fabric', grossRequiredQty: new Decimal('250'), availableQty: new Decimal('250') }),
      line({ rawMaterialId: 'button', grossRequiredQty: new Decimal('500'), availableQty: new Decimal('150') }),
    ], { fabric: true, button: true }, { plannedQty: 100 });

    // buttons: 5 per garment, 150 available -> 30 garments.
    expect(a.maxProducibleQty.toFixed()).toBe('30');
  });

  it('never reports more producible than ordered', () => {
    const a = assessMoRelease([
      line({ rawMaterialId: 'fabric', grossRequiredQty: new Decimal('100'), availableQty: new Decimal('10000') }),
    ], { fabric: true }, { plannedQty: 100 });

    expect(a.maxProducibleQty.toFixed()).toBe('100');
  });

  it('ignores open purchase orders as cover', () => {
    // Stock that has not arrived cannot be cut.
    const a = assessMoRelease([
      line({
        rawMaterialId: 'fabric',
        grossRequiredQty: new Decimal('262.5'),
        availableQty: new Decimal('180'),
        openPurchaseQty: new Decimal('1000'),
      }),
    ], { fabric: true }, { plannedQty: 100 });

    expect(a.requiresOverride).toBe(true);
    expect(a.shortages[0].shortageQty.toFixed(4)).toBe('82.5000');
  });

  it('rejects a release quantity above the ordered quantity', () => {
    expect(() =>
      assessMoRelease([], {}, { plannedQty: 100, releaseQty: 150 }),
    ).toThrow(ValidationError);
  });

  it('rejects a non-positive release quantity', () => {
    expect(() => assessMoRelease([], {}, { plannedQty: 100, releaseQty: 0 })).toThrow(ValidationError);
  });
});

describe('release authorisation', () => {
  const short = assessMoRelease([
    line({ rawMaterialId: 'fabric', grossRequiredQty: new Decimal('262.5'), availableQty: new Decimal('180') }),
  ], { fabric: true }, { plannedQty: 100 });

  const clear = assessMoRelease([
    line({ rawMaterialId: 'fabric', grossRequiredQty: new Decimal('100'), availableQty: new Decimal('100') }),
  ], { fabric: true }, { plannedQty: 100 });

  it('passes a clear order with no permission and no reason', () => {
    expect(() => authoriseMoRelease(clear, { hasShortageOverride: false })).not.toThrow();
  });

  it('refuses a shortage release without the permission', () => {
    expect(() =>
      authoriseMoRelease(short, { hasShortageOverride: false, reason: 'customer is waiting' }),
    ).toThrow(IllegalStateError);
  });

  it('names the permission and the real numbers when it refuses', () => {
    try {
      authoriseMoRelease(short, { hasShortageOverride: false });
    } catch (e) {
      const err = e as IllegalStateError;
      expect(err.code).toBe('SHORTAGE_OVERRIDE_REQUIRED');
      expect(err.details?.requiredPermission).toBe('manufacturing.release_with_shortage');
      expect(err.details?.maxProducibleQty).toBe('68');
      expect(err.details?.shortages).toMatchObject([
        { requiredQty: '262.5000', availableQty: '180.0000', shortageQty: '82.5000' },
      ]);
    }
  });

  it('refuses a shortage release with the permission but no reason', () => {
    expect(() => authoriseMoRelease(short, { hasShortageOverride: true })).toThrow(ValidationError);
    expect(() => authoriseMoRelease(short, { hasShortageOverride: true, reason: 'urgent' })).toThrow(
      ValidationError,
    );
  });

  it('allows a shortage release with the permission and a real reason', () => {
    expect(() =>
      authoriseMoRelease(short, {
        hasShortageOverride: true,
        reason: 'Balance fabric arrives Tuesday; cutting starts on the 180 m in stock.',
      }),
    ).not.toThrow();
  });
});

describe('quantity rollup', () => {
  const item = (o: Partial<Record<string, string>> = {}) => ({
    orderedQty: o.orderedQty ?? '0',
    releasedQty: o.releasedQty ?? '0',
    completedQty: o.completedQty ?? '0',
    rejectedQty: o.rejectedQty ?? '0',
    inwardedQty: o.inwardedQty ?? '0',
    cancelledQty: o.cancelledQty ?? '0',
  });

  it('sums every line', () => {
    const r = rollupMoQuantities([
      item({ orderedQty: '60', releasedQty: '60', inwardedQty: '55' }),
      item({ orderedQty: '40', releasedQty: '20', inwardedQty: '18' }),
    ]);
    expect(r.orderedQty.toFixed(4)).toBe('100.0000');
    expect(r.releasedQty.toFixed(4)).toBe('80.0000');
    expect(r.inwardedQty.toFixed(4)).toBe('73.0000');
  });

  it('counts cancelled quantity as not pending release', () => {
    const r = rollupMoQuantities([item({ orderedQty: '100', releasedQty: '60', cancelledQty: '40' })]);
    expect(r.pendingReleaseQty.toFixed(4)).toBe('0.0000');
  });

  it('never reports negative pending release', () => {
    const r = rollupMoQuantities([item({ orderedQty: '100', releasedQty: '120' })]);
    expect(r.pendingReleaseQty.toFixed(4)).toBe('0.0000');
  });

  it('bases completion on inwarded garments, not stage counters', () => {
    // Completion means finished goods exist, not that a stage reported a number.
    const r = rollupMoQuantities([item({ orderedQty: '100', completedQty: '90', inwardedQty: '73' })]);
    expect(r.completionPct.toFixed(2)).toBe('73.00');
  });

  it('reports zero completion for an empty order rather than dividing by zero', () => {
    expect(rollupMoQuantities([]).completionPct.toFixed()).toBe('0');
  });
});
