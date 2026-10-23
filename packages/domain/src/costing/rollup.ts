import { Decimal, amount, qty, rate, type DecimalLike } from '../decimal';

export const COST_CATEGORIES = [
  'MATERIAL', 'WASTAGE', 'CUTTING', 'EMBROIDERY', 'STITCHING',
  'FINISHING', 'JOB_WORK', 'PACKAGING', 'OVERHEAD',
] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

export interface CostEntry {
  readonly costCategory: CostCategory;
  readonly isPlanned: boolean;
  readonly amount: DecimalLike;
}

export interface CostVariance {
  readonly costCategory: CostCategory;
  readonly plannedAmount: Decimal;
  readonly actualAmount: Decimal;
  readonly varianceAmount: Decimal;
  readonly variancePct: Decimal | null;
}

export interface MoCostSummary {
  readonly plannedTotal: Decimal;
  readonly actualTotal: Decimal;
  readonly varianceAmount: Decimal;
  readonly variancePct: Decimal | null;
  readonly byCategory: readonly CostVariance[];
  /**
   * Actual cost divided by ACCEPTED units. Rejected garments consumed material
   * and labour but produced nothing sellable, so loading their cost onto the
   * good units is the only honest unit cost.
   */
  readonly costPerAcceptedUnit: Decimal | null;
}

export function rollUpCosts(
  entries: readonly CostEntry[],
  acceptedUnits: DecimalLike,
): MoCostSummary {
  const planned = new Map<CostCategory, Decimal>();
  const actual = new Map<CostCategory, Decimal>();

  for (const e of entries) {
    const target = e.isPlanned ? planned : actual;
    target.set(e.costCategory, (target.get(e.costCategory) ?? new Decimal(0)).plus(amount(e.amount)));
  }

  const categories = [...new Set([...planned.keys(), ...actual.keys()])].sort(
    (a, b) => COST_CATEGORIES.indexOf(a) - COST_CATEGORIES.indexOf(b),
  );

  const byCategory: CostVariance[] = categories.map((c) => {
    const p = amount(planned.get(c) ?? 0);
    const a = amount(actual.get(c) ?? 0);
    const v = amount(a.minus(p));
    return {
      costCategory: c,
      plannedAmount: p,
      actualAmount: a,
      varianceAmount: v,
      variancePct: p.isZero() ? null : rate(v.dividedBy(p).times(100)),
    };
  });

  const plannedTotal = amount(byCategory.reduce<Decimal>((s, c) => s.plus(c.plannedAmount), new Decimal(0)));
  const actualTotal = amount(byCategory.reduce<Decimal>((s, c) => s.plus(c.actualAmount), new Decimal(0)));
  const variance = amount(actualTotal.minus(plannedTotal));
  const units = qty(acceptedUnits);

  return {
    plannedTotal,
    actualTotal,
    varianceAmount: variance,
    variancePct: plannedTotal.isZero() ? null : rate(variance.dividedBy(plannedTotal).times(100)),
    byCategory,
    costPerAcceptedUnit: units.greaterThan(0) ? rate(actualTotal.dividedBy(units)) : null,
  };
}

export interface WastageAnalysis {
  readonly rawMaterialId: string;
  readonly standardQty: Decimal;
  readonly actualQty: Decimal;
  readonly varianceQty: Decimal;
  readonly variancePct: Decimal | null;
  /** True when actual consumption exceeded the BOM standard. */
  readonly isOverConsumption: boolean;
}

/**
 * Compare the frozen BOM standard against what was actually consumed.
 * This is the BOM variance / material wastage report, and the reason the MO
 * keeps a BOM snapshot: comparing actuals to a BOM someone has since edited
 * would measure the edit, not the production run.
 */
export function analyseWastage(
  rows: readonly {
    readonly rawMaterialId: string;
    readonly standardQty: DecimalLike;
    readonly actualQty: DecimalLike;
  }[],
): WastageAnalysis[] {
  return rows.map((r) => {
    const std = qty(r.standardQty);
    const act = qty(r.actualQty);
    const v = qty(act.minus(std));
    return {
      rawMaterialId: r.rawMaterialId,
      standardQty: std,
      actualQty: act,
      varianceQty: v,
      variancePct: std.isZero() ? null : rate(v.dividedBy(std).times(100)),
      isOverConsumption: v.greaterThan(0),
    };
  });
}
