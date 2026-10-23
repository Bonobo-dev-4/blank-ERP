import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors';
import {
  classifyFacilityProbe, facilityKind, isTokenExpiring, readInventorySnapshot,
  readUniwareFailure, shopifyVariantIdFromUniwareSku, splitSaleOrderWindows,
  summariseAvailability, tokenExpiryFrom, SALE_ORDER_MAX_WINDOW_DAYS,
} from './unicommerce';

describe('response envelope', () => {
  it('treats successful:true as success', () => {
    expect(readUniwareFailure({ successful: true, errors: [] })).toBeNull();
  });

  it('reports a business failure that arrived with HTTP 200', () => {
    // Measured against the live tenant: this is an HTTP 200 response.
    const f = readUniwareFailure({
      successful: false,
      errors: [{ code: 60004, message: 'INVENTORY_NOT_AVAILABLE', description: 'Could not find any any items' }],
    });
    expect(f?.code).toBe('INVENTORY_NOT_AVAILABLE');
    expect(f?.description).toBe('Could not find any any items');
  });

  it('collects the field names of a validation failure', () => {
    const f = readUniwareFailure({
      successful: false,
      errors: [
        { fieldName: 'dateType', message: 'MISSING_REQUIRED_PARAMETERS' },
        { fieldName: 'facilityStatus', message: 'MISSING_REQUIRED_PARAMETERS' },
      ],
    });
    expect(f?.fieldNames).toEqual(['dateType', 'facilityStatus']);
    expect(f?.all).toHaveLength(2);
  });

  it('refuses an empty body rather than calling it success', () => {
    // A proxy that drops a response must never read as "it worked".
    expect(readUniwareFailure(null)?.code).toBe('EMPTY_RESPONSE');
    expect(readUniwareFailure(undefined)?.code).toBe('EMPTY_RESPONSE');
  });

  it('refuses a body with no successful flag at all', () => {
    expect(readUniwareFailure({ message: 'hello' })?.code).toBe('MALFORMED_RESPONSE');
  });
});

describe('facility identity', () => {
  it('reads operationalType, not type', () => {
    // Measured: EVERY facility in this tenant reports type WAREHOUSE, retail
    // shops included. Trusting `type` puts eleven shops in the wrong bucket.
    expect(facilityKind({ type: 'WAREHOUSE', operationalType: 'STORE' })).toBe('STORE');
    expect(facilityKind({ type: 'WAREHOUSE', operationalType: 'WAREHOUSE' })).toBe('WAREHOUSE');
  });

  it('classifies WH_Second_Floor as the store it actually is', () => {
    // A WH_ prefix, type WAREHOUSE, operationalType STORE - and it holds real
    // stock, so getting this wrong misroutes inventory.
    expect(facilityKind({ type: 'WAREHOUSE', operationalType: 'STORE' })).toBe('STORE');
  });

  it('says UNKNOWN rather than guessing', () => {
    expect(facilityKind({ type: 'WAREHOUSE' })).toBe('UNKNOWN');
    expect(facilityKind({ operationalType: null })).toBe('UNKNOWN');
  });

  it('separates a wrong code from an inaccessible one', () => {
    // The distinction that stops a facility master from silently deleting five
    // real facilities this account merely cannot see.
    expect(classifyFacilityProbe({ successful: true })).toBe('VALID');
    expect(classifyFacilityProbe({ successful: false, errors: [{ message: 'FACILITY_ACCESS_DENIED' }] }))
      .toBe('ACCESS_DENIED');
    expect(classifyFacilityProbe({ successful: false, errors: [{ message: 'INVALID_FACILITY_CODE' }] }))
      .toBe('INVALID_CODE');
  });

  it('does not mistake an unrelated failure for a verdict on the code', () => {
    expect(classifyFacilityProbe({ successful: false, errors: [{ message: 'SOMETHING_ELSE' }] })).toBe('ERROR');
  });
});

describe('inventory reading', () => {
  it('does not report six held units as nothing', () => {
    // The real snapshot for W/2769-L-49295244427434 at the default facility.
    const r = readInventorySnapshot(
      { itemTypeSKU: 'W/2769-L-49295244427434', inventory: 0, inventoryBlocked: 1, pendingInventoryAssessment: 5 },
      'dashanddot',
    );
    expect(r.availableQty.toFixed()).toBe('0');
    // Zero available, but six units are in the building. Different problem.
    expect(r.heldQty.toFixed()).toBe('6');
  });

  it('subtracts stock already committed to orders', () => {
    const r = readInventorySnapshot({ itemTypeSKU: 'X', inventory: 10, openSale: 4 }, 'WH_Noida');
    expect(r.sellableQty.toFixed()).toBe('10');
    expect(r.availableQty.toFixed()).toBe('6');
  });

  it('never reports negative availability', () => {
    // Oversold in Uniware. Promising -2 garments is worse than promising none.
    const r = readInventorySnapshot({ itemTypeSKU: 'X', inventory: 3, openSale: 5 }, 'WH_Noida');
    expect(r.availableQty.toFixed()).toBe('0');
  });

  it('counts quarantined and bad stock as held, never as available', () => {
    const r = readInventorySnapshot(
      { itemTypeSKU: 'X', inventory: 0, quarantinedInventory: 2, badInventory: 3, putawayPending: 1 },
      'WH_Second_Floor',
    );
    expect(r.availableQty.toFixed()).toBe('0');
    expect(r.heldQty.toFixed()).toBe('6');
  });
});

describe('availability across facilities', () => {
  const reading = (facilityCode: string, inventory: number) =>
    readInventorySnapshot({ itemTypeSKU: 'X', inventory }, facilityCode);

  it('ranks facilities by how much they actually have', () => {
    const s = summariseAvailability([reading('ST_KGF_Mumbai', 1), reading('WH_Second_Floor', 4)], []);
    expect(s.found.map((f) => f.facilityCode)).toEqual(['WH_Second_Floor', 'ST_KGF_Mumbai']);
    expect(s.totalAvailable.toFixed()).toBe('5');
  });

  it('omits facilities that have none', () => {
    const s = summariseAvailability([reading('WH_Noida', 0), reading('ST_Dhanmill', 2)], []);
    expect(s.found.map((f) => f.facilityCode)).toEqual(['ST_Dhanmill']);
  });

  it('reports a search as INCOMPLETE when a facility could not be checked', () => {
    // The service account cannot see five of seventeen facilities. "Nowhere
    // else" is only true if everywhere was actually asked.
    const s = summariseAvailability([reading('WH_Noida', 0)], ['MBO', 'CWH']);
    expect(s.isComplete).toBe(false);
    expect(s.unchecked).toEqual(['CWH', 'MBO']);
    expect(s.totalAvailable.toFixed()).toBe('0');
  });

  it('is complete only when nothing was skipped', () => {
    expect(summariseAvailability([reading('WH_Noida', 1)], []).isComplete).toBe(true);
  });

  it('breaks ties by facility code so the result is deterministic', () => {
    const s = summariseAvailability([reading('ST_Zora_Mall', 2), reading('ST_Dhanmill', 2)], []);
    expect(s.found.map((f) => f.facilityCode)).toEqual(['ST_Dhanmill', 'ST_Zora_Mall']);
  });
});

describe('sale order search windows', () => {
  it('leaves a short range as a single call', () => {
    const w = splitSaleOrderWindows(new Date('2026-10-01'), new Date('2026-10-20'));
    expect(w).toHaveLength(1);
  });

  it('splits a year into windows the API will accept', () => {
    // Measured cap: SALE_ORDER_SEARCH_DATE_RANGE_LIMIT_EXCEEDED above 31 days.
    const w = splitSaleOrderWindows(new Date('2026-01-01'), new Date('2026-12-31'));
    expect(w.length).toBeGreaterThan(11);
    for (const win of w) {
      const days = (win.to.getTime() - win.from.getTime()) / 86_400_000;
      expect(days).toBeLessThanOrEqual(SALE_ORDER_MAX_WINDOW_DAYS);
    }
  });

  it('covers the whole range without a gap', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const to = new Date('2026-06-30T00:00:00Z');
    const w = splitSaleOrderWindows(from, to);
    expect(w[0].from.getTime()).toBe(from.getTime());
    expect(w[w.length - 1].to.getTime()).toBe(to.getTime());
    for (let i = 1; i < w.length; i += 1) {
      // Each window starts 1ms after the previous ended: no gap, no overlap.
      expect(w[i].from.getTime()).toBe(w[i - 1].to.getTime() + 1);
    }
  });

  it('handles a range of one instant', () => {
    const d = new Date('2026-10-01T12:00:00Z');
    expect(splitSaleOrderWindows(d, d)).toHaveLength(1);
  });

  it('refuses an inverted range rather than returning nothing', () => {
    // Returning [] would silently import zero orders and look like "no orders".
    expect(() => splitSaleOrderWindows(new Date('2026-10-20'), new Date('2026-10-01')))
      .toThrow(ValidationError);
  });

  it('refuses an invalid date', () => {
    expect(() => splitSaleOrderWindows(new Date('nonsense'), new Date())).toThrow(ValidationError);
  });
});

describe('SKU to Shopify variant', () => {
  it('extracts the variant id this tenant embeds in the SKU', () => {
    expect(shopifyVariantIdFromUniwareSku('W/2769-L-49295244427434')).toBe('49295244427434');
  });

  it('returns null rather than inventing an id', () => {
    // A SKU without the suffix is a mapping for a human to resolve.
    expect(shopifyVariantIdFromUniwareSku('W/274/275')).toBeNull();
    expect(shopifyVariantIdFromUniwareSku('')).toBeNull();
    expect(shopifyVariantIdFromUniwareSku(null)).toBeNull();
  });

  it('does not mistake a size or colourway for a variant id', () => {
    expect(shopifyVariantIdFromUniwareSku('W/2769-L-42')).toBeNull();
    expect(shopifyVariantIdFromUniwareSku('SHIRT-32')).toBeNull();
  });
});

describe('token lifetime', () => {
  const now = new Date('2026-10-23T12:00:00Z');

  it('refreshes before the token actually expires', () => {
    // Expiring mid-flight fails a call that may already have changed inventory.
    expect(isTokenExpiring(new Date('2026-10-23T12:01:00Z'), now)).toBe(true);
  });

  it('keeps a token with plenty of life left', () => {
    expect(isTokenExpiring(new Date('2026-10-23T18:00:00Z'), now)).toBe(false);
  });

  it('treats an absent token as expiring', () => {
    expect(isTokenExpiring(null, now)).toBe(true);
    expect(isTokenExpiring(undefined, now)).toBe(true);
  });

  it('computes expiry from the measured ~7 hour lifetime', () => {
    const e = tokenExpiryFrom(25528, now);
    expect(e.getTime()).toBe(now.getTime() + 25_528_000);
    expect(isTokenExpiring(e, now)).toBe(false);
  });

  it('refuses a non-positive lifetime', () => {
    expect(() => tokenExpiryFrom(0, now)).toThrow(ValidationError);
    expect(() => tokenExpiryFrom(-1, now)).toThrow(ValidationError);
  });
});
