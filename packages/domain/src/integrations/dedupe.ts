import { createHash } from 'node:crypto';
import { Decimal, qty, type DecimalLike } from '../decimal';

export const SOURCE_SYSTEMS = ['MANUAL', 'SHOPIFY', 'UNICOMMERCE'] as const;
export type SourceSystem = (typeof SOURCE_SYSTEMS)[number];

export interface SourceDocumentLineRef {
  readonly sourceSystem: SourceSystem;
  /** SHOPIFY_ORDER / SHOPIFY_POS_ORDER / UNICOMMERCE_PURCHASE_ORDER / MANUAL */
  readonly sourceDocType: string;
  readonly sourceDocId: string;
  readonly sourceLineId: string;
}

/**
 * Identity key for an imported source line. Enforced by a unique index, this
 * is what makes a replayed Shopify webhook or a re-run Unicommerce PO import a
 * no-op instead of a second helping of manufacturing demand.
 */
export function sourceLineKey(ref: SourceDocumentLineRef): string {
  return [ref.sourceSystem, ref.sourceDocType, ref.sourceDocId, ref.sourceLineId].join('|');
}

export interface EconomicDemandIdentity {
  /** Canonical internal variant, when the SKU is mapped. */
  readonly productVariantId?: string | null;
  /** External SKU, used when the variant is not mapped yet. */
  readonly externalSku?: string | null;
  /**
   * The COMMERCE order this demand ultimately serves, normalised across
   * systems. For a Shopify order that is also pushed into Unicommerce, both
   * imports must produce the same value here - that is the whole point.
   */
  readonly commerceOrderRef: string;
  /** Line discriminator within that commerce order (SKU is usually enough). */
  readonly commerceLineRef: string;
}

/**
 * Normalise a commerce order reference so the same order written differently
 * by two systems still matches: "#158420", "158420" and "DD-158420" all
 * reduce to their significant digits and letters.
 */
export function normaliseCommerceRef(ref: string): string {
  return ref.trim().toUpperCase().replace(/^#/, '').replace(/[^0-9A-Z]/g, '');
}

/**
 * Fingerprint of one unit of economic demand.
 *
 * Deduplication across systems cannot key on the source document, because the
 * same demand legitimately arrives as two different documents. It keys on what
 * the demand *is*: this SKU, for that commerce order line.
 *
 * Shopify order #158420 line JACKET-L imported directly, and the same order
 * mirrored into Unicommerce, both normalise to the same triple and therefore
 * collapse onto a single ManufacturingDemand row with two DemandSourceMapping
 * rows recording where each sighting came from.
 */
export function demandFingerprint(identity: EconomicDemandIdentity): string {
  const sku = (identity.productVariantId ?? identity.externalSku ?? '').trim().toUpperCase();
  const parts = [
    normaliseCommerceRef(identity.commerceOrderRef),
    identity.commerceLineRef.trim().toUpperCase(),
    sku,
  ];
  return createHash('sha256').update(parts.join(' ')).digest('hex').slice(0, 48);
}

export type DemandAction =
  | 'CREATE'
  | 'ATTACH_TO_EXISTING'
  | 'UPDATE_QUANTITY'
  | 'IGNORE_DUPLICATE';

export interface DemandReconciliation {
  readonly action: DemandAction;
  readonly reason: string;
  readonly quantityDelta?: Decimal;
}

/**
 * Decide what an incoming source line should do to demand state.
 *
 * Handles the four cases the specification calls out: a brand-new line, the
 * same line delivered twice (duplicate webhook), the same economic demand
 * arriving via a second system, and an amended quantity.
 */
export function reconcileIncomingDemand(input: {
  /** An existing demand row carrying this fingerprint, if any. */
  readonly existingDemand?: { readonly id: string; readonly requestedQty: DecimalLike } | null;
  /** A mapping row already recording THIS source line, if any. */
  readonly existingMapping?: { readonly sourceLineQty: DecimalLike } | null;
  readonly incomingQty: DecimalLike;
}): DemandReconciliation {
  const incoming = qty(input.incomingQty);

  if (input.existingMapping) {
    const seen = qty(input.existingMapping.sourceLineQty);
    if (seen.equals(incoming)) {
      return {
        action: 'IGNORE_DUPLICATE',
        reason: 'This source line has already been imported with the same quantity',
      };
    }
    return {
      action: 'UPDATE_QUANTITY',
      reason: 'The source line quantity was amended externally',
      quantityDelta: qty(incoming.minus(seen)),
    };
  }

  if (input.existingDemand) {
    return {
      action: 'ATTACH_TO_EXISTING',
      reason:
        'The same economic demand already exists from another source system; attaching a mapping instead of creating duplicate demand',
    };
  }

  return { action: 'CREATE', reason: 'New demand' };
}

export const INVENTORY_AVAILABILITY_STATUSES = [
  'PENDING_CHECK',
  'AVAILABLE',
  'PARTIALLY_AVAILABLE',
  'OUT_OF_STOCK',
  'ALLOCATION_PENDING',
  'ALLOCATION_CONFIRMED',
  'INVENTORY_CHECK_FAILED',
] as const;
export type InventoryAvailabilityStatus = (typeof INVENTORY_AVAILABILITY_STATUSES)[number];

export interface AvailabilityAssessment {
  readonly status: InventoryAvailabilityStatus;
  readonly availableQty: Decimal;
  /** Quantity that still has to be manufactured. */
  readonly manufacturingQty: Decimal;
  readonly snapshotAgeSeconds: number | null;
  readonly isSnapshotStale: boolean;
}

/**
 * Decide how much of an order line actually needs manufacturing.
 *
 * The distinction this preserves is the one the specification stresses:
 * available stock is not reserved stock. A facility snapshot is evidence that
 * stock existed at a moment in time, nothing more. So:
 *
 *  - only a CONFIRMED external allocation reduces the manufacturing quantity;
 *  - an unconfirmed snapshot yields ALLOCATION_PENDING, and the uncovered
 *    quantity is reported but not committed either way;
 *  - a snapshot older than `maxSnapshotAgeSeconds` is treated as stale, which
 *    stops a planner acting on yesterday's stock position.
 */
export function assessLineAvailability(input: {
  readonly orderedQty: DecimalLike;
  readonly cancelledQty?: DecimalLike;
  /** Facility-level available quantity from the external snapshot. */
  readonly snapshotAvailableQty?: DecimalLike | null;
  readonly snapshotAt?: Date | null;
  /** Quantity an external allocation call has actually confirmed. */
  readonly confirmedAllocationQty?: DecimalLike;
  readonly checkFailed?: boolean;
  readonly asOf?: Date;
  readonly maxSnapshotAgeSeconds?: number;
}): AvailabilityAssessment {
  const asOf = input.asOf ?? new Date();
  const maxAge = input.maxSnapshotAgeSeconds ?? 900;
  const net = qty(qty(input.orderedQty).minus(qty(input.cancelledQty ?? 0)));
  const confirmed = qty(input.confirmedAllocationQty ?? 0);

  const ageSeconds =
    input.snapshotAt != null ? Math.max(0, Math.floor((asOf.getTime() - input.snapshotAt.getTime()) / 1000)) : null;
  const stale = ageSeconds == null ? true : ageSeconds > maxAge;

  if (input.checkFailed) {
    return {
      status: 'INVENTORY_CHECK_FAILED',
      availableQty: new Decimal(0),
      // Nothing is assumed about stock, so nothing is netted off.
      manufacturingQty: net,
      snapshotAgeSeconds: ageSeconds,
      isSnapshotStale: stale,
    };
  }

  if (confirmed.greaterThan(0)) {
    const remaining = Decimal.max(net.minus(confirmed), 0);
    return {
      status: remaining.isZero() ? 'ALLOCATION_CONFIRMED' : 'PARTIALLY_AVAILABLE',
      availableQty: confirmed,
      manufacturingQty: qty(remaining),
      snapshotAgeSeconds: ageSeconds,
      isSnapshotStale: stale,
    };
  }

  const snapshotAvailable = input.snapshotAvailableQty == null ? null : qty(input.snapshotAvailableQty);

  if (snapshotAvailable == null) {
    return {
      status: 'PENDING_CHECK',
      availableQty: new Decimal(0),
      manufacturingQty: net,
      snapshotAgeSeconds: ageSeconds,
      isSnapshotStale: stale,
    };
  }

  if (snapshotAvailable.lessThanOrEqualTo(0)) {
    return {
      status: 'OUT_OF_STOCK',
      availableQty: new Decimal(0),
      manufacturingQty: net,
      snapshotAgeSeconds: ageSeconds,
      isSnapshotStale: stale,
    };
  }

  // Stock appears to exist but nothing has been reserved yet. The quantity is
  // reported as potentially coverable; it is NOT netted off manufacturing
  // demand until an allocation is confirmed.
  const coverable = Decimal.min(snapshotAvailable, net);
  return {
    status: 'ALLOCATION_PENDING',
    availableQty: qty(coverable),
    manufacturingQty: net,
    snapshotAgeSeconds: ageSeconds,
    isSnapshotStale: stale,
  };
}
