import { Decimal, amount, clampNonNegative, dec, qty, rate, type DecimalLike } from '../decimal';
import type { ExplodedRequirement } from '../bom/explode';
import type { UomCode } from '../uom';

/** What the planner knows about one material at the moment of the MRP run. */
export interface MaterialSupplyPosition {
  readonly rawMaterialId: string;
  /** Unreserved stock in issuable locations. */
  readonly availableQty: DecimalLike;
  /** Stock reserved by OTHER manufacturing orders. */
  readonly reservedElsewhereQty: DecimalLike;
  /** Open purchase order quantity not yet received. Supply, never stock. */
  readonly openPurchaseQty?: DecimalLike;
  /** Earliest date the open purchase quantity is expected. */
  readonly expectedArrivalDate?: Date | null;
  readonly leadTimeDays?: number;
  readonly unitCost?: DecimalLike | null;
  /** Supplier minimum order quantity, when one applies. */
  readonly minimumOrderQty?: DecimalLike | null;
  /** Purchasable increment (e.g. full rolls only). */
  readonly orderMultiple?: DecimalLike | null;
  readonly uom?: UomCode;
}

export type MaterialReadiness = 'READY' | 'PARTIALLY_AVAILABLE' | 'SHORT' | 'SHORT_AND_LATE';

export interface MrpLine {
  readonly rawMaterialId: string;
  readonly materialCode?: string;
  readonly materialName?: string;
  readonly uom: UomCode;
  readonly netRequiredQty: Decimal;
  readonly wastageQty: Decimal;
  /** What must be on hand to start: net + wastage allowance. */
  readonly grossRequiredQty: Decimal;
  readonly availableQty: Decimal;
  readonly reservedElsewhereQty: Decimal;
  /** Reported alongside the shortage; deliberately NOT counted as stock. */
  readonly openPurchaseQty: Decimal;
  readonly expectedArrivalDate: Date | null;
  readonly shortageQty: Decimal;
  /** Shortage remaining even after the open purchase quantity lands. */
  readonly uncoveredShortageQty: Decimal;
  readonly suggestedPurchaseQty: Decimal;
  readonly unitCost: Decimal;
  readonly estimatedCost: Decimal;
  readonly shortageValue: Decimal;
  readonly readiness: MaterialReadiness;
  /** True when incoming supply is expected after the production needs it. */
  readonly arrivesLate: boolean;
}

export interface MrpResult {
  readonly plannedQty: Decimal;
  readonly lines: readonly MrpLine[];
  readonly shortageLineCount: number;
  readonly totalShortageValue: Decimal;
  readonly totalEstimatedCost: Decimal;
  /** True when every line has zero shortage: production can start cleanly. */
  readonly isProductionReady: boolean;
  /** Lines that still block production even counting incoming supply. */
  readonly blockingMaterialIds: readonly string[];
}

export interface MrpOptions {
  /** When production must start; used to judge whether supply arrives in time. */
  readonly requiredByDate?: Date | null;
  /** Date the run is evaluated against. Defaults to now. */
  readonly asOf?: Date;
}

/**
 * Round a purchase suggestion up to something a supplier will actually accept.
 */
export function roundPurchaseQty(
  shortage: DecimalLike,
  opts: { minimumOrderQty?: DecimalLike | null; orderMultiple?: DecimalLike | null } = {},
): Decimal {
  let q = clampNonNegative(shortage);
  if (q.lessThanOrEqualTo(0)) return new Decimal(0);

  const min = opts.minimumOrderQty != null ? qty(opts.minimumOrderQty) : null;
  if (min && min.greaterThan(0) && q.lessThan(min)) q = min;

  const mult = opts.orderMultiple != null ? qty(opts.orderMultiple) : null;
  if (mult && mult.greaterThan(0)) {
    const steps = q.dividedBy(mult).toDecimalPlaces(0, Decimal.ROUND_CEIL);
    q = qty(steps.times(mult));
  }
  return qty(q);
}

/**
 * Run material requirement planning for one exploded BOM.
 *
 * Two rules distinguish this from a naive "required minus stock" subtraction:
 *
 *  1. Open supplier purchase orders are NOT treated as stock. They are reported
 *     with their expected arrival date so a planner can decide, but the
 *     shortage figure is computed against physically available stock only.
 *  2. Stock reserved by other manufacturing orders is already excluded from
 *     `availableQty`, and is reported separately so the planner can see that
 *     the material exists but is promised elsewhere.
 *
 * Worked example from the specification:
 *   gross required 262.5 m, available unreserved 180 m -> shortage 82.5 m
 */
export function runMrp(
  requirements: readonly ExplodedRequirement[],
  supply: readonly MaterialSupplyPosition[],
  plannedQty: DecimalLike,
  options: MrpOptions = {},
): MrpResult {
  const supplyById = new Map(supply.map((s) => [s.rawMaterialId, s]));
  const requiredBy = options.requiredByDate ?? null;

  const lines: MrpLine[] = requirements.map((req) => {
    const s = supplyById.get(req.rawMaterialId);
    const available = qty(s?.availableQty ?? 0);
    const reservedElsewhere = qty(s?.reservedElsewhereQty ?? 0);
    const openPurchase = qty(s?.openPurchaseQty ?? 0);
    const expectedArrival = s?.expectedArrivalDate ?? null;

    const shortage = clampNonNegative(req.grossRequiredQty.minus(available));
    const uncovered = clampNonNegative(shortage.minus(openPurchase));

    const arrivesLate =
      shortage.greaterThan(0) &&
      openPurchase.greaterThan(0) &&
      requiredBy != null &&
      expectedArrival != null &&
      expectedArrival.getTime() > requiredBy.getTime();

    const unitCost = rate(req.unitCost ?? s?.unitCost ?? 0);

    let readiness: MaterialReadiness;
    if (shortage.lessThanOrEqualTo(0)) readiness = 'READY';
    else if (arrivesLate || uncovered.greaterThan(0)) {
      readiness = arrivesLate ? 'SHORT_AND_LATE' : 'SHORT';
    } else readiness = 'PARTIALLY_AVAILABLE';

    return {
      rawMaterialId: req.rawMaterialId,
      materialCode: req.materialCode,
      materialName: req.materialName,
      uom: req.uom,
      netRequiredQty: req.netRequiredQty,
      wastageQty: req.wastageQty,
      grossRequiredQty: req.grossRequiredQty,
      availableQty: available,
      reservedElsewhereQty: reservedElsewhere,
      openPurchaseQty: openPurchase,
      expectedArrivalDate: expectedArrival,
      shortageQty: shortage,
      uncoveredShortageQty: uncovered,
      suggestedPurchaseQty: roundPurchaseQty(uncovered, {
        minimumOrderQty: s?.minimumOrderQty ?? null,
        orderMultiple: s?.orderMultiple ?? null,
      }),
      unitCost,
      estimatedCost: amount(req.grossRequiredQty.times(unitCost)),
      shortageValue: amount(shortage.times(unitCost)),
      readiness,
      arrivesLate,
    };
  });

  const shortageLines = lines.filter((l) => l.shortageQty.greaterThan(0));
  const blocking = lines.filter((l) => l.uncoveredShortageQty.greaterThan(0) || l.arrivesLate);

  return {
    plannedQty: qty(plannedQty),
    lines,
    shortageLineCount: shortageLines.length,
    totalShortageValue: amount(
      shortageLines.reduce<Decimal>((acc, l) => acc.plus(l.shortageValue), new Decimal(0)),
    ),
    totalEstimatedCost: amount(
      lines.reduce<Decimal>((acc, l) => acc.plus(l.estimatedCost), new Decimal(0)),
    ),
    isProductionReady: shortageLines.length === 0,
    blockingMaterialIds: blocking.map((l) => l.rawMaterialId),
  };
}

/**
 * The largest garment quantity that current stock can fully cover.
 *
 * Used for authorised partial releases: rather than asking a planner to guess,
 * this answers "we wanted 100, how many can we actually start today?" It is the
 * minimum across materials of (available / gross-per-garment), floored to whole
 * garments because half a kurta is not a releasable quantity.
 */
export function maxProducibleQty(
  requirements: readonly ExplodedRequirement[],
  supply: readonly MaterialSupplyPosition[],
  plannedQty: DecimalLike,
): Decimal {
  const planned = qty(plannedQty);
  if (planned.lessThanOrEqualTo(0) || requirements.length === 0) return new Decimal(0);
  const supplyById = new Map(supply.map((s) => [s.rawMaterialId, s]));

  let limit: Decimal | null = null;
  for (const req of requirements) {
    const perGarment = req.grossRequiredQty.dividedBy(planned);
    if (perGarment.lessThanOrEqualTo(0)) continue;
    const available = qty(supplyById.get(req.rawMaterialId)?.availableQty ?? 0);
    const canMake = available.dividedBy(perGarment).toDecimalPlaces(0, Decimal.ROUND_FLOOR);
    limit = limit === null ? canMake : Decimal.min(limit, canMake);
  }
  if (limit === null) return planned;
  return Decimal.max(Decimal.min(limit, planned), 0);
}

/**
 * Aggregate the same material across several MRP runs (the all-store demand
 * aggregation view). Requirements add up; supply is counted once.
 */
export function aggregateMrpLines(runs: readonly MrpResult[]): MrpLine[] {
  const byMaterial = new Map<string, MrpLine>();
  for (const run of runs) {
    for (const line of run.lines) {
      const existing = byMaterial.get(line.rawMaterialId);
      if (!existing) { byMaterial.set(line.rawMaterialId, line); continue; }
      const net = qty(existing.netRequiredQty.plus(line.netRequiredQty));
      const waste = qty(existing.wastageQty.plus(line.wastageQty));
      const gross = qty(existing.grossRequiredQty.plus(line.grossRequiredQty));
      // Supply figures describe the material, not the run: take them once.
      const available = existing.availableQty;
      const shortage = clampNonNegative(gross.minus(available));
      const uncovered = clampNonNegative(shortage.minus(existing.openPurchaseQty));
      byMaterial.set(line.rawMaterialId, {
        ...existing,
        netRequiredQty: net,
        wastageQty: waste,
        grossRequiredQty: gross,
        shortageQty: shortage,
        uncoveredShortageQty: uncovered,
        suggestedPurchaseQty: roundPurchaseQty(uncovered),
        estimatedCost: amount(gross.times(existing.unitCost)),
        shortageValue: amount(shortage.times(existing.unitCost)),
        readiness: shortage.lessThanOrEqualTo(0) ? 'READY' : uncovered.greaterThan(0) ? 'SHORT' : 'PARTIALLY_AVAILABLE',
      });
    }
  }
  return [...byMaterial.values()].sort((a, b) =>
    (a.materialCode ?? a.rawMaterialId) < (b.materialCode ?? b.rawMaterialId) ? -1 : 1,
  );
}
