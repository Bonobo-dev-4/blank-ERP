import { Decimal, amount, dec, qty, rate, type DecimalLike } from '../decimal';
import { ERR, IllegalStateError, ValidationError } from '../errors';
import type { UomCode } from '../uom';

export const WASTAGE_BASES = [
  'PERCENT_OF_CONSUMPTION',
  'FIXED_PER_UNIT',
  'FIXED_PER_ORDER',
  'NONE',
] as const;

export type WastageBasis = (typeof WASTAGE_BASES)[number];

export const BOM_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SUPERSEDED', 'ARCHIVED'] as const;
export type BomStatus = (typeof BOM_STATUSES)[number];

export interface BomItemInput {
  readonly id?: string;
  readonly lineNo: number;
  readonly rawMaterialId: string;
  readonly materialCode?: string;
  readonly materialName?: string;
  /** Net consumption per `baseQuantity` garments, before wastage. */
  readonly consumptionQty: DecimalLike;
  readonly uom: UomCode;
  readonly wastageBasis: WastageBasis;
  readonly wastageValue: DecimalLike;
  readonly unitCost?: DecimalLike | null;
  readonly productionStageId?: string | null;
  readonly productionStageCode?: string | null;
  /** Size-wise consumption overrides, e.g. { XS: 2.30, XXL: 2.85 }. */
  readonly sizeOverrides?: Readonly<Record<string, DecimalLike>>;
}

export interface BomVersionInput {
  readonly id: string;
  readonly version: number;
  readonly status: BomStatus;
  /** Garment count the item quantities are expressed for (normally 1). */
  readonly baseQuantity: DecimalLike;
  readonly items: readonly BomItemInput[];
}

/** One size/variant line of the quantity being planned. */
export interface ProductionDemandLine {
  readonly productVariantId?: string;
  readonly size?: string | null;
  readonly quantity: DecimalLike;
}

export interface ExplodedRequirement {
  readonly rawMaterialId: string;
  readonly materialCode?: string;
  readonly materialName?: string;
  readonly uom: UomCode;
  readonly productionStageId?: string | null;
  readonly productionStageCode?: string | null;
  /** Consumption for the planned quantity, before wastage. */
  readonly netRequiredQty: Decimal;
  /** Allowance on top of net, per the line's configured wastage basis. */
  readonly wastageQty: Decimal;
  /** netRequiredQty + wastageQty: what must be available to start. */
  readonly grossRequiredQty: Decimal;
  readonly unitCost: Decimal;
  readonly estimatedCost: Decimal;
}

export interface ExplosionResult {
  readonly bomVersionId: string;
  readonly bomVersion: number;
  readonly plannedQty: Decimal;
  readonly requirements: readonly ExplodedRequirement[];
  readonly totalMaterialCost: Decimal;
  /** Planned material cost of a single accepted garment. */
  readonly costPerUnit: Decimal;
}

/** Resolve the per-garment consumption for one BOM line at one size. */
export function consumptionForSize(item: BomItemInput, size?: string | null): Decimal {
  if (size && item.sizeOverrides) {
    const override = item.sizeOverrides[size];
    if (override !== undefined) return qty(override);
  }
  return qty(item.consumptionQty);
}

/**
 * Wastage allowance for a BOM line.
 *
 * `netQty` is the net consumption already scaled to the order quantity, and
 * `orderUnits` is the garment count - needed because FIXED_PER_ORDER is charged
 * once for the whole order rather than per garment.
 */
export function wastageFor(item: BomItemInput, netQty: DecimalLike, orderUnits: DecimalLike): Decimal {
  const net = qty(netQty);
  const units = qty(orderUnits);
  const value = dec(item.wastageValue ?? 0);
  if (value.lessThan(0)) {
    throw new ValidationError('NEGATIVE_WASTAGE', 'Wastage allowance cannot be negative', {
      lineNo: item.lineNo, wastageValue: value.toFixed(),
    });
  }
  switch (item.wastageBasis) {
    case 'PERCENT_OF_CONSUMPTION':
      return qty(net.times(value).dividedBy(100));
    case 'FIXED_PER_UNIT':
      return qty(value.times(units));
    case 'FIXED_PER_ORDER':
      return units.greaterThan(0) ? qty(value) : new Decimal(0);
    case 'NONE':
      return new Decimal(0);
    default:
      throw new ValidationError('UNKNOWN_WASTAGE_BASIS', `Unknown wastage basis`, {
        lineNo: item.lineNo, wastageBasis: item.wastageBasis,
      });
  }
}

/**
 * Explode a BOM version across a size-wise demand into material requirements.
 *
 * Worked example from the specification:
 *   100 kurtas, main fabric 2.5 m each, 5% wastage
 *     net   = 100 x 2.5            = 250.0000 m
 *     waste = 250 x 5%             =  12.5000 m
 *     gross = 250 + 12.5           = 262.5000 m
 *
 * Size overrides are applied per demand line before scaling, so an order of
 * 50 M at 2.5 m and 50 XXL at 2.85 m requires 267.5 m net, not 250 m.
 */
export function explodeBom(
  bom: BomVersionInput,
  demand: readonly ProductionDemandLine[],
  options: { readonly requireApproved?: boolean; readonly costLookup?: (rawMaterialId: string) => DecimalLike | null } = {},
): ExplosionResult {
  if (options.requireApproved !== false && bom.status !== 'APPROVED') {
    throw new IllegalStateError(
      ERR.BOM_NOT_APPROVED,
      `BOM version ${bom.version} is ${bom.status}; only an APPROVED BOM may drive production`,
      { bomVersionId: bom.id, status: bom.status },
    );
  }
  if (bom.items.length === 0) {
    throw new IllegalStateError(ERR.BOM_EMPTY, 'BOM version has no material lines', {
      bomVersionId: bom.id,
    });
  }

  const base = qty(bom.baseQuantity);
  if (base.lessThanOrEqualTo(0)) {
    throw new ValidationError('INVALID_BOM_BASE_QUANTITY', 'BOM base quantity must be greater than zero', {
      bomVersionId: bom.id, baseQuantity: base.toFixed(),
    });
  }

  const totalUnits = demand.reduce<Decimal>((acc, d) => acc.plus(qty(d.quantity)), new Decimal(0));
  if (totalUnits.lessThanOrEqualTo(0)) {
    throw new ValidationError(ERR.NON_POSITIVE_QTY, 'Planned quantity must be greater than zero', {
      plannedQty: totalUnits.toFixed(),
    });
  }

  // Accumulate net consumption per material across every size line.
  const netByMaterial = new Map<string, Decimal>();
  const itemByMaterial = new Map<string, BomItemInput>();

  for (const item of bom.items) {
    itemByMaterial.set(item.rawMaterialId, item);
    let net = netByMaterial.get(item.rawMaterialId) ?? new Decimal(0);
    for (const line of demand) {
      const units = qty(line.quantity);
      if (units.lessThanOrEqualTo(0)) continue;
      const perGarment = consumptionForSize(item, line.size).dividedBy(base);
      net = net.plus(perGarment.times(units));
    }
    netByMaterial.set(item.rawMaterialId, net);
  }

  const requirements: ExplodedRequirement[] = [];
  let totalCost = new Decimal(0);

  for (const [rawMaterialId, netRaw] of netByMaterial) {
    const item = itemByMaterial.get(rawMaterialId)!;
    const net = qty(netRaw);
    const wastage = wastageFor(item, net, totalUnits);
    const gross = qty(net.plus(wastage));

    const unitCost = rate(
      item.unitCost ?? options.costLookup?.(rawMaterialId) ?? 0,
    );
    const cost = amount(gross.times(unitCost));
    totalCost = totalCost.plus(cost);

    requirements.push({
      rawMaterialId,
      materialCode: item.materialCode,
      materialName: item.materialName,
      uom: item.uom,
      productionStageId: item.productionStageId ?? null,
      productionStageCode: item.productionStageCode ?? null,
      netRequiredQty: net,
      wastageQty: wastage,
      grossRequiredQty: gross,
      unitCost,
      estimatedCost: cost,
    });
  }

  requirements.sort((a, b) => {
    const la = itemByMaterial.get(a.rawMaterialId)!.lineNo;
    const lb = itemByMaterial.get(b.rawMaterialId)!.lineNo;
    return la - lb;
  });

  const total = amount(totalCost);
  return {
    bomVersionId: bom.id,
    bomVersion: bom.version,
    plannedQty: qty(totalUnits),
    requirements,
    totalMaterialCost: total,
    costPerUnit: rate(total.dividedBy(totalUnits)),
  };
}

/**
 * Freeze a BOM version into the immutable snapshot a released manufacturing
 * order carries. Once written, later edits to the master BOM cannot reach this
 * order - the snapshot, not the master, is what costing and issue limits use.
 */
export interface BomSnapshotLine {
  readonly lineNo: number;
  readonly rawMaterialId: string;
  readonly materialCode: string;
  readonly materialName: string;
  readonly consumptionQtyPerUnit: Decimal;
  readonly wastageQtyPerUnit: Decimal;
  readonly grossQtyPerUnit: Decimal;
  readonly uom: UomCode;
  readonly unitCost: Decimal;
  readonly plannedQty: Decimal;
  readonly plannedCost: Decimal;
  readonly productionStageCode: string | null;
}

export function snapshotBom(bom: BomVersionInput, explosion: ExplosionResult): BomSnapshotLine[] {
  const itemByMaterial = new Map(bom.items.map((i) => [i.rawMaterialId, i]));
  return explosion.requirements.map((req) => {
    const item = itemByMaterial.get(req.rawMaterialId)!;
    const units = explosion.plannedQty;
    return {
      lineNo: item.lineNo,
      rawMaterialId: req.rawMaterialId,
      materialCode: req.materialCode ?? '',
      materialName: req.materialName ?? '',
      consumptionQtyPerUnit: qty(req.netRequiredQty.dividedBy(units)),
      wastageQtyPerUnit: qty(req.wastageQty.dividedBy(units)),
      grossQtyPerUnit: qty(req.grossRequiredQty.dividedBy(units)),
      uom: req.uom,
      unitCost: req.unitCost,
      plannedQty: req.grossRequiredQty,
      plannedCost: req.estimatedCost,
      productionStageCode: req.productionStageCode ?? null,
    };
  });
}

/**
 * Compare two BOM versions line by line. Used by the BOM comparison screen and
 * by the warning shown when a planner revises a BOM that live orders depend on.
 */
export interface BomDiffLine {
  readonly rawMaterialId: string;
  readonly change: 'ADDED' | 'REMOVED' | 'CHANGED' | 'UNCHANGED';
  readonly fromConsumptionQty: Decimal | null;
  readonly toConsumptionQty: Decimal | null;
  readonly fromGrossPerUnit: Decimal | null;
  readonly toGrossPerUnit: Decimal | null;
}

export function diffBomVersions(from: BomVersionInput, to: BomVersionInput): BomDiffLine[] {
  const grossPerUnit = (bom: BomVersionInput, item: BomItemInput): Decimal => {
    const base = qty(bom.baseQuantity);
    const net = qty(item.consumptionQty).dividedBy(base);
    return qty(net.plus(wastageFor(item, net, 1)));
  };

  const fromMap = new Map(from.items.map((i) => [i.rawMaterialId, i]));
  const toMap = new Map(to.items.map((i) => [i.rawMaterialId, i]));
  const ids = [...new Set([...fromMap.keys(), ...toMap.keys()])].sort();

  return ids.map((id) => {
    const f = fromMap.get(id);
    const t = toMap.get(id);
    if (f && !t) {
      return { rawMaterialId: id, change: 'REMOVED' as const,
        fromConsumptionQty: qty(f.consumptionQty), toConsumptionQty: null,
        fromGrossPerUnit: grossPerUnit(from, f), toGrossPerUnit: null };
    }
    if (!f && t) {
      return { rawMaterialId: id, change: 'ADDED' as const,
        fromConsumptionQty: null, toConsumptionQty: qty(t.consumptionQty),
        fromGrossPerUnit: null, toGrossPerUnit: grossPerUnit(to, t) };
    }
    const fg = grossPerUnit(from, f!);
    const tg = grossPerUnit(to, t!);
    return {
      rawMaterialId: id,
      change: fg.equals(tg) ? ('UNCHANGED' as const) : ('CHANGED' as const),
      fromConsumptionQty: qty(f!.consumptionQty),
      toConsumptionQty: qty(t!.consumptionQty),
      fromGrossPerUnit: fg,
      toGrossPerUnit: tg,
    };
  });
}
