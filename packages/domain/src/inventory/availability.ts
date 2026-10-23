import { Decimal, dec, qty, type DecimalLike } from '../decimal';
import { isIssuable, isOwned, type LocationKind, type LocationRef } from './locations';

export interface BalanceRow {
  readonly rawMaterialId: string;
  readonly materialLotId: string;
  readonly location: LocationRef;
  readonly onHandQty: DecimalLike;
  readonly reservedQty: DecimalLike;
}

export interface StockPosition {
  /** Owned stock anywhere (warehouse, departments, job workers, QC hold...). */
  readonly onHandQty: Decimal;
  /** Owned stock sitting in locations production may draw from. */
  readonly issuableQty: Decimal;
  /** Portion of issuable stock already committed to manufacturing orders. */
  readonly reservedQty: Decimal;
  /** issuableQty - reservedQty: what a new order can actually claim. */
  readonly availableQty: Decimal;
  /** Issued to a production department: owned, but committed to work. */
  readonly issuedToProductionQty: Decimal;
  /** In QC hold: received but not yet inspected. */
  readonly qualityHoldQty: Decimal;
  /** Blocked, damaged or inspection-rejected. */
  readonly blockedQty: Decimal;
  /** Physically with an external job worker. */
  readonly withJobWorkerQty: Decimal;
  /** Moving between internal locations. */
  readonly inTransitQty: Decimal;
}

const ZERO = new Decimal(0);

/**
 * Collapse per-(lot, location) balance rows into the position a planner needs.
 *
 * The distinction this preserves is the one the business actually cares about:
 * owning 500 m of fabric is not the same as being able to cut 500 m of it. Only
 * `availableQty` may be promised to a new manufacturing order.
 */
export function computeStockPosition(rows: readonly BalanceRow[]): StockPosition {
  let onHand = ZERO, issuable = ZERO, reserved = ZERO;
  let qualityHold = ZERO, blocked = ZERO, withJobWorker = ZERO, inTransit = ZERO;
  let issuedToProduction = ZERO;

  for (const row of rows) {
    const kind: LocationKind = row.location.kind;
    const q = dec(row.onHandQty);
    if (!isOwned(kind)) continue;

    onHand = onHand.plus(q);

    if (isIssuable(row.location)) {
      issuable = issuable.plus(q);
      reserved = reserved.plus(dec(row.reservedQty));
    }

    switch (kind) {
      case 'PRODUCTION_FLOOR': issuedToProduction = issuedToProduction.plus(q); break;
      case 'QUALITY_HOLD': qualityHold = qualityHold.plus(q); break;
      case 'BLOCKED': blocked = blocked.plus(q); break;
      case 'JOB_WORKER': withJobWorker = withJobWorker.plus(q); break;
      case 'IN_TRANSIT': inTransit = inTransit.plus(q); break;
      default: break;
    }
  }

  return {
    onHandQty: qty(onHand),
    issuableQty: qty(issuable),
    reservedQty: qty(reserved),
    availableQty: qty(Decimal.max(issuable.minus(reserved), 0)),
    issuedToProductionQty: qty(issuedToProduction),
    qualityHoldQty: qty(qualityHold),
    blockedQty: qty(blocked),
    withJobWorkerQty: qty(withJobWorker),
    inTransitQty: qty(inTransit),
  };
}

/** Rows a new reservation may draw on, largest-available first. */
export function issuableRows(rows: readonly BalanceRow[]): BalanceRow[] {
  return rows.filter(
    (r) => isIssuable(r.location) && dec(r.onHandQty).minus(dec(r.reservedQty)).greaterThan(0),
  );
}

/** Unreserved quantity on one balance row. */
export function rowAvailable(row: BalanceRow): Decimal {
  return qty(Decimal.max(dec(row.onHandQty).minus(dec(row.reservedQty)), 0));
}
