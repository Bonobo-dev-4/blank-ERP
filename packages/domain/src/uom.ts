import { Decimal, dec, qty, type DecimalLike } from './decimal';
import { ConfigurationError, ERR, ValidationError } from './errors';

export const UOM_CODES = [
  'METER',
  'YARD',
  'PIECE',
  'KILOGRAM',
  'GRAM',
  'ROLL',
  'PACKET',
  'SET',
] as const;

export type UomCode = (typeof UOM_CODES)[number];

/** A configured conversion: qty(toUom) = qty(fromUom) * factor. */
export interface UomConversionRule {
  /** Null/undefined = organisation-wide rule; set = material-specific override. */
  readonly rawMaterialId?: string | null;
  readonly fromUom: UomCode;
  readonly toUom: UomCode;
  readonly factor: DecimalLike;
}

/**
 * Conversions are explicit by design.
 *
 * There is no universal "1 roll = N meters" - it depends on the fabric - and
 * there is no defensible METER <-> KILOGRAM conversion without GSM and width.
 * So this engine will refuse to guess: a conversion that has not been
 * configured raises NO_UOM_CONVERSION rather than silently fabricating stock.
 *
 * Only two things are built in, because they are definitional rather than
 * operational:
 *   - identity (X -> X, factor 1)
 *   - the SI mass prefix KILOGRAM <-> GRAM
 * Everything else - including METER <-> YARD, which is definitional but which
 * real purchase documents still disagree about - must be configured.
 */
const BUILT_IN: ReadonlyArray<UomConversionRule> = [
  { fromUom: 'KILOGRAM', toUom: 'GRAM', factor: '1000' },
  { fromUom: 'GRAM', toUom: 'KILOGRAM', factor: '0.001' },
];

function key(materialId: string | null | undefined, from: UomCode, to: UomCode): string {
  return `${materialId ?? '*'}|${from}|${to}`;
}

export class UomConverter {
  private readonly rules = new Map<string, Decimal>();

  constructor(rules: readonly UomConversionRule[] = []) {
    for (const r of [...BUILT_IN, ...rules]) {
      const factor = dec(r.factor);
      if (!factor.isFinite() || factor.lessThanOrEqualTo(0)) {
        throw new ValidationError(ERR.INVALID_UOM_FACTOR, 'UOM conversion factor must be > 0', {
          fromUom: r.fromUom,
          toUom: r.toUom,
          factor: String(r.factor),
        });
      }
      this.rules.set(key(r.rawMaterialId, r.fromUom, r.toUom), factor);
    }
  }

  /**
   * Resolve the factor for from -> to, preferring a material-specific rule over
   * an organisation-wide one. Returns null when no conversion is configured.
   */
  factorFor(from: UomCode, to: UomCode, rawMaterialId?: string | null): Decimal | null {
    if (from === to) return new Decimal(1);
    if (rawMaterialId) {
      const specific = this.rules.get(key(rawMaterialId, from, to));
      if (specific) return specific;
      // A material-specific inverse is also authoritative for that material.
      const specificInverse = this.rules.get(key(rawMaterialId, to, from));
      if (specificInverse) return new Decimal(1).dividedBy(specificInverse);
    }
    const global = this.rules.get(key(null, from, to));
    if (global) return global;
    const globalInverse = this.rules.get(key(null, to, from));
    if (globalInverse) return new Decimal(1).dividedBy(globalInverse);
    return null;
  }

  /** True when a conversion is available without guessing. */
  canConvert(from: UomCode, to: UomCode, rawMaterialId?: string | null): boolean {
    return this.factorFor(from, to, rawMaterialId) !== null;
  }

  /**
   * Convert a quantity, rounded to the stored quantity scale.
   * Throws NO_UOM_CONVERSION when the conversion is not configured.
   */
  convert(value: DecimalLike, from: UomCode, to: UomCode, rawMaterialId?: string | null): Decimal {
    const factor = this.factorFor(from, to, rawMaterialId);
    if (factor === null) {
      throw new ConfigurationError(
        ERR.NO_UOM_CONVERSION,
        `No configured conversion from ${from} to ${to}`,
        { fromUom: from, toUom: to, rawMaterialId: rawMaterialId ?? null },
      );
    }
    return qty(dec(value).times(factor));
  }

  /** Convert into a material's base (stock-keeping) unit. */
  toBase(
    value: DecimalLike,
    from: UomCode,
    material: { readonly id: string; readonly baseUom: UomCode },
  ): Decimal {
    return this.convert(value, from, material.baseUom, material.id);
  }
}
