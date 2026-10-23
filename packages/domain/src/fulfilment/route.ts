import { Decimal, clampNonNegative, qty, type DecimalLike } from '../decimal';

/**
 * Deciding how one line of demand gets fulfilled.
 *
 * Every order line ends up in exactly one of four places, and the choice is
 * worth money: dispatching a garment that already exists costs a courier,
 * manufacturing the same garment costs fabric, labour and three weeks.
 *
 *   DISPATCH         stock is here, send it
 *   SWITCH_FACILITY  stock exists, somewhere else
 *   MANUFACTURE      nowhere has it, make it
 *   NEEDS_CHECK      we do not know, and guessing is expensive
 */

export const FULFILMENT_ROUTES = [
  'DISPATCH', 'SWITCH_FACILITY', 'MANUFACTURE', 'NEEDS_CHECK',
] as const;
export type FulfilmentRoute = (typeof FULFILMENT_ROUTES)[number];

export interface FacilityStock {
  readonly facilityCode: string;
  readonly availableQty: DecimalLike;
}

export interface RouteInput {
  readonly demandQty: DecimalLike;
  /** Stock at the facility this order is meant to ship from. */
  readonly homeFacilityCode: string;
  readonly homeAvailableQty: DecimalLike;
  /** Everywhere else that was successfully checked. */
  readonly otherFacilities?: readonly FacilityStock[];
  /**
   * Whether every configured facility actually answered. False when some
   * could not be read.
   */
  readonly isSearchComplete: boolean;
  /**
   * Set when a person looked at a dispatchable line and sent it to production
   * anyway: damaged stock, a customisation, a shade that will not match.
   * A human decision outranks the arithmetic.
   */
  readonly isRejectedForDispatch?: boolean;
}

export interface RouteDecision {
  readonly route: FulfilmentRoute;
  readonly dispatchQty: Decimal;
  readonly switchQty: Decimal;
  readonly manufactureQty: Decimal;
  readonly switchFromFacility: string | null;
  readonly reason: string;
  /**
   * True when the decision rests on a partial view of stock. A caller must not
   * raise a manufacturing order off one of these without a human looking.
   */
  readonly isProvisional: boolean;
}

/**
 * Route one line.
 *
 * The order of the rules is the whole design:
 *
 *  1. A human rejection wins outright. Someone holding the garment knows
 *     something the stock figure does not.
 *  2. Stock here beats stock elsewhere — no movement, no delay.
 *  3. Stock elsewhere beats manufacturing — moving a finished garment is
 *     days and rupees; making one is weeks and far more.
 *  4. **Manufacture only when the search was COMPLETE.** If some facility
 *     could not be read, "nothing found" is not the same as "nothing exists",
 *     and cutting fabric for a garment already folded on a shelf in Chandigarh
 *     is the most expensive mistake this screen can cause.
 */
export function routeDemandLine(input: RouteInput): RouteDecision {
  const demand = qty(input.demandQty);
  const home = clampNonNegative(qty(input.homeAvailableQty));
  const others = (input.otherFacilities ?? [])
    .map((f) => ({ facilityCode: f.facilityCode, availableQty: clampNonNegative(qty(f.availableQty)) }))
    .filter((f) => f.availableQty.greaterThan(0))
    .sort((a, b) => b.availableQty.comparedTo(a.availableQty) || a.facilityCode.localeCompare(b.facilityCode));

  const zero = new Decimal(0);

  if (demand.lessThanOrEqualTo(0)) {
    return {
      route: 'DISPATCH', dispatchQty: zero, switchQty: zero, manufactureQty: zero,
      switchFromFacility: null, isProvisional: false,
      reason: 'Nothing is owed on this line.',
    };
  }

  if (input.isRejectedForDispatch) {
    return {
      route: 'MANUFACTURE',
      dispatchQty: zero, switchQty: zero, manufactureQty: demand,
      switchFromFacility: null, isProvisional: false,
      reason: 'Sent to production by an operator, so available stock is not used.',
    };
  }

  const dispatchQty = Decimal.min(home, demand);
  const afterDispatch = clampNonNegative(demand.minus(dispatchQty));

  if (afterDispatch.isZero()) {
    return {
      route: 'DISPATCH', dispatchQty, switchQty: zero, manufactureQty: zero,
      switchFromFacility: null, isProvisional: false,
      reason: `${dispatchQty.toFixed()} available at ${input.homeFacilityCode}.`,
    };
  }

  const elsewhere = others.reduce<Decimal>((s, f) => s.plus(f.availableQty), zero);
  const switchQty = Decimal.min(elsewhere, afterDispatch);
  const remaining = clampNonNegative(afterDispatch.minus(switchQty));
  const bestSource = others[0]?.facilityCode ?? null;

  if (switchQty.greaterThan(0) && remaining.isZero()) {
    return {
      route: 'SWITCH_FACILITY',
      dispatchQty, switchQty, manufactureQty: zero,
      switchFromFacility: bestSource,
      isProvisional: false,
      reason: dispatchQty.greaterThan(0)
        ? `${dispatchQty.toFixed()} here, ${switchQty.toFixed()} from ${bestSource}.`
        : `Not here, but ${switchQty.toFixed()} available at ${bestSource}.`,
    };
  }

  if (!input.isSearchComplete) {
    return {
      route: 'NEEDS_CHECK',
      dispatchQty, switchQty, manufactureQty: zero,
      switchFromFacility: bestSource,
      isProvisional: true,
      reason:
        'Some facilities could not be checked, so this may already exist. '
        + 'Confirm before raising a manufacturing order.',
    };
  }

  return {
    route: 'MANUFACTURE',
    dispatchQty, switchQty, manufactureQty: remaining,
    switchFromFacility: bestSource,
    isProvisional: false,
    reason: switchQty.greaterThan(0) || dispatchQty.greaterThan(0)
      ? `${remaining.toFixed()} short after using all available stock.`
      : 'No stock at any facility that could be checked.',
  };
}

export interface RouteTally {
  readonly dispatch: number;
  readonly switchFacility: number;
  readonly manufacture: number;
  readonly needsCheck: number;
}

/** How many lines landed in each tab. */
export function tallyRoutes(decisions: readonly RouteDecision[]): RouteTally {
  return {
    dispatch: decisions.filter((d) => d.route === 'DISPATCH').length,
    switchFacility: decisions.filter((d) => d.route === 'SWITCH_FACILITY').length,
    manufacture: decisions.filter((d) => d.route === 'MANUFACTURE').length,
    needsCheck: decisions.filter((d) => d.route === 'NEEDS_CHECK').length,
  };
}
