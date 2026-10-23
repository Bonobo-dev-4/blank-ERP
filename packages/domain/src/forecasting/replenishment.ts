import { Decimal, clampNonNegative, qty, type DecimalLike } from '../decimal';

export const FORECAST_METHODS = [
  'MOVING_AVERAGE', 'WEIGHTED_VELOCITY', 'SEASONAL_INDEX', 'MANUAL_OVERRIDE',
] as const;
export type ForecastMethod = (typeof FORECAST_METHODS)[number];

export interface SalesObservation {
  /** Start of the week this observation covers. */
  readonly weekStart: Date;
  readonly unitsSold: DecimalLike;
}

export interface VelocityResult {
  readonly method: ForecastMethod;
  /** Units per week. */
  readonly salesVelocity: Decimal;
  readonly lookbackDays: number;
  readonly observationCount: number;
  /** 0..1, based on how much history backs the figure. */
  readonly confidence: Decimal;
}

/**
 * Sales velocity in units per week.
 *
 * WEIGHTED_VELOCITY weights recent weeks more heavily, because a fashion
 * style's recent rate predicts next month better than its launch-week spike.
 * Weights are linear in recency (the most recent of n weeks has weight n),
 * which is transparent enough that a planner can reproduce it by hand - the
 * specification asks for rule-based forecasting precisely so the numbers can
 * be argued with.
 */
export function computeVelocity(
  observations: readonly SalesObservation[],
  options: { readonly method?: ForecastMethod; readonly lookbackDays?: number; readonly asOf?: Date } = {},
): VelocityResult {
  const method = options.method ?? 'WEIGHTED_VELOCITY';
  const lookbackDays = options.lookbackDays ?? 56;
  const asOf = options.asOf ?? new Date();
  const cutoff = new Date(asOf.getTime() - lookbackDays * 86_400_000);

  const inWindow = observations
    .filter((o) => o.weekStart.getTime() >= cutoff.getTime())
    .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime());

  const expectedWeeks = Math.max(1, Math.round(lookbackDays / 7));
  const confidence = qty(
    Decimal.min(new Decimal(inWindow.length).dividedBy(expectedWeeks), 1),
  ).toDecimalPlaces(4);

  if (inWindow.length === 0) {
    return { method, salesVelocity: new Decimal(0), lookbackDays, observationCount: 0, confidence: new Decimal(0) };
  }

  let velocity: Decimal;
  if (method === 'MOVING_AVERAGE') {
    const total = inWindow.reduce<Decimal>((a, o) => a.plus(qty(o.unitsSold)), new Decimal(0));
    velocity = total.dividedBy(inWindow.length);
  } else {
    let weightedSum = new Decimal(0);
    let weightTotal = new Decimal(0);
    inWindow.forEach((o, i) => {
      const w = new Decimal(i + 1);
      weightedSum = weightedSum.plus(qty(o.unitsSold).times(w));
      weightTotal = weightTotal.plus(w);
    });
    velocity = weightTotal.isZero() ? new Decimal(0) : weightedSum.dividedBy(weightTotal);
  }

  return { method, salesVelocity: qty(velocity), lookbackDays, observationCount: inWindow.length, confidence };
}

export interface ReplenishmentInput {
  readonly salesVelocity: DecimalLike;
  readonly leadTimeDays: number;
  readonly availableQty: DecimalLike;
  /** Confirmed incoming quantity only: open MOs and confirmed transfers. */
  readonly incomingQty?: DecimalLike;
  /** Extra cover held against demand variability, in days of demand. */
  readonly safetyStockDays?: number;
  /** Seasonality multiplier applied to the lead-time demand. */
  readonly seasonalIndex?: DecimalLike;
  /** Review period: how long until the next replenishment decision. */
  readonly reviewPeriodDays?: number;
  readonly minimumOrderQty?: DecimalLike | null;
  readonly orderMultiple?: DecimalLike | null;
}

export interface ReplenishmentSuggestion {
  readonly leadTimeDemandQty: Decimal;
  readonly safetyStockQty: Decimal;
  /** Stock level at which an order should be placed. */
  readonly reorderPointQty: Decimal;
  /** Target stock position to order up to. */
  readonly targetStockQty: Decimal;
  readonly suggestedQty: Decimal;
  readonly rationale: string;
}

/**
 * Rule-based replenishment suggestion.
 *
 *   lead-time demand = weekly velocity / 7 x (lead time + review period) x seasonality
 *   safety stock     = weekly velocity / 7 x safety-stock days
 *   target stock     = lead-time demand + safety stock
 *   suggestion       = target - (available + confirmed incoming)
 *
 * Confirmed incoming quantity is subtracted so a style with a production order
 * already running is not ordered twice. A snapshot of external availability is
 * NOT treated as incoming supply.
 *
 * Specification example: Dhan Mill, DD-KRT-001-M, 10 units/week, 4 on hand,
 * 14-day lead time, no safety stock, no review period and no incoming stock:
 *   lead-time demand = 10/7 x 14 = 20 -> suggestion = 20 - 4 = 16
 */
export function suggestReplenishment(input: ReplenishmentInput): ReplenishmentSuggestion {
  const weekly = qty(input.salesVelocity);
  const daily = weekly.dividedBy(7);
  const seasonal = input.seasonalIndex != null ? qty(input.seasonalIndex) : new Decimal(1);
  const horizonDays = new Decimal(input.leadTimeDays).plus(input.reviewPeriodDays ?? 0);

  const leadTimeDemand = qty(daily.times(horizonDays).times(seasonal));
  const safetyStock = qty(daily.times(input.safetyStockDays ?? 0));
  const target = qty(leadTimeDemand.plus(safetyStock));
  const position = qty(qty(input.availableQty).plus(qty(input.incomingQty ?? 0)));

  let suggested = clampNonNegative(target.minus(position));

  const min = input.minimumOrderQty != null ? qty(input.minimumOrderQty) : null;
  if (suggested.greaterThan(0) && min && min.greaterThan(0) && suggested.lessThan(min)) suggested = min;

  const mult = input.orderMultiple != null ? qty(input.orderMultiple) : null;
  if (suggested.greaterThan(0) && mult && mult.greaterThan(0)) {
    suggested = qty(suggested.dividedBy(mult).toDecimalPlaces(0, Decimal.ROUND_CEIL).times(mult));
  }
  // Garments are whole things.
  suggested = suggested.toDecimalPlaces(0, Decimal.ROUND_CEIL);

  return {
    leadTimeDemandQty: leadTimeDemand,
    safetyStockQty: safetyStock,
    reorderPointQty: qty(leadTimeDemand.plus(safetyStock)),
    targetStockQty: target,
    suggestedQty: suggested,
    rationale:
      `velocity ${weekly.toFixed(2)}/week; horizon ${horizonDays.toFixed(0)}d; ` +
      `lead-time demand ${leadTimeDemand.toFixed(2)}; safety ${safetyStock.toFixed(2)}; ` +
      `position ${position.toFixed(2)} (available + confirmed incoming); suggest ${suggested.toFixed(0)}`,
  };
}

export interface StockAlertInput {
  readonly availableQty: DecimalLike;
  readonly minimumStock: DecimalLike;
  readonly reorderLevel: DecimalLike;
}

export type StockAlertLevel = 'OK' | 'AT_REORDER_LEVEL' | 'BELOW_MINIMUM' | 'OUT_OF_STOCK';

/** Classify a material's stock level for the inventory alerts dashboard. */
export function classifyStockLevel(input: StockAlertInput): StockAlertLevel {
  const available = qty(input.availableQty);
  if (available.lessThanOrEqualTo(0)) return 'OUT_OF_STOCK';
  if (available.lessThan(qty(input.minimumStock))) return 'BELOW_MINIMUM';
  if (available.lessThanOrEqualTo(qty(input.reorderLevel))) return 'AT_REORDER_LEVEL';
  return 'OK';
}

/**
 * Notification dedupe key.
 *
 * Bucketing the timestamp by the rule's cooldown window means the same alert
 * produces the same key for the whole window, so the unique index on
 * Notification.dedupeKey suppresses repeats without any extra bookkeeping.
 */
export function notificationDedupeKey(input: {
  readonly alertRuleCode: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly cooldownMinutes: number;
  readonly now?: Date;
}): string {
  const now = input.now ?? new Date();
  const windowMs = Math.max(1, input.cooldownMinutes) * 60_000;
  const bucket = Math.floor(now.getTime() / windowMs);
  return [input.alertRuleCode, input.subjectType, input.subjectId, bucket].join(':');
}
