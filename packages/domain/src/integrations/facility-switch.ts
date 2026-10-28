import { qty, type DecimalLike } from '../decimal';
import { shopifyVariantIdFromUniwareSku, type UniwareEnvelope } from './unicommerce';

/**
 * Moving one sale-order item to another Unicommerce facility.
 *
 * A switch is an external fulfilment operation, not an edit to a field: it
 * changes which building picks, packs and ships a customer's garment. So the
 * rules that decide whether it may happen, whether it happened, and what it
 * means for production all live here, framework-free and tested.
 *
 * Unicommerce documents the switch endpoint but no preconditions for it. The
 * eligibility rules below are therefore the conservative reading of this
 * tenant, measured 28 Oct 2026: items are created one per unit, a fresh item
 * has no shipping package, and statuses run CREATED -> FULFILLABLE ->
 * PROCESSING -> PACKED -> ... -> DISPATCHED. Widen them only after a verified
 * switch proves a wider state is accepted.
 */

// -----------------------------------------------------------------------------
// Operation lifecycle
// -----------------------------------------------------------------------------

export const FACILITY_SWITCH_STATUSES = [
  'CREATED', 'PREFLIGHT_CHECKING', 'READY', 'BLOCKED', 'EXECUTING', 'API_ACCEPTED',
  'VERIFYING', 'VERIFIED_SUCCESS', 'VERIFIED_FAILURE', 'VERIFICATION_PENDING',
  'RECONCILIATION_REQUIRED',
] as const;
export type FacilitySwitchStatus = (typeof FACILITY_SWITCH_STATUSES)[number];

const TRANSITIONS: Readonly<Record<FacilitySwitchStatus, readonly FacilitySwitchStatus[]>> = {
  CREATED: ['PREFLIGHT_CHECKING', 'BLOCKED'],
  PREFLIGHT_CHECKING: ['READY', 'BLOCKED'],
  READY: ['EXECUTING', 'BLOCKED'],
  // Once the request may have left, the only way forward is to look.
  EXECUTING: ['API_ACCEPTED', 'VERIFYING'],
  API_ACCEPTED: ['VERIFYING'],
  VERIFYING: ['VERIFIED_SUCCESS', 'VERIFIED_FAILURE', 'VERIFICATION_PENDING', 'RECONCILIATION_REQUIRED'],
  VERIFICATION_PENDING: ['VERIFYING'],
  RECONCILIATION_REQUIRED: ['VERIFIED_SUCCESS'],
  BLOCKED: [],
  VERIFIED_SUCCESS: [],
  VERIFIED_FAILURE: [],
};

export function canTransitionSwitch(from: FacilitySwitchStatus, to: FacilitySwitchStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** States with nothing left to do. */
export function isSwitchFinal(status: FacilitySwitchStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/**
 * Does an operation in this state still own its item?
 *
 * Every state before a verified outcome does, VERIFICATION_PENDING above all:
 * the external result is unknown, so a second switch could race the first.
 * RECONCILIATION_REQUIRED does not — the switch is verified, and what remains
 * is an internal production review.
 */
export function holdsSwitchLock(status: FacilitySwitchStatus): boolean {
  return !isSwitchFinal(status) && status !== 'RECONCILIATION_REQUIRED';
}

/** Could the request have reached Unicommerce from this state? */
export function mayHaveSubmitted(status: FacilitySwitchStatus): boolean {
  return ['EXECUTING', 'API_ACCEPTED', 'VERIFYING', 'VERIFICATION_PENDING'].includes(status);
}

// -----------------------------------------------------------------------------
// Eligibility
// -----------------------------------------------------------------------------

export const SWITCHABLE_ORDER_STATUSES = ['CREATED', 'PROCESSING'] as const;
export const SWITCHABLE_ITEM_STATUSES = ['CREATED', 'FULFILLABLE', 'UNFULFILLABLE'] as const;
/** A package still being formed has not been picked; anything later has. */
export const SWITCHABLE_PACKAGE_STATUSES = ['CREATED'] as const;
const SHIPPED_ITEM_STATUSES = [
  'DISPATCHED', 'DELIVERED', 'REPLACED', 'RETURN_REQUESTED', 'COURIER_RETURN', 'RETURNED',
];

export type SwitchCheckState = 'PASS' | 'FAIL' | 'UNKNOWN';

export const SWITCH_CHECK_CODES = [
  'ACCESS', 'ORDER_EXISTS', 'ORDER_STATUS', 'ITEM_EXISTS', 'SOURCE_MATCH', 'TARGET_DIFFERENT',
  'TARGET_ENABLED', 'SKU_MATCH', 'ITEM_STATUS', 'SHIPMENT_STATUS', 'NOT_DISPATCHED', 'QUANTITY',
  'STOCK', 'NO_CONFLICT', 'WRITES_ENABLED',
] as const;
export type SwitchCheckCode = (typeof SWITCH_CHECK_CODES)[number];

export interface SwitchCheck {
  readonly code: SwitchCheckCode;
  readonly label: string;
  readonly state: SwitchCheckState;
  readonly detail: string;
}

export interface SwitchItem {
  readonly code: string;
  readonly sku: string | null;
  readonly facilityCode: string | null;
  readonly statusCode: string | null;
  readonly shippingPackageCode: string | null;
  readonly shippingPackageStatus: string | null;
  readonly onHold: boolean;
}

export type LineMatch = 'LINE_ID' | 'VARIANT' | 'SKU';

export interface SwitchTarget {
  readonly code: string;
  /** One of the facilities the business configured. */
  readonly configured: boolean;
  /** facility/get answered for this account. */
  readonly visible: boolean;
  /** null when Unicommerce did not say. */
  readonly enabled: boolean | null;
}

export interface SwitchEligibilityInput {
  readonly hasPermission: boolean;
  readonly order: { readonly found: boolean; readonly status: string | null; readonly displayMatches: boolean };
  readonly item: SwitchItem | null;
  /** The facility the operator was shown; the switch is refused if it moved. */
  readonly expectedSourceFacility: string | null;
  readonly target: SwitchTarget | null;
  /** Unicommerce's documented "Available quantity" at the target, or null if unread. */
  readonly targetStock: { readonly availableQty: DecimalLike; readonly checkedAt: Date } | null;
  readonly lineMatch: LineMatch | null;
  /** Units still to fulfil on the matched ERP line (ordered - cancelled - fulfilled). */
  readonly erpOpenQty: DecimalLike | null;
  /** Units the item stands for. Unicommerce creates items one per unit. */
  readonly itemQty: DecimalLike;
  readonly conflictingOperation: { readonly id: string; readonly status: string } | null;
  readonly writes: { readonly env: boolean; readonly connection: boolean };
  readonly now: Date;
  /** Older readings are treated as unknown; default two minutes. */
  readonly maxStockAgeMs?: number;
}

export interface SwitchEligibility {
  readonly ready: boolean;
  readonly checks: readonly SwitchCheck[];
  /** The first failing or unknown check, for a one-line explanation. */
  readonly blocker: SwitchCheck | null;
}

const LABELS: Readonly<Record<SwitchCheckCode, string>> = {
  ACCESS: 'Permission to switch',
  ORDER_EXISTS: 'Order found in Unicommerce',
  ORDER_STATUS: 'Order eligible',
  ITEM_EXISTS: 'Item found on the order',
  SOURCE_MATCH: 'Current facility unchanged',
  TARGET_DIFFERENT: 'Different facility chosen',
  TARGET_ENABLED: 'Facility active and authorised',
  SKU_MATCH: 'SKU mapped to the order line',
  ITEM_STATUS: 'Item eligible',
  SHIPMENT_STATUS: 'Shipment not started',
  NOT_DISPATCHED: 'Not dispatched or fulfilled',
  QUANTITY: 'Quantity still to fulfil',
  STOCK: 'Stock sufficient',
  NO_CONFLICT: 'No conflicting operation',
  WRITES_ENABLED: 'Unicommerce writes enabled',
};

export function evaluateFacilitySwitch(input: SwitchEligibilityInput): SwitchEligibility {
  const checks: SwitchCheck[] = [];
  const add = (code: SwitchCheckCode, state: SwitchCheckState, detail: string) =>
    checks.push({ code, label: LABELS[code], state, detail });
  const { item, target } = input;
  const maxAge = input.maxStockAgeMs ?? 120_000;

  add('ACCESS', input.hasPermission ? 'PASS' : 'FAIL',
    input.hasPermission ? 'You hold the facility-switch permission.' : 'Switching a facility needs the "Switch an order item\'s facility" permission.');

  if (!input.order.found) add('ORDER_EXISTS', 'FAIL', 'Unicommerce has no sale order for this order.');
  else if (!input.order.displayMatches) add('ORDER_EXISTS', 'FAIL', 'The Unicommerce order found does not carry this order\'s number.');
  else add('ORDER_EXISTS', 'PASS', 'Matched by order number.');

  const orderStatus = input.order.status;
  if (!input.order.found || !orderStatus) add('ORDER_STATUS', 'UNKNOWN', 'Order status not known.');
  else if ((SWITCHABLE_ORDER_STATUSES as readonly string[]).includes(orderStatus)) add('ORDER_STATUS', 'PASS', `Order is ${orderStatus}.`);
  else add('ORDER_STATUS', 'FAIL', `Order is ${orderStatus}; only CREATED or PROCESSING orders can be switched.`);

  add('ITEM_EXISTS', item ? 'PASS' : 'FAIL', item ? `Item ${item.code}.` : 'That item is not on the Unicommerce order.');

  const source = item?.facilityCode ?? null;
  if (!item || !source) add('SOURCE_MATCH', 'UNKNOWN', 'Current facility not known.');
  else if (input.expectedSourceFacility && source !== input.expectedSourceFacility) {
    add('SOURCE_MATCH', 'FAIL', `The item moved to ${source} since you looked (it was ${input.expectedSourceFacility}). Refresh and review again.`);
  } else add('SOURCE_MATCH', 'PASS', `Currently at ${source}.`);

  if (!target) {
    add('TARGET_DIFFERENT', 'UNKNOWN', 'Choose a facility.');
    add('TARGET_ENABLED', 'UNKNOWN', 'Choose a facility.');
  } else {
    add('TARGET_DIFFERENT', source && target.code === source ? 'FAIL' : source ? 'PASS' : 'UNKNOWN',
      source && target.code === source ? `The item is already at ${source}.` : `Moving to ${target.code}.`);
    if (!target.configured) add('TARGET_ENABLED', 'FAIL', `${target.code} is not one of the configured facilities.`);
    else if (!target.visible) add('TARGET_ENABLED', 'FAIL', `This Unicommerce account cannot see ${target.code}, so its stock cannot be verified.`);
    else if (target.enabled === false) add('TARGET_ENABLED', 'FAIL', `${target.code} is disabled in Unicommerce.`);
    else if (target.enabled === null) add('TARGET_ENABLED', 'UNKNOWN', `Unicommerce did not report whether ${target.code} is enabled.`);
    else add('TARGET_ENABLED', 'PASS', `${target.code} is active.`);
  }

  if (!item) add('SKU_MATCH', 'UNKNOWN', 'No item selected.');
  else if (!item.sku) add('SKU_MATCH', 'FAIL', 'Unicommerce reports no SKU for this item.');
  else if (!input.lineMatch) add('SKU_MATCH', 'FAIL', `${item.sku} could not be matched to a line of this order.`);
  else add('SKU_MATCH', 'PASS', input.lineMatch === 'SKU'
    ? `${item.sku} matches the order line by SKU.`
    : `${item.sku} matches the order line by Shopify ${input.lineMatch === 'LINE_ID' ? 'line id' : 'variant id'}.`);

  const status = item?.statusCode ?? null;
  if (!item || !status) add('ITEM_STATUS', 'UNKNOWN', 'Item status not known.');
  else if (item.onHold) add('ITEM_STATUS', 'FAIL', 'The item is on hold in Unicommerce.');
  else if ((SWITCHABLE_ITEM_STATUSES as readonly string[]).includes(status)) add('ITEM_STATUS', 'PASS', `Item is ${status}.`);
  else add('ITEM_STATUS', 'FAIL', `Item is ${status}; only CREATED, FULFILLABLE or UNFULFILLABLE items can be switched.`);

  if (!item) add('SHIPMENT_STATUS', 'UNKNOWN', 'No item selected.');
  else if (!item.shippingPackageCode) add('SHIPMENT_STATUS', 'PASS', 'No shipping package yet.');
  else if (item.shippingPackageStatus && (SWITCHABLE_PACKAGE_STATUSES as readonly string[]).includes(item.shippingPackageStatus)) {
    add('SHIPMENT_STATUS', 'PASS', `Package ${item.shippingPackageCode} is still being formed.`);
  } else add('SHIPMENT_STATUS', 'FAIL', `Package ${item.shippingPackageCode} is ${item.shippingPackageStatus ?? 'in an unknown state'}; picking has started.`);

  const erpOpen = input.erpOpenQty === null ? null : qty(input.erpOpenQty);
  if (!item || !status) add('NOT_DISPATCHED', 'UNKNOWN', 'Item status not known.');
  else if (SHIPPED_ITEM_STATUSES.includes(status)) add('NOT_DISPATCHED', 'FAIL', `Already ${status}.`);
  else if (erpOpen !== null && erpOpen.lessThanOrEqualTo(0)) add('NOT_DISPATCHED', 'FAIL', 'Shopify shows nothing left to fulfil on this line.');
  else add('NOT_DISPATCHED', 'PASS', 'Not yet dispatched.');

  const unit = qty(input.itemQty);
  if (erpOpen === null) add('QUANTITY', 'UNKNOWN', 'The order line could not be read.');
  else if (erpOpen.lessThan(unit)) add('QUANTITY', 'FAIL', `${unit.toFixed()} unit to move, ${erpOpen.toFixed()} open on the line.`);
  else add('QUANTITY', 'PASS', `Moves ${unit.toFixed()} unit (Unicommerce items are one unit each); ${erpOpen.toFixed()} open on the line.`);

  if (!target) add('STOCK', 'UNKNOWN', 'Choose a facility.');
  else if (!input.targetStock) add('STOCK', 'UNKNOWN', `Stock at ${target.code} could not be read.`);
  else if (input.now.getTime() - input.targetStock.checkedAt.getTime() > maxAge) {
    add('STOCK', 'UNKNOWN', `The stock reading for ${target.code} is out of date. Refresh availability.`);
  } else {
    const available = qty(input.targetStock.availableQty);
    add('STOCK', available.greaterThanOrEqualTo(unit) ? 'PASS' : 'FAIL',
      available.greaterThanOrEqualTo(unit)
        ? `${available.toFixed()} available at ${target.code}.`
        : `Only ${available.toFixed()} available at ${target.code}.`);
  }

  add('NO_CONFLICT', input.conflictingOperation ? 'FAIL' : 'PASS', input.conflictingOperation
    ? `Another switch for this item is ${input.conflictingOperation.status.toLowerCase().replace(/_/g, ' ')} (operation ${input.conflictingOperation.id.slice(0, 8)}).`
    : 'No other switch is running for this item.');

  if (!input.writes.env) {
    add('WRITES_ENABLED', 'FAIL', 'Writes to Unicommerce are switched off for this ERP (UC_WRITE_ENABLED). An administrator has to enable them deliberately.');
  } else if (!input.writes.connection) {
    add('WRITES_ENABLED', 'FAIL', 'The Unicommerce connection is read-only. An administrator has to allow writes on it.');
  } else add('WRITES_ENABLED', 'PASS', 'Writes are enabled.');

  const blocker = checks.find((c) => c.state !== 'PASS') ?? null;
  return { ready: blocker === null, checks, blocker };
}

/**
 * Which ERP order line does a Unicommerce item belong to?
 *
 * Measured on this tenant: the item code IS the Shopify line-item id, and the
 * SKU ends in the Shopify variant id. The line id is the strongest evidence,
 * the variant id next, plain SKU text last. This only proves the pairing — the
 * code sent to Unicommerce is always the one Unicommerce returned.
 */
export function matchUniwareItemToLine(
  item: { readonly code: string; readonly sku: string | null },
  line: { readonly lineLegacyId: string | null; readonly variantLegacyId: string | null; readonly sku: string | null },
): LineMatch | null {
  if (line.lineLegacyId && (item.code === line.lineLegacyId || item.code.startsWith(`${line.lineLegacyId}-`))) {
    return 'LINE_ID';
  }
  const variant = shopifyVariantIdFromUniwareSku(item.sku);
  if (variant && line.variantLegacyId && variant === line.variantLegacyId) return 'VARIANT';
  if (item.sku && line.sku && item.sku.trim().toUpperCase() === line.sku.trim().toUpperCase()) return 'SKU';
  return null;
}

// -----------------------------------------------------------------------------
// The response, and what actually happened
// -----------------------------------------------------------------------------

export interface SwitchResponseReading {
  /** true / false as Unicommerce said; null when the body did not say. */
  readonly successful: boolean | null;
  readonly message: string | null;
  readonly errors: readonly { code: string | null; message: string | null; description: string | null; fieldName: string | null }[];
  readonly warnings: readonly { code: string | null; message: string | null; description: string | null }[];
}

const clip = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, 500) : null;
};

/**
 * Read a switch response without trusting HTTP. `successful: true` is a claim
 * to verify, not a result; anything else is not success.
 */
export function readSwitchResponse(body: UniwareEnvelope | null | undefined): SwitchResponseReading {
  const errors = Array.isArray(body?.errors) ? body!.errors : [];
  const warnings = Array.isArray(body?.warnings) ? (body!.warnings as unknown[]) : [];
  return {
    successful: typeof body?.successful === 'boolean' ? body.successful : null,
    message: clip(body?.message),
    errors: errors.map((e) => ({
      code: clip(e.code), message: clip(e.message), description: clip(e.description), fieldName: clip(e.fieldName),
    })),
    warnings: warnings.map((w) => {
      const o = (w && typeof w === 'object' ? w : {}) as Record<string, unknown>;
      return { code: clip(o.code), message: clip(o.message), description: clip(o.description) };
    }),
  };
}

export type SwitchApiOutcome = 'ACCEPTED' | 'REJECTED' | 'NO_RESPONSE';

export interface SwitchVerdict {
  readonly outcome: 'SUCCESS' | 'FAILURE' | 'PENDING';
  readonly code: string;
  readonly reason: string;
}

/**
 * Decide what happened from what Unicommerce now shows.
 *
 * The item's facility after the call is the evidence; the API's answer is
 * only a hint. The one case that may conclude FAILURE without an operator is
 * an explicit rejection with the item still where it was. Silence, or an
 * acceptance that did not take, stays PENDING until a person confirms — a
 * timeout does not prove the switch failed, and resending might move it twice.
 */
export function judgeSwitchVerification(input: {
  readonly api: SwitchApiOutcome;
  readonly itemFound: boolean;
  readonly liveFacility: string | null;
  readonly source: string;
  readonly target: string;
  readonly operatorConfirmedNotApplied?: boolean;
}): SwitchVerdict {
  if (!input.itemFound || !input.liveFacility) {
    return { outcome: 'PENDING', code: 'ITEM_NOT_READABLE', reason: 'The item could not be read back from Unicommerce.' };
  }
  if (input.liveFacility === input.target) {
    return input.api === 'REJECTED'
      ? { outcome: 'SUCCESS', code: 'APPLIED_DESPITE_ERROR', reason: `Unicommerce reported an error, but the item is now at ${input.target}.` }
      : { outcome: 'SUCCESS', code: 'APPLIED', reason: `The item is now at ${input.target}.` };
  }
  if (input.liveFacility === input.source) {
    if (input.api === 'REJECTED') {
      return { outcome: 'FAILURE', code: 'REJECTED', reason: `Unicommerce refused the switch; the item is still at ${input.source}.` };
    }
    if (input.operatorConfirmedNotApplied) {
      return { outcome: 'FAILURE', code: 'NOT_APPLIED', reason: `Confirmed not applied; the item is still at ${input.source}.` };
    }
    return {
      outcome: 'PENDING',
      code: input.api === 'ACCEPTED' ? 'ACCEPTED_NOT_APPLIED' : 'NO_RESPONSE',
      reason: input.api === 'ACCEPTED'
        ? `Unicommerce accepted the switch, but the item still shows ${input.source}.`
        : `No answer from Unicommerce, and the item still shows ${input.source}.`,
    };
  }
  return { outcome: 'PENDING', code: 'UNEXPECTED_FACILITY', reason: `The item is now at ${input.liveFacility}, which is neither the source nor the target.` };
}

// -----------------------------------------------------------------------------
// Production
// -----------------------------------------------------------------------------

export interface ProductionLinkFacts {
  readonly demand: { readonly demandNo: string; readonly status: string } | null;
  readonly orders: readonly {
    readonly moNo: string;
    readonly status: string;
    readonly materialIssued: boolean;
    readonly scanned: boolean;
    readonly completedQty: DecimalLike;
    readonly finishedGoodsInwarded: boolean;
    readonly stage: string | null;
  }[];
}

/**
 * Does a verified switch leave production to review?
 *
 * A switch usually means the garment exists elsewhere, so demand raised for
 * it may now make a duplicate. Nothing here changes production — cancelling a
 * cut garment or reversing an issue is a human decision — it only says what
 * a person has to look at, in plain terms.
 */
export function assessSwitchReconciliation(facts: ProductionLinkFacts): { required: boolean; reasons: string[] } {
  if (!facts.demand || ['CANCELLED', 'NOT_REQUIRED'].includes(facts.demand.status)) {
    return { required: false, reasons: [] };
  }
  const reasons = [`Demand ${facts.demand.demandNo} is ${facts.demand.status.toLowerCase().replace(/_/g, ' ')} for this line.`];
  for (const mo of facts.orders.filter((o) => o.status !== 'CANCELLED')) {
    const facts2 = [
      mo.stage ? `at ${mo.stage}` : mo.status.toLowerCase().replace(/_/g, ' '),
      mo.materialIssued ? 'materials issued' : null,
      mo.scanned ? 'barcode scans recorded' : null,
      qty(mo.completedQty).greaterThan(0) ? `${qty(mo.completedQty).toFixed()} completed` : null,
      mo.finishedGoodsInwarded ? 'finished goods inwarded' : null,
    ].filter(Boolean);
    reasons.push(`${mo.moNo}: ${facts2.join(', ')}.`);
  }
  return { required: true, reasons };
}
