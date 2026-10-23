import { Decimal, qty, type DecimalLike } from '../decimal';
import { ValidationError } from '../errors';

/**
 * Unicommerce (Uniware) protocol rules.
 *
 * Every rule here was measured against the live tenant on 23 Oct 2026 rather
 * than inferred from documentation — see docs/unicommerce-integration.md §8d
 * and decisions.md §29-§31. The API has several behaviours that are easy to get
 * wrong in ways no type checker catches and no happy-path test exercises, so
 * they live here, framework-free and tested.
 */

// -----------------------------------------------------------------------------
// The response envelope
// -----------------------------------------------------------------------------

export interface UniwareError {
  readonly code?: number | null;
  readonly fieldName?: string | null;
  readonly description?: string | null;
  readonly message?: string | null;
}

export interface UniwareEnvelope {
  readonly successful?: boolean | null;
  readonly message?: string | null;
  readonly errors?: readonly UniwareError[] | null;
  readonly warnings?: readonly unknown[] | null;
}

export interface UniwareFailure {
  /** The stable symbolic code, e.g. `INVENTORY_NOT_AVAILABLE`. */
  readonly code: string;
  readonly description: string;
  readonly fieldNames: readonly string[];
  readonly all: readonly string[];
}

/**
 * Decide whether a Uniware response actually succeeded.
 *
 * Uniware reports business failures with **HTTP 200** and `successful: false`.
 * Measured examples, all 200:
 *
 *   INVENTORY_NOT_AVAILABLE, INVALID_ITEM_TYPE, MISSING_REQUIRED_PARAMETERS,
 *   SALE_ORDER_SEARCH_DATE_RANGE_LIMIT_EXCEEDED
 *
 * A client that trusts `res.ok` reads every one of those as success. On a read
 * that produces a wrong number; on an inventory push it would record a credit
 * that never happened.
 */
export function readUniwareFailure(body: UniwareEnvelope | null | undefined): UniwareFailure | null {
  if (!body) {
    return { code: 'EMPTY_RESPONSE', description: 'Unicommerce returned no body', fieldNames: [], all: [] };
  }
  if (body.successful === true) return null;

  const errors = body.errors ?? [];
  const all = errors.map((e) => e.message ?? e.description ?? 'UNKNOWN').filter(Boolean);
  const first = errors[0];

  return {
    code: first?.message ?? (body.successful === false ? 'UNSUCCESSFUL' : 'MALFORMED_RESPONSE'),
    description: first?.description ?? body.message ?? 'Unicommerce reported no detail',
    fieldNames: errors.map((e) => e.fieldName).filter((f): f is string => typeof f === 'string' && f.length > 0),
    all,
  };
}

// -----------------------------------------------------------------------------
// Facility identity
// -----------------------------------------------------------------------------

export const FACILITY_KINDS = ['WAREHOUSE', 'STORE', 'UNKNOWN'] as const;
export type FacilityKind = (typeof FACILITY_KINDS)[number];

/**
 * Which kind of place is this?
 *
 * **Read `operationalType`, never `type`, and never the code prefix.** Measured:
 * every facility in this tenant reports `type: WAREHOUSE`, retail shops
 * included, so `type` cannot distinguish Kala Ghoda Fort from the Noida
 * production warehouse. `WH_Second_Floor` is the proof — a `WH_` prefix,
 * `type: WAREHOUSE`, and an `operationalType` of STORE — and it holds real
 * stock, so getting it wrong misroutes actual inventory.
 */
export function facilityKind(input: {
  readonly type?: string | null;
  readonly operationalType?: string | null;
}): FacilityKind {
  const op = input.operationalType?.trim().toUpperCase();
  if (op === 'STORE') return 'STORE';
  if (op === 'WAREHOUSE') return 'WAREHOUSE';
  return 'UNKNOWN';
}

export const FACILITY_PROBE_RESULTS = ['VALID', 'ACCESS_DENIED', 'INVALID_CODE', 'ERROR'] as const;
export type FacilityProbeResult = (typeof FACILITY_PROBE_RESULTS)[number];

/**
 * Interpret a `facility/get` response.
 *
 * This is the only call that separates the two questions every other endpoint
 * conflates. `inventorySnapshot/get` returns the same 403 for a real facility
 * this account cannot see as for a code that does not exist, so a facility
 * master built from inventory errors would quietly delete five real facilities.
 */
export function classifyFacilityProbe(body: UniwareEnvelope | null | undefined): FacilityProbeResult {
  const failure = readUniwareFailure(body);
  if (!failure) return 'VALID';
  if (failure.code === 'FACILITY_ACCESS_DENIED') return 'ACCESS_DENIED';
  if (failure.code === 'INVALID_FACILITY_CODE') return 'INVALID_CODE';
  return 'ERROR';
}

// -----------------------------------------------------------------------------
// Inventory
// -----------------------------------------------------------------------------

/**
 * The sixteen numbers `inventorySnapshot/get` returns.
 *
 * Named in full because reading `inventory` alone is the mistake this interface
 * exists to make hard: the probed SKU showed `inventory: 0` while six units sat
 * in the building as `inventoryBlocked: 1` and `pendingInventoryAssessment: 5`.
 */
export interface UniwareInventorySnapshot {
  readonly itemTypeSKU: string;
  readonly inventory: number;
  readonly openSale?: number;
  readonly openPurchase?: number;
  readonly putawayPending?: number;
  readonly inventoryBlocked?: number;
  readonly pendingStockTransfer?: number;
  readonly vendorInventory?: number;
  readonly virtualInventory?: number;
  readonly pendingInventoryAssessment?: number;
  readonly badInventory?: number;
  readonly inventoryNotSynced?: number;
  readonly batchRecallQuantity?: number;
  readonly quantityNotFound?: number;
  readonly excessQuantity?: number;
  readonly quarantinedInventory?: number;
  readonly ageingStockInventory?: number;
}

export interface InventoryReading {
  readonly sku: string;
  readonly facilityCode: string;
  /** Good stock Uniware considers sellable right now. */
  readonly sellableQty: Decimal;
  /** Already committed to orders. Not available, but not absent either. */
  readonly committedQty: Decimal;
  /**
   * Physically present and NOT sellable — blocked, quarantined, bad, awaiting
   * assessment or putaway. Surfaced rather than discarded, because "zero" and
   * "six units nobody has counted yet" are different operational problems.
   */
  readonly heldQty: Decimal;
  /** sellable - committed, floored at zero. What may honestly be promised. */
  readonly availableQty: Decimal;
}

/**
 * Turn a snapshot into the three numbers the ERP actually reasons about.
 *
 * Which buckets count as available is a business decision, not a technical one
 * (§5). This takes the conservative reading: only `inventory` is sellable, and
 * everything ambiguous is reported as held rather than quietly counted. Being
 * wrong in this direction causes an unnecessary manufacturing order; being
 * wrong the other way promises a customer a garment that is sitting in
 * quarantine.
 */
export function readInventorySnapshot(
  snapshot: UniwareInventorySnapshot,
  facilityCode: string,
): InventoryReading {
  const n = (v: number | undefined): Decimal => qty(v ?? 0);

  const sellable = n(snapshot.inventory);
  const committed = n(snapshot.openSale);
  const held = n(snapshot.inventoryBlocked)
    .plus(n(snapshot.quarantinedInventory))
    .plus(n(snapshot.badInventory))
    .plus(n(snapshot.pendingInventoryAssessment))
    .plus(n(snapshot.putawayPending))
    .plus(n(snapshot.batchRecallQuantity));

  const available = sellable.minus(committed);

  return {
    sku: snapshot.itemTypeSKU,
    facilityCode,
    sellableQty: sellable,
    committedQty: committed,
    heldQty: held,
    availableQty: available.lessThan(0) ? new Decimal(0) : available,
  };
}

export interface FacilityAvailability {
  readonly facilityCode: string;
  readonly availableQty: Decimal;
}

export interface AvailabilitySearch {
  /** Facilities that answered, best first. */
  readonly found: readonly FacilityAvailability[];
  /**
   * Facilities that could not be checked — denied, or errored.
   *
   * Never empty-by-omission: a partial search presented as a complete one is
   * how "not available anywhere" becomes a wrong answer.
   */
  readonly unchecked: readonly string[];
  readonly totalAvailable: Decimal;
  /** True when every facility answered, so "nowhere else" can be trusted. */
  readonly isComplete: boolean;
}

/**
 * Where else is this piece?
 *
 * The service account cannot see five of seventeen facilities, so this result
 * is structurally partial and says so. `isComplete` is what callers must check
 * before telling anyone a garment is unavailable — see decisions.md §31.
 */
export function summariseAvailability(
  readings: readonly InventoryReading[],
  unchecked: readonly string[],
): AvailabilitySearch {
  const found = readings
    .filter((r) => r.availableQty.greaterThan(0))
    .slice()
    .sort((a, b) => b.availableQty.comparedTo(a.availableQty) || a.facilityCode.localeCompare(b.facilityCode))
    .map((r) => ({ facilityCode: r.facilityCode, availableQty: r.availableQty }));

  return {
    found,
    unchecked: [...unchecked].sort(),
    totalAvailable: found.reduce((sum, f) => sum.plus(f.availableQty), new Decimal(0)),
    isComplete: unchecked.length === 0,
  };
}

// -----------------------------------------------------------------------------
// Search windows
// -----------------------------------------------------------------------------

/** Measured cap on `oms/saleOrder/search`: `SALE_ORDER_SEARCH_DATE_RANGE_LIMIT_EXCEEDED`. */
export const SALE_ORDER_MAX_WINDOW_DAYS = 31;

export interface DateWindow {
  readonly from: Date;
  readonly to: Date;
}

/**
 * Split a range into windows the API will accept.
 *
 * Uniware rejects anything over 31 days outright, so a year-long pull is 12
 * calls rather than one failure. Windows are built a day short of the cap:
 * the API's boundary is inclusive in a way that is not documented, and losing
 * one day of head-room is cheaper than discovering the off-by-one in
 * production.
 */
export function splitSaleOrderWindows(
  from: Date,
  to: Date,
  maxDays: number = SALE_ORDER_MAX_WINDOW_DAYS - 1,
): DateWindow[] {
  if (!(from instanceof Date) || Number.isNaN(from.getTime())) {
    throw new ValidationError('INVALID_FROM_DATE', 'from must be a valid Date');
  }
  if (!(to instanceof Date) || Number.isNaN(to.getTime())) {
    throw new ValidationError('INVALID_TO_DATE', 'to must be a valid Date');
  }
  if (to.getTime() < from.getTime()) {
    throw new ValidationError('INVERTED_DATE_RANGE', 'to must not precede from', {
      from: from.toISOString(),
      to: to.toISOString(),
    });
  }
  if (maxDays < 1) {
    throw new ValidationError('INVALID_WINDOW_SIZE', 'maxDays must be at least 1');
  }

  const span = maxDays * 24 * 60 * 60 * 1000;
  const windows: DateWindow[] = [];
  let cursor = from.getTime();

  while (cursor <= to.getTime()) {
    const end = Math.min(cursor + span, to.getTime());
    windows.push({ from: new Date(cursor), to: new Date(end) });
    if (end >= to.getTime()) break;
    cursor = end + 1;
  }

  return windows;
}

// -----------------------------------------------------------------------------
// SKU identity
// -----------------------------------------------------------------------------

/**
 * Pull the Shopify variant id out of a Uniware SKU.
 *
 * This tenant encodes it as a trailing numeric segment — `W/2769-L-49295244427434`
 * carries variant `49295244427434`. That is a far stronger join than matching
 * SKU text, which differs between the two systems.
 *
 * Returns null rather than guessing: a SKU without the suffix is a mapping to
 * be resolved by a human, not a number to be invented.
 */
export function shopifyVariantIdFromUniwareSku(sku: string | null | undefined): string | null {
  if (!sku) return null;
  // At least 10 digits: Shopify variant ids are long, and a short trailing
  // number is far more likely to be a size or a colourway than an id.
  const match = /(?:^|[-_/])(\d{10,})$/.exec(sku.trim());
  return match?.[1] ?? null;
}

// -----------------------------------------------------------------------------
// Token lifetime
// -----------------------------------------------------------------------------

/**
 * Should the cached token be replaced before this call?
 *
 * Refreshes early by `safetyWindowMs`. A token that expires mid-flight fails a
 * request that may already have changed inventory, and "did that land?" is the
 * most expensive question this integration can ask.
 */
export function isTokenExpiring(
  expiresAt: Date | null | undefined,
  now: Date,
  safetyWindowMs = 120_000,
): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() - now.getTime() <= safetyWindowMs;
}

/** When a token obtained now will expire, given Uniware's `expires_in` seconds. */
export function tokenExpiryFrom(expiresInSeconds: DecimalLike, now: Date): Date {
  const seconds = qty(expiresInSeconds);
  if (seconds.lessThanOrEqualTo(0)) {
    throw new ValidationError('INVALID_TOKEN_LIFETIME', 'expires_in must be positive', {
      expiresIn: seconds.toFixed(),
    });
  }
  return new Date(now.getTime() + seconds.toNumber() * 1000);
}
