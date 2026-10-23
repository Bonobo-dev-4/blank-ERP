import { describe, expect, it } from 'vitest';
import {
  assessLineAvailability, demandFingerprint, normaliseCommerceRef,
  reconcileIncomingDemand, sourceLineKey,
} from './dedupe';

describe('source line identity', () => {
  it('is stable and distinct per source line', () => {
    const a = sourceLineKey({ sourceSystem: 'SHOPIFY', sourceDocType: 'SHOPIFY_ORDER', sourceDocId: 'gid://1', sourceLineId: 'gid://1/l1' });
    const b = sourceLineKey({ sourceSystem: 'SHOPIFY', sourceDocType: 'SHOPIFY_ORDER', sourceDocId: 'gid://1', sourceLineId: 'gid://1/l2' });
    expect(a).not.toBe(b);
    expect(a).toBe(sourceLineKey({ sourceSystem: 'SHOPIFY', sourceDocType: 'SHOPIFY_ORDER', sourceDocId: 'gid://1', sourceLineId: 'gid://1/l1' }));
  });
});

describe('normaliseCommerceRef', () => {
  it('reduces the same order written differently to one value', () => {
    for (const ref of ['#158420', '158420', 'DD-158420', ' #158420 ']) {
      expect(normaliseCommerceRef(ref)).toContain('158420');
    }
    expect(normaliseCommerceRef('#158420')).toBe('158420');
    expect(normaliseCommerceRef('158420')).toBe('158420');
  });
});

describe('cross-system demand deduplication', () => {
  it('collapses the same Shopify order arriving via Unicommerce onto one demand', () => {
    const viaShopify = demandFingerprint({
      productVariantId: 'v-jacket-l', commerceOrderRef: '#158420', commerceLineRef: 'JACKET-L',
    });
    const viaUnicommerce = demandFingerprint({
      productVariantId: 'v-jacket-l', commerceOrderRef: '158420', commerceLineRef: 'JACKET-L',
    });
    expect(viaShopify).toBe(viaUnicommerce);
  });

  it('keeps different lines of the same order separate', () => {
    const jacket = demandFingerprint({ productVariantId: 'v1', commerceOrderRef: '#158420', commerceLineRef: 'JACKET-L' });
    const trouser = demandFingerprint({ productVariantId: 'v2', commerceOrderRef: '#158420', commerceLineRef: 'TROUSER-M' });
    expect(jacket).not.toBe(trouser);
  });

  it('keeps the same SKU in different orders separate', () => {
    const a = demandFingerprint({ productVariantId: 'v1', commerceOrderRef: '#158420', commerceLineRef: 'JACKET-L' });
    const b = demandFingerprint({ productVariantId: 'v1', commerceOrderRef: '#158421', commerceLineRef: 'JACKET-L' });
    expect(a).not.toBe(b);
  });

  it('falls back to the external SKU when the variant is unmapped', () => {
    const f = demandFingerprint({ externalSku: 'dd-krt-001-m', commerceOrderRef: '#1', commerceLineRef: 'L1' });
    expect(f).toBe(demandFingerprint({ externalSku: 'DD-KRT-001-M', commerceOrderRef: '#1', commerceLineRef: 'L1' }));
  });
});

describe('reconcileIncomingDemand', () => {
  it('creates demand for a line never seen before', () => {
    expect(reconcileIncomingDemand({ incomingQty: '2' }).action).toBe('CREATE');
  });

  it('ignores a duplicate webhook delivery of the same line and quantity', () => {
    const r = reconcileIncomingDemand({
      existingDemand: { id: 'd1', requestedQty: '2' },
      existingMapping: { sourceLineQty: '2' },
      incomingQty: '2',
    });
    expect(r.action).toBe('IGNORE_DUPLICATE');
  });

  it('attaches a second source system to existing demand rather than duplicating it', () => {
    const r = reconcileIncomingDemand({
      existingDemand: { id: 'd1', requestedQty: '2' }, existingMapping: null, incomingQty: '2',
    });
    expect(r.action).toBe('ATTACH_TO_EXISTING');
    expect(r.reason).toMatch(/instead of creating duplicate demand/);
  });

  it('detects an externally amended quantity and reports the delta', () => {
    const up = reconcileIncomingDemand({
      existingDemand: { id: 'd1', requestedQty: '2' }, existingMapping: { sourceLineQty: '2' }, incomingQty: '5',
    });
    expect(up.action).toBe('UPDATE_QUANTITY');
    expect(up.quantityDelta!.toFixed()).toBe('3');

    const down = reconcileIncomingDemand({
      existingDemand: { id: 'd1', requestedQty: '5' }, existingMapping: { sourceLineQty: '5' }, incomingQty: '1',
    });
    expect(down.quantityDelta!.toFixed()).toBe('-4');
  });
});

describe('order line availability - the specification example', () => {
  const now = new Date('2026-10-21T10:00:00Z');
  const fresh = new Date('2026-10-21T09:55:00Z');

  it('Item A: ordered 1, 5 available at Head Office, no production needed once allocated', () => {
    const a = assessLineAvailability({ orderedQty: '1', confirmedAllocationQty: '1', asOf: now, snapshotAt: fresh });
    expect(a.status).toBe('ALLOCATION_CONFIRMED');
    expect(a.manufacturingQty.toFixed()).toBe('0');
  });

  it('Item B: ordered 1, none available, 1 must be made', () => {
    const b = assessLineAvailability({ orderedQty: '1', snapshotAvailableQty: '0', snapshotAt: fresh, asOf: now });
    expect(b.status).toBe('OUT_OF_STOCK');
    expect(b.manufacturingQty.toFixed()).toBe('1');
  });

  it('Item C: ordered 2, 1 available, 1 must be made once the 1 is allocated', () => {
    const c = assessLineAvailability({ orderedQty: '2', confirmedAllocationQty: '1', snapshotAt: fresh, asOf: now });
    expect(c.status).toBe('PARTIALLY_AVAILABLE');
    expect(c.manufacturingQty.toFixed()).toBe('1');
  });

  it('does not net off stock that has only been seen, not reserved', () => {
    // This is the rule: availability is not a reservation.
    const c = assessLineAvailability({ orderedQty: '2', snapshotAvailableQty: '1', snapshotAt: fresh, asOf: now });
    expect(c.status).toBe('ALLOCATION_PENDING');
    expect(c.availableQty.toFixed()).toBe('1');
    // The full 2 still needs manufacturing until an allocation is confirmed.
    expect(c.manufacturingQty.toFixed()).toBe('2');
  });

  it('treats a stale snapshot as stale', () => {
    const stale = assessLineAvailability({
      orderedQty: '1', snapshotAvailableQty: '5',
      snapshotAt: new Date('2026-10-20T10:00:00Z'), asOf: now,
    });
    expect(stale.isSnapshotStale).toBe(true);
    expect(stale.snapshotAgeSeconds).toBe(86_400);
  });

  it('assumes nothing when the stock check itself failed', () => {
    const f = assessLineAvailability({ orderedQty: '3', checkFailed: true, asOf: now });
    expect(f.status).toBe('INVENTORY_CHECK_FAILED');
    expect(f.manufacturingQty.toFixed()).toBe('3');
  });

  it('nets off a cancelled quantity', () => {
    const r = assessLineAvailability({ orderedQty: '5', cancelledQty: '2', snapshotAvailableQty: '0', snapshotAt: fresh, asOf: now });
    expect(r.manufacturingQty.toFixed()).toBe('3');
  });

  it('is PENDING_CHECK before any snapshot exists', () => {
    expect(assessLineAvailability({ orderedQty: '1', asOf: now }).status).toBe('PENDING_CHECK');
  });
});
