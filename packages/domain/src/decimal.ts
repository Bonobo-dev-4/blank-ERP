import Decimal from 'decimal.js';

/**
 * Global decimal configuration.
 *
 * Every quantity, rate and amount in this ERP is a Decimal. Floating point is
 * never used for stock or money: 0.1 + 0.2 !== 0.3 in IEEE-754, and a fabric
 * ledger that drifts by 1e-16 per movement eventually reports negative stock.
 */
Decimal.set({
  precision: 34,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -18,
  toExpPos: 24,
});

export { Decimal };

/** Scale of quantity columns in the database: Decimal(18,4). */
export const QTY_DP = 4;
/** Scale of per-unit cost / rate columns: Decimal(18,6). */
export const RATE_DP = 6;
/** Scale of money total columns: Decimal(18,2). */
export const AMOUNT_DP = 2;

export type DecimalLike = Decimal | string | number;

/**
 * Coerce to Decimal. Numbers are routed through String() so a value that
 * arrived as a JS float does not smuggle binary error into the ledger.
 */
export function dec(value: DecimalLike | null | undefined): Decimal {
  if (value === null || value === undefined || value === '') return new Decimal(0);
  if (value instanceof Decimal) return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`Non-finite quantity: ${value}`);
    return new Decimal(String(value));
  }
  return new Decimal(value);
}

/** Round to the quantity scale actually stored by the database. */
export const qty = (v: DecimalLike): Decimal => dec(v).toDecimalPlaces(QTY_DP, Decimal.ROUND_HALF_UP);

/** Round to the rate scale actually stored by the database. */
export const rate = (v: DecimalLike): Decimal => dec(v).toDecimalPlaces(RATE_DP, Decimal.ROUND_HALF_UP);

/** Round to the money scale actually stored by the database. */
export const amount = (v: DecimalLike): Decimal => dec(v).toDecimalPlaces(AMOUNT_DP, Decimal.ROUND_HALF_UP);

export const isZero = (v: DecimalLike): boolean => dec(v).isZero();
export const isPositive = (v: DecimalLike): boolean => dec(v).greaterThan(0);
export const isNegative = (v: DecimalLike): boolean => dec(v).lessThan(0);

/** Sum a list at quantity scale. */
export function sumQty(values: readonly DecimalLike[]): Decimal {
  return qty(values.reduce<Decimal>((acc, v) => acc.plus(dec(v)), new Decimal(0)));
}

/** Sum a list at money scale. */
export function sumAmount(values: readonly DecimalLike[]): Decimal {
  return amount(values.reduce<Decimal>((acc, v) => acc.plus(dec(v)), new Decimal(0)));
}

/** Largest of the given values, or zero when the list is empty. */
export function maxQty(values: readonly DecimalLike[]): Decimal {
  return values.reduce<Decimal>((acc, v) => Decimal.max(acc, dec(v)), new Decimal(0));
}

/** Clamp a value to >= 0 at quantity scale (shortages are never negative). */
export const clampNonNegative = (v: DecimalLike): Decimal => Decimal.max(dec(v), 0).toDecimalPlaces(QTY_DP);

/** Serialise for transport/persistence as a plain decimal string. */
export const toStr = (v: DecimalLike): string => dec(v).toFixed();
