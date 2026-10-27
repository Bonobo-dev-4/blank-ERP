import { describe, expect, it } from 'vitest';
import {
  assessSwitchReconciliation, canTransitionSwitch, evaluateFacilitySwitch, holdsSwitchLock,
  judgeSwitchVerification, matchUniwareItemToLine, readSwitchResponse,
  type SwitchEligibilityInput,
} from './facility-switch';

const NOW = new Date('2026-10-28T10:00:00Z');

function input(over: Partial<SwitchEligibilityInput> = {}): SwitchEligibilityInput {
  return {
    hasPermission: true,
    order: { found: true, status: 'PROCESSING', displayMatches: true },
    item: {
      code: '15000000000001', sku: 'W/2769-L-49295244427434', facilityCode: 'dashanddot',
      statusCode: 'CREATED', shippingPackageCode: null, shippingPackageStatus: null, onHold: false,
    },
    expectedSourceFacility: 'dashanddot',
    target: { code: 'ST_KGF_Mumbai', configured: true, visible: true, enabled: true },
    targetStock: { availableQty: 3, checkedAt: new Date(NOW.getTime() - 10_000) },
    lineMatch: 'LINE_ID',
    erpOpenQty: 1,
    itemQty: 1,
    conflictingOperation: null,
    writes: { env: true, connection: true },
    now: NOW,
    ...over,
  };
}

const failing = (r: ReturnType<typeof evaluateFacilitySwitch>) =>
  r.checks.filter((c) => c.state !== 'PASS').map((c) => `${c.code}:${c.state}`);

describe('evaluateFacilitySwitch', () => {
  it('is ready when every check passes', () => {
    const r = evaluateFacilitySwitch(input());
    expect(failing(r)).toEqual([]);
    expect(r.ready).toBe(true);
    expect(r.blocker).toBeNull();
  });

  it('refuses insufficient stock at the target', () => {
    const r = evaluateFacilitySwitch(input({ targetStock: { availableQty: 0, checkedAt: NOW } }));
    expect(failing(r)).toEqual(['STOCK:FAIL']);
    expect(r.ready).toBe(false);
  });

  it('treats unread or stale stock as unknown, which also blocks', () => {
    expect(failing(evaluateFacilitySwitch(input({ targetStock: null })))).toEqual(['STOCK:UNKNOWN']);
    const stale = { availableQty: 5, checkedAt: new Date(NOW.getTime() - 5 * 60_000) };
    expect(failing(evaluateFacilitySwitch(input({ targetStock: stale })))).toEqual(['STOCK:UNKNOWN']);
  });

  it('refuses when the item moved since the operator looked', () => {
    const r = evaluateFacilitySwitch(input({ expectedSourceFacility: 'WH_Noida' }));
    expect(failing(r)).toEqual(['SOURCE_MATCH:FAIL']);
  });

  it('refuses an item that cannot be matched to the order line', () => {
    expect(failing(evaluateFacilitySwitch(input({ lineMatch: null })))).toEqual(['SKU_MATCH:FAIL']);
  });

  it('refuses when Shopify shows nothing left to fulfil', () => {
    expect(failing(evaluateFacilitySwitch(input({ erpOpenQty: 0 })))).toEqual(['NOT_DISPATCHED:FAIL', 'QUANTITY:FAIL']);
  });

  it('refuses once picking has started, and allows a package still being formed', () => {
    const picking = input({ item: { ...input().item!, shippingPackageCode: 'SP1', shippingPackageStatus: 'PICKING' } });
    expect(failing(evaluateFacilitySwitch(picking))).toEqual(['SHIPMENT_STATUS:FAIL']);
    const forming = input({ item: { ...input().item!, shippingPackageCode: 'SP1', shippingPackageStatus: 'CREATED' } });
    expect(evaluateFacilitySwitch(forming).ready).toBe(true);
  });

  it('refuses dispatched, held and later-stage items', () => {
    const dispatched = input({ item: { ...input().item!, statusCode: 'DISPATCHED' } });
    expect(failing(evaluateFacilitySwitch(dispatched))).toEqual(['ITEM_STATUS:FAIL', 'NOT_DISPATCHED:FAIL']);
    const held = input({ item: { ...input().item!, onHold: true } });
    expect(failing(evaluateFacilitySwitch(held))).toEqual(['ITEM_STATUS:FAIL']);
    const packed = input({ item: { ...input().item!, statusCode: 'PACKED' } });
    expect(failing(evaluateFacilitySwitch(packed))).toEqual(['ITEM_STATUS:FAIL']);
  });

  it('refuses an operator without the permission', () => {
    const r = evaluateFacilitySwitch(input({ hasPermission: false }));
    expect(failing(r)).toEqual(['ACCESS:FAIL']);
    expect(r.blocker?.code).toBe('ACCESS');
  });

  it('refuses the same facility as source and target', () => {
    const r = evaluateFacilitySwitch(input({ target: { code: 'dashanddot', configured: true, visible: true, enabled: true } }));
    expect(failing(r)).toEqual(['TARGET_DIFFERENT:FAIL']);
  });

  it('refuses a facility this account cannot see, or that is disabled or unknown', () => {
    const t = (o: object) => ({ code: 'CWH', configured: true, visible: true, enabled: true, ...o });
    expect(failing(evaluateFacilitySwitch(input({ target: t({ visible: false }) })))).toEqual(['TARGET_ENABLED:FAIL']);
    expect(failing(evaluateFacilitySwitch(input({ target: t({ enabled: false }) })))).toEqual(['TARGET_ENABLED:FAIL']);
    expect(failing(evaluateFacilitySwitch(input({ target: t({ enabled: null }) })))).toEqual(['TARGET_ENABLED:UNKNOWN']);
    expect(failing(evaluateFacilitySwitch(input({ target: t({ configured: false }) })))).toEqual(['TARGET_ENABLED:FAIL']);
  });

  it('refuses while another switch holds the item', () => {
    const r = evaluateFacilitySwitch(input({ conflictingOperation: { id: 'a1b2c3d4-0000', status: 'VERIFICATION_PENDING' } }));
    expect(failing(r)).toEqual(['NO_CONFLICT:FAIL']);
  });

  it('refuses while writes are switched off, at either level', () => {
    expect(failing(evaluateFacilitySwitch(input({ writes: { env: false, connection: true } })))).toEqual(['WRITES_ENABLED:FAIL']);
    expect(failing(evaluateFacilitySwitch(input({ writes: { env: true, connection: false } })))).toEqual(['WRITES_ENABLED:FAIL']);
  });

  it('refuses closed orders and orders that do not carry this number', () => {
    expect(failing(evaluateFacilitySwitch(input({ order: { found: true, status: 'COMPLETE', displayMatches: true } }))))
      .toEqual(['ORDER_STATUS:FAIL']);
    expect(failing(evaluateFacilitySwitch(input({ order: { found: true, status: 'PROCESSING', displayMatches: false } }))))
      .toEqual(['ORDER_EXISTS:FAIL']);
  });

  it('never reports ready without a target', () => {
    const r = evaluateFacilitySwitch(input({ target: null, targetStock: null }));
    expect(r.ready).toBe(false);
    expect(failing(r)).toEqual(['TARGET_DIFFERENT:UNKNOWN', 'TARGET_ENABLED:UNKNOWN', 'STOCK:UNKNOWN']);
  });
});

describe('matchUniwareItemToLine', () => {
  const line = { lineLegacyId: '15000000000001', variantLegacyId: '49295244427434', sku: 'DD-KUR-L' };
  it('prefers the Shopify line id, then the variant id, then the SKU', () => {
    expect(matchUniwareItemToLine({ code: '15000000000001', sku: 'x' }, line)).toBe('LINE_ID');
    expect(matchUniwareItemToLine({ code: '15000000000001-2', sku: 'x' }, line)).toBe('LINE_ID');
    expect(matchUniwareItemToLine({ code: '99', sku: 'W/2769-L-49295244427434' }, line)).toBe('VARIANT');
    expect(matchUniwareItemToLine({ code: '99', sku: 'dd-kur-l' }, line)).toBe('SKU');
    expect(matchUniwareItemToLine({ code: '99', sku: 'OTHER' }, line)).toBeNull();
  });
});

describe('lifecycle', () => {
  it('only moves forward along the defined path', () => {
    expect(canTransitionSwitch('READY', 'EXECUTING')).toBe(true);
    expect(canTransitionSwitch('EXECUTING', 'READY')).toBe(false);
    expect(canTransitionSwitch('VERIFIED_SUCCESS', 'VERIFYING')).toBe(false);
    expect(canTransitionSwitch('EXECUTING', 'BLOCKED')).toBe(false);
  });
  it('holds the item until the outcome is known', () => {
    expect(holdsSwitchLock('VERIFICATION_PENDING')).toBe(true);
    expect(holdsSwitchLock('RECONCILIATION_REQUIRED')).toBe(false);
    expect(holdsSwitchLock('VERIFIED_FAILURE')).toBe(false);
  });
});

describe('readSwitchResponse', () => {
  it('keeps errors and warnings apart and never infers success', () => {
    const r = readSwitchResponse({
      successful: true, message: 'ok',
      errors: [], warnings: [{ code: 12, message: 'LOW_STOCK', description: 'stock is low' }],
    });
    expect(r.successful).toBe(true);
    expect(r.warnings).toEqual([{ code: '12', message: 'LOW_STOCK', description: 'stock is low' }]);
    expect(readSwitchResponse(null).successful).toBeNull();
    expect(readSwitchResponse({ errors: [{ message: 'INVALID' }] }).successful).toBeNull();
  });
});

describe('judgeSwitchVerification', () => {
  const base = { source: 'dashanddot', target: 'ST_KGF_Mumbai', itemFound: true } as const;
  it('succeeds only when the item shows the target', () => {
    expect(judgeSwitchVerification({ ...base, api: 'ACCEPTED', liveFacility: 'ST_KGF_Mumbai' }).outcome).toBe('SUCCESS');
    expect(judgeSwitchVerification({ ...base, api: 'NO_RESPONSE', liveFacility: 'ST_KGF_Mumbai' }).outcome).toBe('SUCCESS');
  });
  it('fails on an explicit rejection with the item unmoved', () => {
    expect(judgeSwitchVerification({ ...base, api: 'REJECTED', liveFacility: 'dashanddot' })).toMatchObject({ outcome: 'FAILURE', code: 'REJECTED' });
  });
  it('stays pending after a timeout or an acceptance that did not take', () => {
    expect(judgeSwitchVerification({ ...base, api: 'NO_RESPONSE', liveFacility: 'dashanddot' }).outcome).toBe('PENDING');
    expect(judgeSwitchVerification({ ...base, api: 'ACCEPTED', liveFacility: 'dashanddot' }).outcome).toBe('PENDING');
    expect(judgeSwitchVerification({ ...base, api: 'ACCEPTED', liveFacility: 'WH_Noida' }).code).toBe('UNEXPECTED_FACILITY');
    expect(judgeSwitchVerification({ ...base, api: 'ACCEPTED', itemFound: false, liveFacility: null }).outcome).toBe('PENDING');
  });
  it('lets an operator close an unapplied switch only when the item is still at the source', () => {
    expect(judgeSwitchVerification({ ...base, api: 'NO_RESPONSE', liveFacility: 'dashanddot', operatorConfirmedNotApplied: true }).outcome).toBe('FAILURE');
    expect(judgeSwitchVerification({ ...base, api: 'NO_RESPONSE', liveFacility: 'WH_Noida', operatorConfirmedNotApplied: true }).outcome).toBe('PENDING');
  });
});

describe('assessSwitchReconciliation', () => {
  it('needs no review without live demand', () => {
    expect(assessSwitchReconciliation({ demand: null, orders: [] }).required).toBe(false);
    expect(assessSwitchReconciliation({ demand: { demandNo: 'D1', status: 'CANCELLED' }, orders: [] }).required).toBe(false);
  });
  it('lists what production has already done', () => {
    const r = assessSwitchReconciliation({
      demand: { demandNo: 'DEM-1', status: 'IN_PRODUCTION' },
      orders: [{ moNo: 'MO-7', status: 'IN_PROGRESS', materialIssued: true, scanned: true, completedQty: 2, finishedGoodsInwarded: false, stage: 'Stitching' }],
    });
    expect(r.required).toBe(true);
    expect(r.reasons[1]).toBe('MO-7: at Stitching, materials issued, barcode scans recorded, 2 completed.');
  });
});
