import { describe, expect, it } from 'vitest';
import {
  detectShopifyDispatchDate, dispatchState, dispatchWindow, extractDispatchDateFromText,
  isDispatchSettled, istToday, parseDispatchDateValue,
} from './dispatch-date';
import { higherPriority, parsePriorityTagMap, priorityRank, shopifyPriority } from './order-priority';
import { planShopifyCrmSync } from './crm-sync';

const ORDER = '2026-10-10';
const read = (t: string, order = ORDER) => extractDispatchDateFromText(t, order);

describe('dispatch dates in notes', () => {
  it('reads the formats this store actually writes', () => {
    expect(read('DD/DT-/12345-123456 Dispatch By Date 15-10-2026').date).toBe('2026-10-15');
    expect(read('Dispatch by 12th October customisation').date).toBe('2026-10-12');
    expect(read('Dispatch date by 9th October').date).toBe('2026-10-09');
    expect(read('dispatch date : 21st oct').date).toBe('2026-10-21');
    expect(read('Dispatch by 21 Sep 2026').date).toBe('2026-09-21');
    expect(read('Dispatch by 3rd Oct-urgent').date).toBe('2026-10-03');
  });

  it('reads the examples in the brief', () => {
    expect(read('Dispatch Date: 05 Nov 2026').date).toBe('2026-11-05');
    expect(read('Expected Dispatch Date: 2026-11-05').date).toBe('2026-11-05');
    expect(read('Dispatch on 05/11/2026').date).toBe('2026-11-05');
    expect(read('Dispatch: 5 November 2026').date).toBe('2026-11-05');
    expect(read('Expected Dispatch - 05 Nov 2026').date).toBe('2026-11-05');
    expect(read('Despatch on November 5, 2026').date).toBe('2026-11-05');
  });

  it('keeps the words it read, and says when the year was inferred', () => {
    const r = read('Gift wrap please. Dispatch by 12th October, thanks');
    expect(r.text).toBe('Dispatch by 12th October');
    expect(r.yearInferred).toBe(true);
    expect(read('Dispatch: 5 November 2026').yearInferred).toBe(false);
  });

  it('takes a missing year from the order, rolling into next year when needed', () => {
    expect(read('Dispatch by 5th January', '2026-12-20').date).toBe('2027-01-05');
    // A date just before the order is a late promise, not next year's.
    expect(read('Dispatch by 5th October', '2026-10-20').date).toBe('2026-10-05');
  });

  it('never reads delivery dates, order dates or unlabelled dates', () => {
    expect(read('Delivery by 5 Nov 2026').date).toBeNull();
    expect(read('Order placed 01/10/2026, deliver by 05/11/2026').date).toBeNull();
    expect(read('Dispatch and delivery by 5 Nov').date).toBeNull();
    expect(read('Need it on 12th October').date).toBeNull();
    expect(read(null).date).toBeNull();
  });

  it('flags conflicting dates for review instead of choosing', () => {
    const r = read('Dispatch by 12th October. Update: dispatch by 15th October');
    expect(r.date).toBeNull();
    expect(r.issue).toBe('CONFLICTING_DATES');
    expect(r.candidates).toEqual(['2026-10-12', '2026-10-15']);
    expect(read('Dispatch 12th Oct; dispatch on 12/10/2026').date).toBe('2026-10-12');
  });

  it('refuses ambiguous and impossible dates', () => {
    expect(read('Dispatch on 05/11/26')).toMatchObject({ date: null, issue: 'AMBIGUOUS_DATE' });
    expect(read('Dispatch by 31st September')).toMatchObject({ date: null, issue: 'INVALID_DATE' });
    expect(read('Dispatch by 5 March', '2026-01-10').date).toBe('2026-03-05');
    expect(read('Dispatch by 5 December', '2026-01-10')).toMatchObject({ date: null, issue: 'AMBIGUOUS_DATE' });
  });
});

describe('Shopify precedence', () => {
  const orderedAt = new Date('2026-10-10T06:00:00Z');
  it('prefers a metafield, then a dispatch attribute, then the note', () => {
    const note = 'Dispatch by 12th October';
    expect(detectShopifyDispatchDate({ note, attributes: [], metafieldValue: '2026-10-20', orderedAt }))
      .toMatchObject({ date: '2026-10-20', source: 'SHOPIFY_METAFIELD' });
    expect(detectShopifyDispatchDate({ note, attributes: [{ key: 'Dispatch Date', value: '18/10/2026' }], metafieldValue: null, orderedAt }))
      .toMatchObject({ date: '2026-10-18', source: 'SHOPIFY_CUSTOM_ATTRIBUTE' });
    expect(detectShopifyDispatchDate({ note, attributes: [{ key: 'Delivery date', value: '18/10/2026' }], metafieldValue: null, orderedAt }))
      .toMatchObject({ date: '2026-10-12', source: 'SHOPIFY_NOTE' });
    expect(detectShopifyDispatchDate({ note: 'Gift wrap', attributes: [], metafieldValue: null, orderedAt }).source).toBeNull();
  });
  it('treats a structured value as a whole date or nothing', () => {
    expect(parseDispatchDateValue('2026-10-20', ORDER).date).toBe('2026-10-20');
    expect(parseDispatchDateValue('soon', ORDER).issue).toBe('INVALID_DATE');
  });
});

describe('calendar in Asia/Kolkata', () => {
  it('rolls over at Indian midnight, not UTC', () => {
    expect(istToday(new Date('2026-10-27T18:29:00Z'))).toBe('2026-10-27');
    expect(istToday(new Date('2026-10-27T18:31:00Z'))).toBe('2026-10-28');
  });
  it('builds the presets', () => {
    const now = new Date('2026-10-28T06:00:00Z'); // Wednesday in India
    expect(dispatchWindow('TODAY', now)).toEqual({ kind: 'RANGE', from: '2026-10-28', to: '2026-10-28' });
    expect(dispatchWindow('TOMORROW', now)).toEqual({ kind: 'RANGE', from: '2026-10-29', to: '2026-10-29' });
    expect(dispatchWindow('NEXT_3_DAYS', now)).toEqual({ kind: 'RANGE', from: '2026-10-28', to: '2026-10-30' });
    expect(dispatchWindow('NEXT_7_DAYS', now)).toEqual({ kind: 'RANGE', from: '2026-10-28', to: '2026-11-03' });
    expect(dispatchWindow('THIS_WEEK', now)).toEqual({ kind: 'RANGE', from: '2026-10-26', to: '2026-11-01' });
    expect(dispatchWindow('THIS_MONTH', now)).toEqual({ kind: 'RANGE', from: '2026-10-01', to: '2026-10-31' });
    expect(dispatchWindow('OVERDUE', now)).toEqual({ kind: 'OVERDUE', before: '2026-10-28' });
    expect(dispatchWindow('CUSTOM', now, { from: '2026-11-01', to: 'nonsense' })).toEqual({ kind: 'RANGE', from: '2026-11-01', to: null });
  });
  it('colours a date by how it reads today', () => {
    expect(dispatchState('2026-10-27', '2026-10-28', false)).toBe('OVERDUE');
    expect(dispatchState('2026-10-27', '2026-10-28', true)).toBe('SETTLED');
    expect(dispatchState('2026-10-28', '2026-10-28', false)).toBe('TODAY');
    expect(dispatchState('2026-10-30', '2026-10-28', false)).toBe('SOON');
    expect(dispatchState('2026-11-05', '2026-10-28', false)).toBe('LATER');
    expect(dispatchState(null, '2026-10-28', false)).toBe('NONE');
  });
  it('never calls a dispatched or cancelled order overdue', () => {
    expect(isDispatchSettled({ status: 'OPEN', externalShipmentStatus: 'COMPLETE' })).toBe(true);
    expect(isDispatchSettled({ status: 'CANCELLED', externalShipmentStatus: null })).toBe(true);
    expect(isDispatchSettled({ status: 'OPEN', externalShipmentStatus: 'PROCESSING' })).toBe(false);
  });
});

describe('order priority', () => {
  it('ranks VIP first and Normal last', () => {
    expect(priorityRank('VIP')).toBe(1);
    expect(priorityRank('NORMAL')).toBe(4);
    expect(higherPriority('MEDIUM', 'HIGH')).toBe('HIGH');
  });
  it('maps only approved tags, case-blind, ignoring typos', () => {
    const map = parsePriorityTagMap('VIP:VIP, express-shipping:HIGH, Rush:URGENT');
    expect([...map.entries()]).toEqual([['vip', 'VIP'], ['express-shipping', 'HIGH']]);
    expect(shopifyPriority({ tags: ['COD', 'Express-Shipping', 'vip'], tagMap: map })).toEqual({ priority: 'VIP', source: 'SHOPIFY_TAG' });
    expect(shopifyPriority({ tags: ['COD'], tagMap: map })).toBeNull();
    expect(shopifyPriority({ tags: [], tagMap: new Map(), metafieldValue: 'High Priority' })).toEqual({ priority: 'HIGH', source: 'SHOPIFY_METAFIELD' });
  });
});

describe('Shopify sync never overrides the CRM', () => {
  const finding = (date: string | null) => ({
    date, source: date ? ('SHOPIFY_NOTE' as const) : null, text: date ? `Dispatch by ${date}` : null,
    issue: null, yearInferred: false, candidates: date ? [date] : [],
  });
  const base = {
    expectedDispatchDate: null, dispatchDateSource: 'UNASSIGNED' as const, dispatchDateLocked: false,
    orderPriority: 'NORMAL' as const, prioritySource: 'DEFAULT',
  };

  it('fills an unlocked date from Shopify and records the change', () => {
    const plan = planShopifyCrmSync(base, finding('2026-11-05'), null);
    expect(plan.dispatch).toEqual({ date: '2026-11-05', source: 'SHOPIFY_NOTE', text: 'Dispatch by 2026-11-05' });
    expect(plan.changes).toEqual([{ field: 'EXPECTED_DISPATCH_DATE', previousValue: null, newValue: '2026-11-05', source: 'SHOPIFY_NOTE' }]);
  });

  it('leaves a CRM date alone, but still records what Shopify says', () => {
    const plan = planShopifyCrmSync(
      { ...base, expectedDispatchDate: '2026-11-10', dispatchDateSource: 'CRM_MANUAL', dispatchDateLocked: true },
      finding('2026-11-05'), null,
    );
    expect(plan.dispatch).toBeUndefined();
    expect(plan.changes).toEqual([]);
    expect(plan.shopify.date).toBe('2026-11-05');
  });

  it('clears a note-derived date when the note stops naming one', () => {
    const plan = planShopifyCrmSync({ ...base, expectedDispatchDate: '2026-11-05', dispatchDateSource: 'SHOPIFY_NOTE' }, finding(null), null);
    expect(plan.dispatch).toEqual({ date: null, source: 'UNASSIGNED', text: null });
  });

  it('changes nothing when nothing changed', () => {
    const plan = planShopifyCrmSync({ ...base, expectedDispatchDate: '2026-11-05', dispatchDateSource: 'SHOPIFY_NOTE' }, finding('2026-11-05'), null);
    expect(plan.dispatch).toBeUndefined();
    expect(plan.priority).toBeUndefined();
    expect(plan.changes).toEqual([]);
  });

  it('applies an approved tag priority, but never over a CRM priority', () => {
    expect(planShopifyCrmSync(base, finding(null), { priority: 'VIP', source: 'SHOPIFY_TAG' }).priority)
      .toEqual({ value: 'VIP', source: 'SHOPIFY_TAG' });
    expect(planShopifyCrmSync({ ...base, orderPriority: 'MEDIUM', prioritySource: 'CRM_MANUAL' }, finding(null), { priority: 'VIP', source: 'SHOPIFY_TAG' }).priority)
      .toBeUndefined();
    // The tag was removed: back to the default.
    expect(planShopifyCrmSync({ ...base, orderPriority: 'VIP', prioritySource: 'SHOPIFY_TAG' }, finding(null), null).priority)
      .toEqual({ value: 'NORMAL', source: 'DEFAULT' });
  });

  it('sets nothing on a new order Shopify says nothing about', () => {
    const plan = planShopifyCrmSync(null, finding(null), null);
    expect(plan.dispatch).toBeUndefined();
    expect(plan.priority).toBeUndefined();
  });
});
