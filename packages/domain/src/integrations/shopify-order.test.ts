import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors';
import {
  classifyShopifyOrder, isStaleOrderVersion, shopifyLineQuantities, throttleDelayMs,
} from './shopify-order';

describe('channel classification', () => {
  it('treats an order with a retail location as POS, and names the store', () => {
    const c = classifyShopifyOrder({
      retailLocationId: 'gid://shopify/Location/42',
      retailLocationName: 'DLF Promenade',
      sourceName: 'pos',
    });
    expect(c.channel).toBe('POS');
    expect(c.posLocationId).toBe('gid://shopify/Location/42');
    expect(c.posLocationName).toBe('DLF Promenade');
    expect(c.basis).toBe('RETAIL_LOCATION');
    // A structured field, so not a guess.
    expect(c.isHeuristic).toBe(false);
  });

  it('defaults a web order to ONLINE', () => {
    const c = classifyShopifyOrder({ sourceName: 'web' });
    expect(c.channel).toBe('ONLINE');
    expect(c.posLocationId).toBeNull();
    expect(c.isHeuristic).toBe(false);
  });

  it('falls back to sourceName for a draft POS order marked as paid', () => {
    // Shopify documents this: retailLocation is null for that flow.
    const c = classifyShopifyOrder({ retailLocationId: null, sourceName: 'pos' });
    expect(c.channel).toBe('POS');
    expect(c.posLocationId).toBeNull();
    expect(c.basis).toBe('SOURCE_NAME');
    // Flagged, because free text is the thing most likely to be wrong.
    expect(c.isHeuristic).toBe(true);
  });

  it('recognises the documented point-of-sale source names', () => {
    for (const source of ['pos', 'POS', 'shopify_pos', 'point_of_sale']) {
      expect(classifyShopifyOrder({ sourceName: source }).channel).toBe('POS');
    }
  });

  it('does not mistake mobile_app for POS', () => {
    // A phone is not a shop. Attributing an app order to a store would credit
    // a branch that never saw it.
    expect(classifyShopifyOrder({ sourceName: 'mobile_app' }).channel).toBe('ONLINE');
  });

  it('lets a custom tag override the channel', () => {
    // Bespoke is bespoke wherever it was taken: it changes what production
    // has to do, not merely where the order came from.
    const c = classifyShopifyOrder({
      retailLocationId: 'gid://shopify/Location/42',
      retailLocationName: 'Kala Ghoda Fort',
      tags: ['gift-wrap', 'Bespoke'],
    });
    expect(c.channel).toBe('CUSTOM');
    expect(c.basis).toBe('TAG');
    // The store is still recorded — it is where the order was taken.
    expect(c.posLocationName).toBe('Kala Ghoda Fort');
  });

  it('ignores unrelated tags', () => {
    expect(classifyShopifyOrder({ sourceName: 'web', tags: ['vip', 'gift'] }).channel).toBe('ONLINE');
  });

  it('classifies an order with nothing to go on as ONLINE', () => {
    const c = classifyShopifyOrder({});
    expect(c.channel).toBe('ONLINE');
    expect(c.basis).toBe('DEFAULT');
  });
});

describe('line quantities', () => {
  it('uses currentQuantity, not quantity, to drive demand', () => {
    // 10 ordered, 3 refunded. Manufacturing 10 would make stock nobody wants.
    const q = shopifyLineQuantities({ quantity: 10, currentQuantity: 7 });
    expect(q.orderedQty.toFixed()).toBe('10');
    expect(q.cancelledQty.toFixed()).toBe('3');
    expect(q.demandQty.toFixed()).toBe('7');
  });

  it('subtracts what has already been fulfilled', () => {
    const q = shopifyLineQuantities({ quantity: 10, currentQuantity: 10, unfulfilledQuantity: 4 });
    expect(q.fulfilledQty.toFixed()).toBe('6');
    // Only the 4 still owed need making.
    expect(q.demandQty.toFixed()).toBe('4');
  });

  it('demands nothing for a cancelled order', () => {
    const q = shopifyLineQuantities({ quantity: 10, currentQuantity: 10, orderCancelled: true });
    expect(q.demandQty.toFixed()).toBe('0');
    expect(q.orderedQty.toFixed()).toBe('10');
  });

  it('demands nothing for a fully refunded line', () => {
    const q = shopifyLineQuantities({ quantity: 5, currentQuantity: 0 });
    expect(q.cancelledQty.toFixed()).toBe('5');
    expect(q.demandQty.toFixed()).toBe('0');
  });

  it('refuses a current quantity above the quantity ordered', () => {
    // Shopify does not do this; trusting it silently would manufacture more
    // than was ever ordered.
    expect(() => shopifyLineQuantities({ quantity: 5, currentQuantity: 6 })).toThrow(ValidationError);
  });

  it('refuses negative quantities', () => {
    expect(() => shopifyLineQuantities({ quantity: -1, currentQuantity: 0 })).toThrow(ValidationError);
  });

  it('never reports a negative fulfilled quantity', () => {
    const q = shopifyLineQuantities({ quantity: 5, currentQuantity: 5, unfulfilledQuantity: 9 });
    expect(q.fulfilledQty.toFixed()).toBe('0');
  });
});

describe('stale version guard', () => {
  const earlier = new Date('2026-10-01T10:00:00Z');
  const later = new Date('2026-10-01T11:00:00Z');

  it('rejects an older version of an order', () => {
    // Shopify delivers updates out of order often enough to matter, and an
    // older version overwriting a newer one resurrects cancelled lines.
    expect(isStaleOrderVersion(earlier, later)).toBe(true);
  });

  it('accepts a newer version', () => {
    expect(isStaleOrderVersion(later, earlier)).toBe(false);
  });

  it('accepts a re-delivery of the same version', () => {
    // Same timestamp is a replay, which is safe: the import is idempotent.
    expect(isStaleOrderVersion(later, later)).toBe(false);
  });

  it('accepts anything when either side is unknown', () => {
    expect(isStaleOrderVersion(null, later)).toBe(false);
    expect(isStaleOrderVersion(later, null)).toBe(false);
  });
});

describe('cost-based throttling', () => {
  const state = { maximumAvailable: 1000, currentlyAvailable: 900, restoreRate: 100 };

  it('does not wait when the budget covers the next call', () => {
    expect(throttleDelayMs(state, 50)).toBe(0);
  });

  it('waits long enough for the bucket to refill', () => {
    // 10 available, 110 needed (100 + 10% margin) -> ~100 points short at
    // 100/s -> ~1000 ms. The contract is that it never UNDER-waits, so it
    // rounds up; asserting an exact millisecond would be asserting a
    // floating-point artefact rather than the behaviour.
    const wait = throttleDelayMs({ ...state, currentlyAvailable: 10 }, 100);
    expect(wait).toBeGreaterThanOrEqual(1000);
    expect(wait).toBeLessThan(1100);
  });

  it('keeps a margin so a burst does not land exactly on empty', () => {
    // Exactly enough without the margin; with it, a short wait.
    expect(throttleDelayMs({ ...state, currentlyAvailable: 100 }, 100)).toBeGreaterThan(0);
  });

  it('does not wait when the throttle state is unknown', () => {
    // A first call has no state. Blocking it would deadlock the import.
    expect(throttleDelayMs(null, 100)).toBe(0);
    expect(throttleDelayMs(undefined, 100)).toBe(0);
  });

  it('does not divide by zero on a zero restore rate', () => {
    expect(throttleDelayMs({ ...state, currentlyAvailable: 0, restoreRate: 0 }, 100)).toBe(0);
  });

  it('scales the wait with the size of the request', () => {
    const small = throttleDelayMs({ ...state, currentlyAvailable: 0 }, 50);
    const large = throttleDelayMs({ ...state, currentlyAvailable: 0 }, 500);
    expect(large).toBeGreaterThan(small);
  });
});
