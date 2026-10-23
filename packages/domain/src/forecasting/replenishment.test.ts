import { describe, expect, it } from 'vitest';
import {
  classifyStockLevel, computeVelocity, notificationDedupeKey, suggestReplenishment,
} from './replenishment';

const weeks = (units: number[], endingAt = new Date('2026-10-21T00:00:00Z')) =>
  units.map((u, i) => ({
    weekStart: new Date(endingAt.getTime() - (units.length - 1 - i) * 7 * 86_400_000),
    unitsSold: String(u),
  }));

describe('computeVelocity', () => {
  it('averages a flat history to the same figure under either method', () => {
    const obs = weeks([10, 10, 10, 10]);
    const asOf = new Date('2026-10-21T00:00:00Z');
    expect(computeVelocity(obs, { method: 'MOVING_AVERAGE', asOf }).salesVelocity.toFixed()).toBe('10');
    expect(computeVelocity(obs, { method: 'WEIGHTED_VELOCITY', asOf }).salesVelocity.toFixed()).toBe('10');
  });

  it('weights recent weeks more heavily', () => {
    // A style that is accelerating: the weighted figure must exceed the mean.
    const obs = weeks([2, 4, 8, 16]);
    const asOf = new Date('2026-10-21T00:00:00Z');
    const mean = computeVelocity(obs, { method: 'MOVING_AVERAGE', asOf }).salesVelocity;
    const weighted = computeVelocity(obs, { method: 'WEIGHTED_VELOCITY', asOf }).salesVelocity;
    expect(mean.toFixed()).toBe('7.5');
    expect(weighted.greaterThan(mean)).toBe(true);
  });

  it('ignores observations outside the look-back window', () => {
    const asOf = new Date('2026-10-21T00:00:00Z');
    const obs = [
      { weekStart: new Date('2025-01-01T00:00:00Z'), unitsSold: '1000' },
      ...weeks([10, 10], asOf),
    ];
    const r = computeVelocity(obs, { lookbackDays: 28, asOf });
    expect(r.observationCount).toBe(2);
    expect(r.salesVelocity.toFixed()).toBe('10');
  });

  it('reports low confidence on thin history', () => {
    const asOf = new Date('2026-10-21T00:00:00Z');
    const thin = computeVelocity(weeks([10], asOf), { lookbackDays: 56, asOf });
    expect(thin.confidence.lessThan('0.2')).toBe(true);
    const full = computeVelocity(weeks([10, 10, 10, 10, 10, 10, 10, 10], asOf), { lookbackDays: 56, asOf });
    expect(full.confidence.toFixed()).toBe('1');
  });

  it('returns zero with no history rather than guessing', () => {
    const r = computeVelocity([], { asOf: new Date('2026-10-21T00:00:00Z') });
    expect(r.salesVelocity.toFixed()).toBe('0');
    expect(r.confidence.toFixed()).toBe('0');
  });
});

describe('suggestReplenishment - the specification example', () => {
  // Dhan Mill store, DD-KRT-001-M: 10/week, 4 on hand, 14 day lead time.
  it('recommends 16 units', () => {
    const s = suggestReplenishment({ salesVelocity: '10', leadTimeDays: 14, availableQty: '4' });
    expect(s.leadTimeDemandQty.toFixed()).toBe('20');
    expect(s.suggestedQty.toFixed()).toBe('16');
    expect(s.rationale).toContain('velocity 10.00/week');
  });

  it('adds configured safety stock', () => {
    const s = suggestReplenishment({ salesVelocity: '10', leadTimeDays: 14, availableQty: '4', safetyStockDays: 7 });
    expect(s.safetyStockQty.toFixed()).toBe('10');
    expect(s.suggestedQty.toFixed()).toBe('26');
  });

  it('subtracts confirmed incoming stock so nothing is ordered twice', () => {
    const s = suggestReplenishment({ salesVelocity: '10', leadTimeDays: 14, availableQty: '4', incomingQty: '10' });
    expect(s.suggestedQty.toFixed()).toBe('6');
  });

  it('suggests nothing when the position already covers the horizon', () => {
    const s = suggestReplenishment({ salesVelocity: '10', leadTimeDays: 14, availableQty: '50' });
    expect(s.suggestedQty.toFixed()).toBe('0');
  });

  it('applies a seasonal index', () => {
    const s = suggestReplenishment({ salesVelocity: '10', leadTimeDays: 14, availableQty: '4', seasonalIndex: '1.5' });
    expect(s.leadTimeDemandQty.toFixed()).toBe('30');
    expect(s.suggestedQty.toFixed()).toBe('26');
  });

  it('rounds up to whole garments and respects order rules', () => {
    const s = suggestReplenishment({ salesVelocity: '10', leadTimeDays: 10, availableQty: '0' });
    // 10/7 x 10 = 14.2857 -> 15 whole garments.
    expect(s.suggestedQty.toFixed()).toBe('15');
    const m = suggestReplenishment({ salesVelocity: '10', leadTimeDays: 14, availableQty: '4', orderMultiple: '12' });
    expect(m.suggestedQty.toFixed()).toBe('24');
  });
});

describe('classifyStockLevel', () => {
  it('classifies every band', () => {
    const base = { minimumStock: '50', reorderLevel: '100' };
    expect(classifyStockLevel({ ...base, availableQty: '0' })).toBe('OUT_OF_STOCK');
    expect(classifyStockLevel({ ...base, availableQty: '40' })).toBe('BELOW_MINIMUM');
    expect(classifyStockLevel({ ...base, availableQty: '100' })).toBe('AT_REORDER_LEVEL');
    expect(classifyStockLevel({ ...base, availableQty: '101' })).toBe('OK');
  });
});

describe('notification deduplication', () => {
  it('produces one key per cooldown window, suppressing repeats', () => {
    const args = { alertRuleCode: 'LOW_STOCK', subjectType: 'RawMaterial', subjectId: 'm1', cooldownMinutes: 1440 };
    const a = notificationDedupeKey({ ...args, now: new Date('2026-10-21T09:00:00Z') });
    const b = notificationDedupeKey({ ...args, now: new Date('2026-10-21T15:00:00Z') });
    expect(a).toBe(b);
  });

  it('produces a new key once the window rolls over', () => {
    const args = { alertRuleCode: 'LOW_STOCK', subjectType: 'RawMaterial', subjectId: 'm1', cooldownMinutes: 60 };
    const a = notificationDedupeKey({ ...args, now: new Date('2026-10-21T09:00:00Z') });
    const b = notificationDedupeKey({ ...args, now: new Date('2026-10-21T11:00:00Z') });
    expect(a).not.toBe(b);
  });

  it('separates different subjects', () => {
    const now = new Date('2026-10-21T09:00:00Z');
    const a = notificationDedupeKey({ alertRuleCode: 'LOW_STOCK', subjectType: 'RawMaterial', subjectId: 'm1', cooldownMinutes: 60, now });
    const b = notificationDedupeKey({ alertRuleCode: 'LOW_STOCK', subjectType: 'RawMaterial', subjectId: 'm2', cooldownMinutes: 60, now });
    expect(a).not.toBe(b);
  });
});
