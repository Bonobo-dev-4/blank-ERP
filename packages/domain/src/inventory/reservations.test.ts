import { describe, expect, it } from 'vitest';
import { InvariantViolation } from '../errors';
import { computeStockPosition, rowAvailable, type BalanceRow } from './availability';
import { allocateFromStock, applyIssueToReservation, openReservationQty, type LotAttributes } from './reservations';
import type { LocationRef } from './locations';

const WH: LocationRef = { id: 'wh', kind: 'PHYSICAL' };
const CUT: LocationRef = { id: 'cut', kind: 'PRODUCTION_FLOOR' };
const QCH: LocationRef = { id: 'qch', kind: 'QUALITY_HOLD', blocksIssue: true };
const BLK: LocationRef = { id: 'blk', kind: 'BLOCKED', blocksIssue: true };
const JW: LocationRef = { id: 'jw', kind: 'JOB_WORKER' };
const TRANSIT: LocationRef = { id: 'tr', kind: 'IN_TRANSIT', blocksIssue: true };
const EXT: LocationRef = { id: 'ext', kind: 'COUNTERPARTY' };
const CONSUMED: LocationRef = { id: 'cons', kind: 'SINK' };

const row = (location: LocationRef, onHandQty: string, reservedQty = '0', lot = 'l1'): BalanceRow =>
  ({ rawMaterialId: 'fab', materialLotId: lot, location, onHandQty, reservedQty });

describe('computeStockPosition', () => {
  const rows = [
    row(WH, '400', '250'), row(CUT, '60'), row(QCH, '120'), row(BLK, '20'),
    row(JW, '30'), row(TRANSIT, '15'),
    row(EXT, '-900'), row(CONSUMED, '255'),
  ];
  const p = computeStockPosition(rows);

  it('separates what is owned from the counter-accounts and sinks', () => {
    // 400 + 60 + 120 + 20 + 30 + 15 = 645 owned.
    expect(p.onHandQty.toFixed()).toBe('645');
  });

  it('counts only uncommitted warehouse stock as available to a new order', () => {
    // Only the 400 in the warehouse is uncommitted. The 60 on the cutting
    // floor and the 30 with a job worker are owned but already spoken for.
    expect(p.issuableQty.toFixed()).toBe('400');
    expect(p.reservedQty.toFixed()).toBe('250');
    expect(p.availableQty.toFixed()).toBe('150');
  });

  it('breaks out the states a planner has to see separately', () => {
    expect(p.issuedToProductionQty.toFixed()).toBe('60');
    expect(p.qualityHoldQty.toFixed()).toBe('120');
    expect(p.blockedQty.toFixed()).toBe('20');
    expect(p.withJobWorkerQty.toFixed()).toBe('30');
    expect(p.inTransitQty.toFixed()).toBe('15');
  });

  it('never reports negative availability', () => {
    const over = computeStockPosition([row(WH, '10', '10')]);
    expect(over.availableQty.toFixed()).toBe('0');
    expect(rowAvailable(row(WH, '10', '10')).toFixed()).toBe('0');
  });
});

describe('allocateFromStock', () => {
  const lots: LotAttributes[] = [
    { materialLotId: 'old', shade: 'A', width: '58', receivedAt: new Date('2026-01-10') },
    { materialLotId: 'mid', shade: 'B', width: '58', receivedAt: new Date('2026-05-10') },
    { materialLotId: 'new', shade: 'A', width: '44', receivedAt: new Date('2026-09-10') },
  ];
  const rows = [row(WH, '100', '0', 'old'), row(WH, '150', '0', 'mid'), row(WH, '200', '0', 'new')];

  it('consumes the oldest lot first', () => {
    const r = allocateFromStock('120', rows, lots);
    expect(r.lines.map((l) => l.materialLotId)).toEqual(['old', 'mid']);
    expect(r.lines[0]!.qty.toFixed()).toBe('100');
    expect(r.lines[1]!.qty.toFixed()).toBe('20');
    expect(r.allocatedQty.toFixed()).toBe('120');
    expect(r.shortfallQty.toFixed()).toBe('0');
  });

  it('reports a shortfall rather than over-allocating', () => {
    const r = allocateFromStock('600', rows, lots);
    expect(r.allocatedQty.toFixed()).toBe('450');
    expect(r.shortfallQty.toFixed()).toBe('150');
  });

  it('skips stock already reserved by another order', () => {
    const r = allocateFromStock('120', [row(WH, '100', '95', 'old'), row(WH, '150', '0', 'mid')], lots);
    expect(r.lines[0]!.qty.toFixed()).toBe('5');
    expect(r.lines[1]!.qty.toFixed()).toBe('115');
  });

  it('honours a required shade', () => {
    const r = allocateFromStock('250', rows, lots, { requiredShade: 'A' });
    expect(r.lines.map((l) => l.materialLotId)).toEqual(['old', 'new']);
    expect(r.shadesUsed).toEqual(['A']);
  });

  it('honours a minimum usable width', () => {
    const r = allocateFromStock('400', rows, lots, { minimumWidth: '58' });
    // The 44-inch lot is excluded even though it has the most stock.
    expect(r.lines.map((l) => l.materialLotId)).toEqual(['old', 'mid']);
    expect(r.allocatedQty.toFixed()).toBe('250');
  });

  it('keeps an order on one shade when asked, picking the shade with most cover', () => {
    const r = allocateFromStock('250', rows, lots, { singleShade: true });
    expect(r.shadesUsed).toEqual(['A']);
    expect(r.allocatedQty.toFixed()).toBe('250');
  });

  it('is deterministic: the same inputs give the same allocation', () => {
    const a = allocateFromStock('175', rows, lots);
    const b = allocateFromStock('175', rows, lots);
    expect(a.lines.map((l) => `${l.materialLotId}:${l.qty.toFixed()}`))
      .toEqual(b.lines.map((l) => `${l.materialLotId}:${l.qty.toFixed()}`));
  });

  it('allocates nothing for a zero request', () => {
    expect(allocateFromStock('0', rows, lots).lines).toHaveLength(0);
  });
});

describe('reservation consumption', () => {
  it('tracks the open portion of a reservation', () => {
    expect(openReservationQty({ reservedQty: '262.5', issuedQty: '0', releasedQty: '0' }).toFixed()).toBe('262.5');
    expect(openReservationQty({ reservedQty: '262.5', issuedQty: '100', releasedQty: '0' }).toFixed()).toBe('162.5');
    expect(openReservationQty({ reservedQty: '262.5', issuedQty: '100', releasedQty: '162.5' }).toFixed()).toBe('0');
  });

  it('marks a reservation partially consumed then consumed', () => {
    const first = applyIssueToReservation({ reservedQty: '262.5', issuedQty: '0', releasedQty: '0' }, '100');
    expect(first.status).toBe('PARTIALLY_CONSUMED');
    expect(first.issuedQty.toFixed()).toBe('100');

    const second = applyIssueToReservation({ reservedQty: '262.5', issuedQty: '100', releasedQty: '0' }, '162.5');
    expect(second.status).toBe('CONSUMED');
    expect(second.issuedQty.toFixed()).toBe('262.5');
  });

  it('refuses to over-consume a reservation', () => {
    expect(() => applyIssueToReservation({ reservedQty: '262.5', issuedQty: '262.5', releasedQty: '0' }, '1'))
      .toThrow(InvariantViolation);
    expect(() => applyIssueToReservation({ reservedQty: '100', issuedQty: '60', releasedQty: '40' }, '1'))
      .toThrow(InvariantViolation);
  });
});
