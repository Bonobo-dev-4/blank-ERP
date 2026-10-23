import { describe, expect, it } from 'vitest';
import { Decimal, qty } from '../decimal';
import { IllegalStateError, InvariantViolation, ValidationError } from '../errors';
import { assertLedgerBalanced, ownedQuantity, planMovement } from './ledger';
import type { LocationRef } from './locations';

const WH: LocationRef = { id: 'wh', code: 'RM-WH', kind: 'PHYSICAL' };
const CUT: LocationRef = { id: 'cut', code: 'DEPT-CUT', kind: 'PRODUCTION_FLOOR' };
const EXT: LocationRef = { id: 'ext', code: 'SYS-EXTERNAL', kind: 'COUNTERPARTY' };
const QCH: LocationRef = { id: 'qch', code: 'SYS-QC-HOLD-RM', kind: 'QUALITY_HOLD' };
const CONSUMED: LocationRef = { id: 'consumed', code: 'SYS-CONSUMED', kind: 'SINK' };
const SCRAP: LocationRef = { id: 'scrap', code: 'SYS-SCRAP', kind: 'SINK' };
const JW: LocationRef = { id: 'jw', code: 'JW-01', kind: 'JOB_WORKER' };

describe('planMovement - double entry', () => {
  it('debits the source and credits the destination by the same quantity', () => {
    const plan = planMovement({
      movementType: 'TRANSFER', baseQty: '125.5', source: WH, destination: CUT,
      sourceBalance: { onHandQty: '500', reservedQty: '0' },
    });
    expect(plan.deltas).toHaveLength(2);
    expect(plan.deltas[0]!.onHandDelta.toFixed()).toBe('-125.5');
    expect(plan.deltas[1]!.onHandDelta.toFixed()).toBe('125.5');
    // Net effect on owned quantity is zero: a transfer moves, it does not consume.
    const net = plan.deltas.reduce((a, d) => a.plus(d.onHandDelta), new Decimal(0));
    expect(net.toFixed()).toBe('0');
  });

  it('rejects a non-positive quantity', () => {
    for (const q of ['0', '-5']) {
      expect(() => planMovement({
        movementType: 'TRANSFER', baseQty: q, source: WH, destination: CUT,
        sourceBalance: { onHandQty: '500', reservedQty: '0' },
      })).toThrow(ValidationError);
    }
  });

  it('rejects a movement whose source and destination are the same', () => {
    expect(() => planMovement({
      movementType: 'TRANSFER', baseQty: '1', source: WH, destination: { ...WH },
      sourceBalance: { onHandQty: '5', reservedQty: '0' },
    })).toThrow(/Source and destination/);
  });
});

describe('planMovement - movement state machine', () => {
  it('lands purchase receipts in QC hold, never straight into the warehouse', () => {
    expect(() => planMovement({
      movementType: 'PURCHASE_INWARD', baseQty: '300', source: EXT, destination: WH, hasReference: true,
    })).toThrow(IllegalStateError);

    const ok = planMovement({
      movementType: 'PURCHASE_INWARD', baseQty: '300', source: EXT, destination: QCH, hasReference: true,
    });
    expect(ok.baseQty.toFixed()).toBe('300');
  });

  it('never allows stock to come back out of a sink', () => {
    // Material consumed into a garment or scrapped cannot be un-consumed.
    expect(() => planMovement({
      movementType: 'TRANSFER', baseQty: '1', source: CONSUMED, destination: WH,
      sourceBalance: { onHandQty: '100', reservedQty: '0' },
    })).toThrow(IllegalStateError);
    expect(() => planMovement({
      movementType: 'ADJUSTMENT_IN', baseQty: '1', source: SCRAP, destination: WH, hasReference: true,
    })).toThrow(IllegalStateError);
  });

  it('issues to production as a transfer, not a consumption', () => {
    // This is the rule that stops fabric being deducted again at every stage.
    expect(() => planMovement({
      movementType: 'ISSUE_TO_PRODUCTION', baseQty: '10', source: WH, destination: CONSUMED,
      sourceBalance: { onHandQty: '100', reservedQty: '0' }, hasReference: true,
    })).toThrow(/cannot put stock into a SINK/);
  });

  it('requires an authorising document where the rule demands one', () => {
    expect(() => planMovement({
      movementType: 'ISSUE_TO_PRODUCTION', baseQty: '10', source: WH, destination: CUT,
      sourceBalance: { onHandQty: '100', reservedQty: '0' }, hasReference: false,
    })).toThrow(/must cite an authorising document/);
  });

  it('does not stock-check a virtual counter-account source', () => {
    // The external account is allowed to go negative; that is what makes the
    // ledger balance to zero.
    const plan = planMovement({
      movementType: 'OPENING_BALANCE', baseQty: '1000', source: EXT, destination: WH,
    });
    expect(plan.deltas[0]!.onHandDelta.toFixed()).toBe('-1000');
  });
});

describe('planMovement - stock sufficiency', () => {
  it('refuses to move more than is physically on hand', () => {
    expect(() => planMovement({
      movementType: 'TRANSFER', baseQty: '501', source: WH, destination: CUT,
      sourceBalance: { onHandQty: '500', reservedQty: '0' },
    })).toThrow(InvariantViolation);
  });

  it('refuses when there is no balance row at all at the source', () => {
    expect(() => planMovement({
      movementType: 'TRANSFER', baseQty: '1', source: WH, destination: CUT, sourceBalance: null,
    })).toThrow(/No stock exists at the source/);
  });

  it('protects another order reservation from an unreserved movement', () => {
    // 500 on hand, 450 promised to another MO: only 50 may be moved freely.
    expect(() => planMovement({
      movementType: 'TRANSFER', baseQty: '51', source: WH, destination: CUT,
      sourceBalance: { onHandQty: '500', reservedQty: '450' },
    })).toThrow(/exceeds unreserved stock/);

    const ok = planMovement({
      movementType: 'TRANSFER', baseQty: '50', source: WH, destination: CUT,
      sourceBalance: { onHandQty: '500', reservedQty: '450' },
    });
    expect(ok.reservationConsumedQty.toFixed()).toBe('0');
  });

  it('lets an order draw on its own reservation', () => {
    const plan = planMovement({
      movementType: 'ISSUE_TO_PRODUCTION', baseQty: '262.5', source: WH, destination: CUT,
      sourceBalance: { onHandQty: '300', reservedQty: '262.5' },
      reservationCoverQty: '262.5', hasReference: true,
    });
    // 37.5 unreserved used first, then 225 from the reservation.
    expect(plan.reservationConsumedQty.toFixed()).toBe('225');
    expect(plan.deltas[0]!.reservedDelta.toFixed()).toBe('-225');
  });

  it('caps reservation cover at the reservation that actually exists', () => {
    // The caller claims cover of 500 but only 100 is reserved.
    expect(() => planMovement({
      movementType: 'ISSUE_TO_PRODUCTION', baseQty: '300', source: WH, destination: CUT,
      sourceBalance: { onHandQty: '400', reservedQty: '100' },
      reservationCoverQty: '500', hasReference: true,
    })).not.toThrow();

    expect(() => planMovement({
      movementType: 'ISSUE_TO_PRODUCTION', baseQty: '300', source: WH, destination: CUT,
      sourceBalance: { onHandQty: '400', reservedQty: '350' },
      reservationCoverQty: '500', hasReference: true,
    })).not.toThrow();

    // 400 on hand, 350 reserved for OTHER orders, cover 0 -> only 50 available.
    expect(() => planMovement({
      movementType: 'ISSUE_TO_PRODUCTION', baseQty: '300', source: WH, destination: CUT,
      sourceBalance: { onHandQty: '400', reservedQty: '350' },
      reservationCoverQty: '0', hasReference: true,
    })).toThrow(/exceeds unreserved stock plus/);
  });

  it('will not consume straight out of the warehouse', () => {
    // Consumption happens where the work happens. Material must be issued to a
    // department or a job worker first, which is what keeps "issued" and
    // "consumed" distinguishable.
    expect(() => planMovement({
      movementType: 'CONSUMPTION', baseQty: '10', source: WH, destination: CONSUMED,
      sourceBalance: { onHandQty: '100', reservedQty: '0' }, hasReference: true,
    })).toThrow(/cannot take stock from a PHYSICAL location/);
  });

  it('allows consumption from a job worker location', () => {
    const plan = planMovement({
      movementType: 'CONSUMPTION', baseQty: '12.75', source: JW, destination: CONSUMED,
      sourceBalance: { onHandQty: '20', reservedQty: '0' }, hasReference: true,
    });
    expect(plan.deltas[1]!.locationId).toBe('consumed');
  });
});

describe('ledger integrity', () => {
  it('holds when every entry has both sides', () => {
    // Received 500 from supplier, released 480 to warehouse, 20 rejected,
    // issued 300 to cutting, consumed 290, scrapped 10.
    const balances = [
      { locationId: 'ext', onHandQty: '-500' },
      { locationId: 'qch', onHandQty: '0' },
      { locationId: 'rejected', onHandQty: '20' },
      { locationId: 'wh', onHandQty: '180' },
      { locationId: 'cut', onHandQty: '0' },
      { locationId: 'consumed', onHandQty: '290' },
      { locationId: 'scrap', onHandQty: '10' },
    ];
    expect(() => assertLedgerBalanced(balances)).not.toThrow();
  });

  it('detects a one-sided entry', () => {
    expect(() => assertLedgerBalanced([
      { locationId: 'wh', onHandQty: '100' },
      { locationId: 'ext', onHandQty: '-90' },
    ])).toThrow(InvariantViolation);
  });

  it('counts owned stock without the counter-accounts or sinks', () => {
    const owned = ownedQuantity([
      { kind: 'COUNTERPARTY', onHandQty: '-500' },
      { kind: 'PHYSICAL', onHandQty: '180' },
      { kind: 'QUALITY_HOLD', onHandQty: '0' },
      { kind: 'BLOCKED', onHandQty: '20' },
      { kind: 'JOB_WORKER', onHandQty: '0' },
      { kind: 'SINK', onHandQty: '300' },
    ]);
    // 180 usable + 20 blocked = 200 still owned; 300 is gone, -500 is the
    // supplier counter-account.
    expect(owned.toFixed()).toBe('200');
  });
});

describe('scenario: production order cancelled after material was issued', () => {
  it('returns issued material instead of writing it off', () => {
    // 262.5 m issued to cutting, nothing cut yet, order cancelled.
    const issued = planMovement({
      movementType: 'ISSUE_TO_PRODUCTION', baseQty: '262.5', source: WH, destination: CUT,
      sourceBalance: { onHandQty: '500', reservedQty: '262.5' },
      reservationCoverQty: '262.5', hasReference: true,
    });
    expect(issued.baseQty.toFixed()).toBe('262.5');

    const returned = planMovement({
      movementType: 'RETURN_FROM_PRODUCTION', baseQty: '262.5', source: CUT, destination: WH,
      sourceBalance: { onHandQty: '262.5', reservedQty: '0' }, hasReference: true,
    });
    // Warehouse is made whole; nothing reached a sink, so nothing was lost.
    expect(returned.deltas[1]!.onHandDelta.toFixed()).toBe('262.5');
    const net = [...issued.deltas, ...returned.deltas]
      .filter((d) => d.locationId === 'wh')
      .reduce((a, d) => a.plus(d.onHandDelta), new Decimal(0));
    expect(qty(net).toFixed()).toBe('0');
  });
});
