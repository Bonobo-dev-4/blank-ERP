import { Decimal, clampNonNegative, qty, type DecimalLike } from '../decimal';
import { ValidationError } from '../errors';

/**
 * Classifying and measuring a Shopify order.
 *
 * Framework-free on purpose: these are the two decisions that decide what gets
 * manufactured, and both are easy to get subtly wrong in a way no type checker
 * catches. They are verified against the Admin GraphQL schema — see
 * docs/shopify-integration.md §9a.
 */

export const DEMAND_CHANNELS = [
  'ONLINE', 'POS', 'CUSTOM', 'BULK_PO', 'REPLENISHMENT', 'MANUAL',
] as const;
export type DemandChannel = (typeof DEMAND_CHANNELS)[number];

export interface ShopifyOrderChannelInput {
  /**
   * `Order.retailLocation` — the physical store a retail order was created at.
   * The primary POS test, and better than a boolean because it names WHICH
   * store, which is what makes "is it available somewhere else?" answerable.
   */
  readonly retailLocationId?: string | null;
  readonly retailLocationName?: string | null;
  /** `Order.sourceName` — free text: `web`, `pos`, `mobile_app`, … */
  readonly sourceName?: string | null;
  /** Shopify tags, used by the business to mark bespoke work. */
  readonly tags?: readonly string[];
}

export interface ChannelClassification {
  readonly channel: DemandChannel;
  readonly posLocationId: string | null;
  readonly posLocationName: string | null;
  /** How the decision was reached, so a wrong one can be traced. */
  readonly basis: 'RETAIL_LOCATION' | 'SOURCE_NAME' | 'TAG' | 'DEFAULT';
  /**
   * True when the classification rests on free-text `sourceName` rather than a
   * structured field. Worth surfacing: it is the case most likely to be wrong.
   */
  readonly isHeuristic: boolean;
}

/** Source names Shopify itself documents as point-of-sale. */
const POS_SOURCE_NAMES = new Set(['pos', 'shopify_pos', 'point_of_sale']);

/** Tags that mark an order as bespoke rather than stock production. */
const CUSTOM_TAGS = new Set(['custom', 'bespoke', 'made-to-measure', 'mto', 'customised', 'customized']);

/**
 * Decide which channel an order came from.
 *
 * Order of precedence, and why:
 *
 *  1. `retailLocation` — structured, and names the store. Shopify documents one
 *     exception: a draft POS order completed with "mark as paid" returns null.
 *  2. `sourceName` — free text, so a heuristic. Flagged as such.
 *  3. Tags — the business's own marking for bespoke work.
 *  4. ONLINE — the default, because a web order is the common case and
 *     misclassifying one as POS would attribute it to a shop that never saw it.
 */
export function classifyShopifyOrder(input: ShopifyOrderChannelInput): ChannelClassification {
  const tags = (input.tags ?? []).map((t) => t.trim().toLowerCase());

  // A bespoke order is bespoke wherever it was taken, so the tag wins over the
  // channel: it changes what production has to do, not just where it came from.
  if (tags.some((t) => CUSTOM_TAGS.has(t))) {
    return {
      channel: 'CUSTOM',
      posLocationId: input.retailLocationId ?? null,
      posLocationName: input.retailLocationName ?? null,
      basis: 'TAG',
      isHeuristic: false,
    };
  }

  if (input.retailLocationId) {
    return {
      channel: 'POS',
      posLocationId: input.retailLocationId,
      posLocationName: input.retailLocationName ?? null,
      basis: 'RETAIL_LOCATION',
      isHeuristic: false,
    };
  }

  const source = input.sourceName?.trim().toLowerCase() ?? '';
  if (source && POS_SOURCE_NAMES.has(source)) {
    // The documented "mark as paid" draft-POS case lands here. There is no
    // location to attribute it to, which is itself worth recording.
    return {
      channel: 'POS',
      posLocationId: null,
      posLocationName: null,
      basis: 'SOURCE_NAME',
      isHeuristic: true,
    };
  }

  return {
    channel: 'ONLINE',
    posLocationId: null,
    posLocationName: null,
    basis: source ? 'SOURCE_NAME' : 'DEFAULT',
    isHeuristic: false,
  };
}

// -----------------------------------------------------------------------------
// Quantities
// -----------------------------------------------------------------------------

export interface ShopifyLineQuantityInput {
  /** `LineItem.quantity` — units ORIGINALLY ordered. */
  readonly quantity: DecimalLike;
  /** `LineItem.currentQuantity` — ordered MINUS refunded and removed. */
  readonly currentQuantity: DecimalLike;
  /** `LineItem.unfulfilledQuantity`. */
  readonly unfulfilledQuantity?: DecimalLike;
  /** True when the whole order is cancelled. */
  readonly orderCancelled?: boolean;
}

export interface ShopifyLineQuantities {
  readonly orderedQty: Decimal;
  /** Refunded or removed: ordered minus current. */
  readonly cancelledQty: Decimal;
  readonly fulfilledQty: Decimal;
  /**
   * What production should actually be asked to make.
   *
   * Zero for a cancelled order, and never more than what is still owed to the
   * customer. Availability is applied separately — this is demand before any
   * stock is considered.
   */
  readonly demandQty: Decimal;
}

/**
 * Derive the quantities that matter from a Shopify line.
 *
 * The important one is `demandQty`. Driving it from `quantity` rather than
 * `currentQuantity` would keep manufacturing garments for lines the customer
 * has already refunded — stock nobody asked for, produced from a figure that
 * looked right.
 */
export function shopifyLineQuantities(input: ShopifyLineQuantityInput): ShopifyLineQuantities {
  const ordered = qty(input.quantity);
  const current = qty(input.currentQuantity);

  if (ordered.lessThan(0) || current.lessThan(0)) {
    throw new ValidationError('NEGATIVE_SHOPIFY_QUANTITY', 'Shopify line quantities cannot be negative', {
      quantity: ordered.toFixed(),
      currentQuantity: current.toFixed(),
    });
  }
  if (current.greaterThan(ordered)) {
    // Shopify does not do this; if it ever did, silently trusting it would
    // manufacture more than was ever ordered.
    throw new ValidationError(
      'CURRENT_EXCEEDS_ORDERED',
      'Current quantity exceeds the quantity originally ordered',
      { quantity: ordered.toFixed(), currentQuantity: current.toFixed() },
    );
  }

  const cancelled = clampNonNegative(ordered.minus(current));
  const unfulfilled = input.unfulfilledQuantity != null ? qty(input.unfulfilledQuantity) : current;
  const fulfilled = clampNonNegative(current.minus(unfulfilled));

  return {
    orderedQty: ordered,
    cancelledQty: cancelled,
    fulfilledQty: fulfilled,
    // A cancelled order demands nothing, whatever its lines still say.
    demandQty: input.orderCancelled ? new Decimal(0) : clampNonNegative(current.minus(fulfilled)),
  };
}

/**
 * Should this order version be processed at all?
 *
 * Shopify sends updates out of order often enough to matter, and an older
 * version overwriting a newer one silently resurrects cancelled lines.
 */
export function isStaleOrderVersion(
  incomingUpdatedAt: Date | null | undefined,
  storedUpdatedAt: Date | null | undefined,
): boolean {
  if (!incomingUpdatedAt || !storedUpdatedAt) return false;
  return incomingUpdatedAt.getTime() < storedUpdatedAt.getTime();
}

// -----------------------------------------------------------------------------
// Rate limiting
// -----------------------------------------------------------------------------

export interface ShopifyThrottleState {
  readonly maximumAvailable: number;
  readonly currentlyAvailable: number;
  readonly restoreRate: number;
}

/**
 * How long to wait before spending `nextCost` points.
 *
 * Shopify's limit is a leaky bucket of query COST, not a request count, so
 * pacing by requests per second is wrong in both directions: too slow for
 * cheap queries and still too expensive for one large page.
 *
 * Returns milliseconds, with a small margin so a burst does not land exactly
 * on empty.
 */
export function throttleDelayMs(
  state: ShopifyThrottleState | null | undefined,
  nextCost: number,
  options: { readonly safetyMargin?: number } = {},
): number {
  if (!state || state.restoreRate <= 0) return 0;

  const margin = options.safetyMargin ?? 0.1;
  const needed = nextCost * (1 + margin);
  if (state.currentlyAvailable >= needed) return 0;

  const deficit = needed - state.currentlyAvailable;
  return Math.ceil((deficit / state.restoreRate) * 1000);
}
