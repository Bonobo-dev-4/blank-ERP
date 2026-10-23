import { Decimal, clampNonNegative, qty, type DecimalLike } from '../decimal';
import { ERR, IllegalStateError, ValidationError } from '../errors';
import type { MrpLine } from '../mrp/plan';

export const MO_STATUSES = [
  'DRAFT',
  'PENDING_MATERIAL',
  'MATERIAL_RESERVED',
  'RELEASED',
  'IN_PROGRESS',
  'ON_HOLD',
  'COMPLETED',
  'CLOSED',
  'CANCELLED',
] as const;

export type MoStatus = (typeof MO_STATUSES)[number];

/**
 * The manufacturing order lifecycle.
 *
 * Two properties are encoded here rather than left to each call site:
 *
 *  1. **Release is one-way.** Nothing returns to DRAFT, PENDING_MATERIAL or
 *     MATERIAL_RESERVED once an order has been released, because release
 *     freezes the BOM snapshot that costing and issue limits read from. A path
 *     back would let an order be re-released against a different BOM while
 *     material issued under the first one is already on the floor.
 *  2. **CLOSED and CANCELLED are terminal.** An order that needs to run again
 *     is a new order with its own number, so the history of what was actually
 *     made stays readable.
 */
export const MO_TRANSITIONS: Readonly<Record<MoStatus, readonly MoStatus[]>> = {
  DRAFT: ['PENDING_MATERIAL', 'MATERIAL_RESERVED', 'RELEASED', 'CANCELLED'],
  PENDING_MATERIAL: ['MATERIAL_RESERVED', 'PENDING_MATERIAL', 'RELEASED', 'CANCELLED'],
  MATERIAL_RESERVED: ['PENDING_MATERIAL', 'MATERIAL_RESERVED', 'RELEASED', 'CANCELLED'],
  RELEASED: ['IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'],
  IN_PROGRESS: ['ON_HOLD', 'COMPLETED', 'CANCELLED'],
  ON_HOLD: ['RELEASED', 'IN_PROGRESS', 'CANCELLED'],
  COMPLETED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

/** Statuses at which the order has not yet been frozen onto the floor. */
export const MO_PLANNING_STATUSES: readonly MoStatus[] = [
  'DRAFT',
  'PENDING_MATERIAL',
  'MATERIAL_RESERVED',
];

/** Statuses at which material is committed and work may be happening. */
export const MO_ACTIVE_STATUSES: readonly MoStatus[] = [
  'RELEASED',
  'IN_PROGRESS',
  'ON_HOLD',
];

export function isTerminalMoStatus(status: MoStatus): boolean {
  return MO_TRANSITIONS[status].length === 0;
}

export function canTransitionMo(from: MoStatus, to: MoStatus): boolean {
  return MO_TRANSITIONS[from].includes(to);
}

export function assertMoTransition(from: MoStatus, to: MoStatus): void {
  if (canTransitionMo(from, to)) return;
  throw new IllegalStateError(
    'MO_ILLEGAL_TRANSITION',
    `A manufacturing order cannot move from ${from} to ${to}`,
    { from, to, allowed: MO_TRANSITIONS[from] },
  );
}

/**
 * Whether an order's planning details may still be edited.
 *
 * Editing after release would change quantities the floor is already working
 * to, so the answer is no for everything past the planning statuses.
 */
export function isMoEditable(status: MoStatus): boolean {
  return MO_PLANNING_STATUSES.includes(status);
}

// -----------------------------------------------------------------------------
// Release assessment
// -----------------------------------------------------------------------------

export interface MoShortage {
  readonly rawMaterialId: string;
  readonly materialCode?: string;
  readonly materialName?: string;
  readonly grossRequiredQty: Decimal;
  readonly availableQty: Decimal;
  readonly shortageQty: Decimal;
  readonly isCritical: boolean;
}

export interface MoReleaseAssessment {
  /** True when release may proceed without a shortage override. */
  readonly isClear: boolean;
  /** True when release is possible only with `manufacturing.release_with_shortage`. */
  readonly requiresOverride: boolean;
  readonly shortages: readonly MoShortage[];
  /** Shortages on lines production cannot start without. */
  readonly criticalShortages: readonly MoShortage[];
  readonly totalShortageValue: Decimal;
  /** Largest whole-garment quantity current stock fully covers. */
  readonly maxProducibleQty: Decimal;
}

/**
 * Decide whether a manufacturing order may be released.
 *
 * The distinction that matters is **critical versus non-critical**. Being short
 * of main fabric and being short of hang tags are not the same problem: one
 * stops the cutting table, the other is resolved before despatch. Blocking both
 * identically trains planners to use the override reflexively, which defeats
 * the control — so only critical lines require it.
 *
 * Open purchase orders are deliberately NOT treated as cover. A planner may
 * still release with an override after seeing the expected arrival date, but
 * that is a judgement someone signs for, not an automatic allowance.
 */
export function assessMoRelease(
  lines: readonly MrpLine[],
  criticality: Readonly<Record<string, boolean>> = {},
  options: { readonly releaseQty?: DecimalLike; readonly plannedQty?: DecimalLike } = {},
): MoReleaseAssessment {
  const planned = options.plannedQty != null ? qty(options.plannedQty) : null;
  const requested = options.releaseQty != null ? qty(options.releaseQty) : null;

  if (requested != null && requested.lessThanOrEqualTo(0)) {
    throw new ValidationError(ERR.NON_POSITIVE_QTY, 'Release quantity must be greater than zero', {
      releaseQty: requested.toFixed(),
    });
  }
  if (requested != null && planned != null && requested.greaterThan(planned)) {
    throw new ValidationError('RELEASE_EXCEEDS_ORDERED', 'Release quantity exceeds the ordered quantity', {
      releaseQty: requested.toFixed(),
      orderedQty: planned.toFixed(),
    });
  }

  // A partial release needs proportionally less material, so requirements are
  // scaled before the shortage is judged. Without this, releasing 50 of 100
  // would still be blocked by a shortage that only applies to the full run.
  const scale =
    requested != null && planned != null && planned.greaterThan(0)
      ? requested.dividedBy(planned)
      : new Decimal(1);

  const shortages: MoShortage[] = [];
  let shortageValue = new Decimal(0);
  let producible: Decimal | null = null;

  for (const line of lines) {
    const required = qty(line.grossRequiredQty.times(scale));
    const short = clampNonNegative(required.minus(line.availableQty));

    // How many garments this one material can cover, floored: half a kurta is
    // not a releasable quantity.
    if (planned != null && planned.greaterThan(0)) {
      const perGarment = line.grossRequiredQty.dividedBy(planned);
      if (perGarment.greaterThan(0)) {
        const canMake = line.availableQty.dividedBy(perGarment).toDecimalPlaces(0, Decimal.ROUND_FLOOR);
        producible = producible === null ? canMake : Decimal.min(producible, canMake);
      }
    }

    if (short.lessThanOrEqualTo(0)) continue;

    shortages.push({
      rawMaterialId: line.rawMaterialId,
      materialCode: line.materialCode,
      materialName: line.materialName,
      grossRequiredQty: required,
      availableQty: line.availableQty,
      shortageQty: short,
      // Unknown materials are treated as critical. A missing flag must fail
      // safe: wrongly blocking a release is recoverable, wrongly starting one
      // without fabric is not.
      isCritical: criticality[line.rawMaterialId] ?? true,
    });
    shortageValue = shortageValue.plus(short.times(line.unitCost));
  }

  const critical = shortages.filter((s) => s.isCritical);
  const cap = planned ?? new Decimal(0);

  return {
    isClear: critical.length === 0,
    requiresOverride: critical.length > 0,
    shortages,
    criticalShortages: critical,
    totalShortageValue: shortageValue.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    maxProducibleQty:
      producible === null ? cap : Decimal.max(Decimal.min(producible, cap), 0),
  };
}

/**
 * Guard the release itself.
 *
 * Separate from `assessMoRelease` because assessment is a read — the MO detail
 * screen shows it live, before anyone commits to anything — while this is the
 * decision, and it needs the caller's authority and stated reason.
 */
export function authoriseMoRelease(
  assessment: MoReleaseAssessment,
  caller: { readonly hasShortageOverride: boolean; readonly reason?: string | null },
): void {
  if (assessment.isClear) return;

  if (!caller.hasShortageOverride) {
    throw new IllegalStateError(
      'SHORTAGE_OVERRIDE_REQUIRED',
      'This order is short of critical material and you do not hold the permission to release it anyway',
      {
        requiredPermission: 'manufacturing.release_with_shortage',
        shortageCount: assessment.criticalShortages.length,
        // Quantities are reported at the database's own scale, so the numbers
        // in the error read the same as the numbers on the screen.
        shortages: assessment.criticalShortages.map((s) => ({
          materialCode: s.materialCode ?? s.rawMaterialId,
          requiredQty: s.grossRequiredQty.toFixed(4),
          availableQty: s.availableQty.toFixed(4),
          shortageQty: s.shortageQty.toFixed(4),
        })),
        maxProducibleQty: assessment.maxProducibleQty.toFixed(),
      },
    );
  }

  const reason = caller.reason?.trim() ?? '';
  if (reason.length < 10) {
    throw new ValidationError(
      'SHORTAGE_OVERRIDE_REASON_REQUIRED',
      'Releasing short of material requires a written reason of at least 10 characters',
      { shortageCount: assessment.criticalShortages.length },
    );
  }
}

/**
 * Roll an order's per-line quantities up to the header.
 *
 * Header totals are derived rather than maintained in parallel, because two
 * places holding the same number is how they come to disagree.
 */
export interface MoItemQuantities {
  readonly orderedQty: DecimalLike;
  readonly releasedQty: DecimalLike;
  readonly completedQty: DecimalLike;
  readonly rejectedQty: DecimalLike;
  readonly inwardedQty: DecimalLike;
  readonly cancelledQty: DecimalLike;
}

export interface MoRollup {
  readonly orderedQty: Decimal;
  readonly releasedQty: Decimal;
  readonly completedQty: Decimal;
  readonly rejectedQty: Decimal;
  readonly inwardedQty: Decimal;
  readonly cancelledQty: Decimal;
  /** Ordered minus released minus cancelled: still to be put on the floor. */
  readonly pendingReleaseQty: Decimal;
  readonly completionPct: Decimal;
}

export function rollupMoQuantities(items: readonly MoItemQuantities[]): MoRollup {
  const sum = (pick: (i: MoItemQuantities) => DecimalLike): Decimal =>
    qty(items.reduce<Decimal>((acc, i) => acc.plus(qty(pick(i))), new Decimal(0)));

  const ordered = sum((i) => i.orderedQty);
  const released = sum((i) => i.releasedQty);
  const cancelled = sum((i) => i.cancelledQty);
  const inwarded = sum((i) => i.inwardedQty);

  return {
    orderedQty: ordered,
    releasedQty: released,
    completedQty: sum((i) => i.completedQty),
    rejectedQty: sum((i) => i.rejectedQty),
    inwardedQty: inwarded,
    cancelledQty: cancelled,
    pendingReleaseQty: clampNonNegative(ordered.minus(released).minus(cancelled)),
    completionPct: ordered.greaterThan(0)
      ? inwarded.dividedBy(ordered).times(100).toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
      : new Decimal(0),
  };
}
