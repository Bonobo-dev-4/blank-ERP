import { describe, expect, it } from 'vitest';
import { IllegalStateError, InvariantViolation, ValidationError } from '../errors';
import {
  assertShadeMixAllowed, deriveRollStatus, planRollIssue, planRollReturn,
  rollAvailableLength, selectRollsForLength, type RollState,
} from './rolls';

const roll = (over: Partial<RollState> = {}): RollState => ({
  id: 'r1', rollNo: 'ROLL-000001', originalLength: '100', currentLength: '100',
  reservedLength: '0', status: 'AVAILABLE', shade: 'IND-BLUE-A', width: '58',
  ...over,
});

describe('fabric roll lengths - the specification example', () => {
  it('leaves 75 m after a 25 m issue from a 100 m roll', () => {
    const plan = planRollIssue(roll(), '25');
    expect(plan.issuedLength.toFixed()).toBe('25');
    expect(plan.newCurrentLength.toFixed()).toBe('75');
    expect(plan.newStatus).toBe('PARTIALLY_ISSUED');
  });

  it('supports repeated partial issues down to exhaustion', () => {
    let r = roll();
    for (const take of ['25', '30', '20']) {
      const p = planRollIssue(r, take);
      r = { ...r, currentLength: p.newCurrentLength, reservedLength: p.newReservedLength, status: p.newStatus };
    }
    expect(r.currentLength.toString()).toBe('25');
    const last = planRollIssue(r, '25');
    expect(last.newCurrentLength.toFixed()).toBe('0');
    expect(last.newStatus).toBe('EXHAUSTED');
  });

  it('refuses to issue more than the roll physically holds', () => {
    expect(() => planRollIssue(roll({ currentLength: '75' }), '76')).toThrow(InvariantViolation);
    expect(() => planRollIssue(roll({ currentLength: '75' }), '76')).toThrow(/length physically remaining/);
  });

  it('refuses a non-positive issue', () => {
    expect(() => planRollIssue(roll(), '0')).toThrow(ValidationError);
  });

  it('will not issue from a roll that is not in an issuable state', () => {
    for (const status of ['RECEIVED', 'QC_PENDING', 'BLOCKED', 'EXHAUSTED', 'RETURNED_TO_SUPPLIER'] as const) {
      expect(() => planRollIssue(roll({ status }), '1')).toThrow(IllegalStateError);
    }
  });

  it('respects a reservation held by another order', () => {
    // 100 m on the roll, 80 reserved elsewhere: 20 may be taken.
    expect(() => planRollIssue(roll({ reservedLength: '80' }), '21')).toThrow(/unreserved roll length/);
    expect(planRollIssue(roll({ reservedLength: '80' }), '20').newCurrentLength.toFixed()).toBe('80');
  });

  it('releases the reservation as the fabric physically leaves', () => {
    const plan = planRollIssue(roll({ reservedLength: '60' }), '60', '60');
    // 40 unreserved used first, so only 20 comes out of the reservation.
    expect(plan.newReservedLength.toFixed()).toBe('40');
    expect(plan.newCurrentLength.toFixed()).toBe('40');
  });
});

describe('partial roll return', () => {
  it('puts unused fabric back without creating duplicate stock', () => {
    const plan = planRollReturn(roll({ currentLength: '75' }), '5');
    expect(plan.newCurrentLength.toFixed()).toBe('80');
    expect(plan.newStatus).toBe('PARTIALLY_ISSUED');
  });

  it('refuses a return that would make the roll longer than it arrived', () => {
    expect(() => planRollReturn(roll({ currentLength: '75' }), '26')).toThrow(InvariantViolation);
    expect(() => planRollReturn(roll({ currentLength: '75' }), '26')).toThrow(/longer than it was received/);
  });

  it('restores AVAILABLE when the whole issue comes back', () => {
    expect(planRollReturn(roll({ currentLength: '75', status: 'PARTIALLY_ISSUED' }), '25').newStatus).toBe('AVAILABLE');
  });

  it('refuses a non-positive return', () => {
    expect(() => planRollReturn(roll(), '0')).toThrow(ValidationError);
  });
});

describe('deriveRollStatus', () => {
  it('derives status from length rather than trusting the stored value', () => {
    expect(deriveRollStatus(roll({ currentLength: '0', status: 'AVAILABLE' }))).toBe('EXHAUSTED');
    expect(deriveRollStatus(roll({ currentLength: '50', status: 'AVAILABLE' }))).toBe('PARTIALLY_ISSUED');
    expect(deriveRollStatus(roll({ currentLength: '100', status: 'PARTIALLY_ISSUED' }))).toBe('AVAILABLE');
  });

  it('preserves administrative statuses', () => {
    expect(deriveRollStatus(roll({ currentLength: '50', status: 'BLOCKED' }))).toBe('BLOCKED');
    expect(deriveRollStatus(roll({ currentLength: '100', status: 'QC_PENDING' }))).toBe('QC_PENDING');
  });

  it('reports unreserved length', () => {
    expect(rollAvailableLength(roll({ currentLength: '75', reservedLength: '20' })).toFixed()).toBe('55');
  });
});

describe('selectRollsForLength', () => {
  const rolls: RollState[] = [
    roll({ id: 'full-a', rollNo: 'R-A', currentLength: '100', status: 'AVAILABLE' }),
    roll({ id: 'part-b', rollNo: 'R-B', currentLength: '30', status: 'PARTIALLY_ISSUED' }),
    roll({ id: 'part-c', rollNo: 'R-C', currentLength: '12', status: 'PARTIALLY_ISSUED' }),
    roll({ id: 'other-shade', rollNo: 'R-D', currentLength: '100', shade: 'IND-BLUE-B' }),
  ];

  it('finishes remnants before opening a full roll', () => {
    const sel = selectRollsForLength('40', rolls, { requiredShade: 'IND-BLUE-A' });
    expect(sel.rolls.map((r) => r.rollId)).toEqual(['part-c', 'part-b']);
    expect(sel.selectedLength.toFixed()).toBe('40');
    expect(sel.shortfallLength.toFixed()).toBe('0');
  });

  it('reports a shortfall rather than over-promising', () => {
    const sel = selectRollsForLength('500', rolls, { requiredShade: 'IND-BLUE-A' });
    expect(sel.selectedLength.toFixed()).toBe('142');
    expect(sel.shortfallLength.toFixed()).toBe('358');
  });

  it('honours a shade requirement', () => {
    const sel = selectRollsForLength('250', rolls, { requiredShade: 'IND-BLUE-B' });
    expect(sel.rolls.map((r) => r.rollId)).toEqual(['other-shade']);
    expect(sel.shadesUsed).toEqual(['IND-BLUE-B']);
  });

  it('honours a minimum usable width', () => {
    const narrow = [...rolls, roll({ id: 'narrow', currentLength: '200', width: '44' })];
    const sel = selectRollsForLength('300', narrow, { minimumWidth: '58' });
    expect(sel.rolls.some((r) => r.rollId === 'narrow')).toBe(false);
  });
});

describe('shade mixing', () => {
  it('allows a single shade', () => {
    expect(() => assertShadeMixAllowed(['IND-BLUE-A'])).not.toThrow();
    expect(() => assertShadeMixAllowed([])).not.toThrow();
  });

  it('refuses to mix shades without an approval', () => {
    expect(() => assertShadeMixAllowed(['IND-BLUE-A', 'IND-BLUE-B'])).toThrow(IllegalStateError);
    expect(() => assertShadeMixAllowed(['A', 'B'], { approved: true })).toThrow(/approved exception/);
  });

  it('allows a mix once someone has approved it', () => {
    expect(() => assertShadeMixAllowed(['A', 'B'], { approved: true, approvedByUserId: 'u1' })).not.toThrow();
  });
});
