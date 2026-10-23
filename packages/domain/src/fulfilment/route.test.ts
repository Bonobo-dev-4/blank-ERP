import { describe, expect, it } from 'vitest';
import { routeDemandLine, tallyRoutes } from './route';

const base = {
  demandQty: 2,
  homeFacilityCode: 'dashanddot',
  homeAvailableQty: 0,
  isSearchComplete: true,
};

describe('fulfilment routing', () => {
  it('dispatches when the stock is already here', () => {
    const d = routeDemandLine({ ...base, homeAvailableQty: 5 });
    expect(d.route).toBe('DISPATCH');
    expect(d.dispatchQty.toFixed()).toBe('2');
    expect(d.manufactureQty.toFixed()).toBe('0');
  });

  it('prefers stock here over stock elsewhere', () => {
    // No movement, no delay — even though another facility has more.
    const d = routeDemandLine({
      ...base,
      homeAvailableQty: 2,
      otherFacilities: [{ facilityCode: 'ST_KGF_Mumbai', availableQty: 99 }],
    });
    expect(d.route).toBe('DISPATCH');
    expect(d.switchQty.toFixed()).toBe('0');
  });

  it('switches facility rather than manufacturing', () => {
    // Moving a finished garment is days; making one is weeks.
    const d = routeDemandLine({
      ...base,
      otherFacilities: [{ facilityCode: 'WH_Second_Floor', availableQty: 3 }],
    });
    expect(d.route).toBe('SWITCH_FACILITY');
    expect(d.switchQty.toFixed()).toBe('2');
    expect(d.switchFromFacility).toBe('WH_Second_Floor');
  });

  it('picks the facility holding the most, deterministically', () => {
    const d = routeDemandLine({
      ...base,
      demandQty: 1,
      otherFacilities: [
        { facilityCode: 'ST_Dhanmill', availableQty: 1 },
        { facilityCode: 'ST_KGF_Mumbai', availableQty: 4 },
      ],
    });
    expect(d.switchFromFacility).toBe('ST_KGF_Mumbai');
  });

  it('breaks a tie by facility code so the answer is stable', () => {
    const d = routeDemandLine({
      ...base,
      demandQty: 1,
      otherFacilities: [
        { facilityCode: 'ST_Zora_Mall', availableQty: 2 },
        { facilityCode: 'ST_Dhanmill', availableQty: 2 },
      ],
    });
    expect(d.switchFromFacility).toBe('ST_Dhanmill');
  });

  it('splits a line across here, elsewhere and production', () => {
    const d = routeDemandLine({
      ...base,
      demandQty: 10,
      homeAvailableQty: 3,
      otherFacilities: [{ facilityCode: 'ST_Dhanmill', availableQty: 2 }],
    });
    expect(d.route).toBe('MANUFACTURE');
    expect(d.dispatchQty.toFixed()).toBe('3');
    expect(d.switchQty.toFixed()).toBe('2');
    expect(d.manufactureQty.toFixed()).toBe('5');
  });

  it('manufactures when nothing exists anywhere', () => {
    const d = routeDemandLine(base);
    expect(d.route).toBe('MANUFACTURE');
    expect(d.manufactureQty.toFixed()).toBe('2');
  });

  it('REFUSES to conclude manufacture on an incomplete search', () => {
    // The single most expensive mistake this logic can make: cutting fabric
    // for a garment already folded on a shelf in a facility we could not read.
    const d = routeDemandLine({ ...base, isSearchComplete: false });
    expect(d.route).toBe('NEEDS_CHECK');
    expect(d.manufactureQty.toFixed()).toBe('0');
    expect(d.isProvisional).toBe(true);
  });

  it('still dispatches on an incomplete search when stock is here', () => {
    // Not finding stock elsewhere does not make the stock in front of you
    // less real.
    const d = routeDemandLine({ ...base, homeAvailableQty: 5, isSearchComplete: false });
    expect(d.route).toBe('DISPATCH');
    expect(d.isProvisional).toBe(false);
  });

  it('still switches on an incomplete search when a facility answered', () => {
    const d = routeDemandLine({
      ...base,
      isSearchComplete: false,
      otherFacilities: [{ facilityCode: 'WH_Second_Floor', availableQty: 5 }],
    });
    expect(d.route).toBe('SWITCH_FACILITY');
  });

  it('lets an operator override available stock', () => {
    // Damaged, wrong shade, or a customisation. The person holding it knows
    // something the stock figure does not.
    const d = routeDemandLine({ ...base, homeAvailableQty: 99, isRejectedForDispatch: true });
    expect(d.route).toBe('MANUFACTURE');
    expect(d.manufactureQty.toFixed()).toBe('2');
    expect(d.dispatchQty.toFixed()).toBe('0');
  });

  it('asks for nothing when nothing is owed', () => {
    const d = routeDemandLine({ ...base, demandQty: 0 });
    expect(d.route).toBe('DISPATCH');
    expect(d.manufactureQty.toFixed()).toBe('0');
  });

  it('ignores a facility reporting negative stock', () => {
    const d = routeDemandLine({
      ...base,
      homeAvailableQty: -5,
      otherFacilities: [{ facilityCode: 'X', availableQty: -2 }],
    });
    expect(d.route).toBe('MANUFACTURE');
    expect(d.dispatchQty.toFixed()).toBe('0');
  });

  it('explains itself in words an operator can act on', () => {
    const d = routeDemandLine({
      ...base,
      otherFacilities: [{ facilityCode: 'ST_KGF_Mumbai', availableQty: 9 }],
    });
    expect(d.reason).toContain('ST_KGF_Mumbai');
  });
});

describe('tally', () => {
  it('counts each tab', () => {
    const decisions = [
      routeDemandLine({ ...base, homeAvailableQty: 5 }),
      routeDemandLine({ ...base, otherFacilities: [{ facilityCode: 'A', availableQty: 5 }] }),
      routeDemandLine(base),
      routeDemandLine({ ...base, isSearchComplete: false }),
    ];
    expect(tallyRoutes(decisions)).toEqual({
      dispatch: 1, switchFacility: 1, manufacture: 1, needsCheck: 1,
    });
  });
});
