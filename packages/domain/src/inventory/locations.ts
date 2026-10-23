/**
 * Location semantics for the double-entry material ledger.
 *
 * Every movement debits a source location and credits a destination location by
 * the same base quantity. Because the virtual counter-accounts below are also
 * locations, the signed sum of all balances for any material is always exactly
 * zero - which makes "is the ledger intact?" a single checkable query rather
 * than an article of faith.
 */

export const LOCATION_KINDS = [
  'PHYSICAL',
  'PRODUCTION_FLOOR',
  'JOB_WORKER',
  'QUALITY_HOLD',
  'BLOCKED',
  'IN_TRANSIT',
  'SINK',
  'COUNTERPARTY',
] as const;

export type LocationKind = (typeof LOCATION_KINDS)[number];

/** Codes of the system locations the ledger resolves by name at runtime. */
/**
 * PRODUCTION_FLOOR exists because "we own 290 m of fabric" and "290 m of
 * fabric is available to cut" are different statements. Material issued to the
 * cutting department is still owned and still countable, but it has already
 * been committed to an order, so it must not appear as availability a planner
 * can promise to a second order.
 */
export const SYSTEM_LOCATIONS = {
  /** External supplier / opening-balance counter-account. */
  EXTERNAL: 'SYS-EXTERNAL',
  /** Counter-account for authorised stock corrections and count variances. */
  ADJUSTMENT: 'SYS-ADJUSTMENT',
  /** Where material legitimately ends its life inside a garment. */
  CONSUMED: 'SYS-CONSUMED',
  /** Cutting loss, damage write-off and other wastage. */
  SCRAP: 'SYS-SCRAP',
  /** Received but not yet inspected; never issuable. */
  QC_HOLD_RM: 'SYS-QC-HOLD-RM',
  /** Inspection-rejected stock awaiting a supplier return decision. */
  REJECTED_RM: 'SYS-REJECTED-RM',
  /** Administratively blocked or damaged but still owned. */
  BLOCKED_RM: 'SYS-BLOCKED-RM',
  /** In-transit between internal locations. */
  TRANSIT: 'SYS-TRANSIT',
} as const;

export type SystemLocationCode = (typeof SYSTEM_LOCATIONS)[keyof typeof SYSTEM_LOCATIONS];

export interface SystemLocationSpec {
  readonly code: SystemLocationCode;
  readonly name: string;
  readonly kind: LocationKind;
  readonly blocksIssue: boolean;
}

export const SYSTEM_LOCATION_SPECS: readonly SystemLocationSpec[] = [
  { code: SYSTEM_LOCATIONS.EXTERNAL, name: 'External / Supplier', kind: 'COUNTERPARTY', blocksIssue: true },
  { code: SYSTEM_LOCATIONS.ADJUSTMENT, name: 'Stock Adjustment Authority', kind: 'COUNTERPARTY', blocksIssue: true },
  { code: SYSTEM_LOCATIONS.CONSUMED, name: 'Consumed in Production', kind: 'SINK', blocksIssue: true },
  { code: SYSTEM_LOCATIONS.SCRAP, name: 'Scrap / Wastage', kind: 'SINK', blocksIssue: true },
  { code: SYSTEM_LOCATIONS.QC_HOLD_RM, name: 'Raw Material QC Hold', kind: 'QUALITY_HOLD', blocksIssue: true },
  { code: SYSTEM_LOCATIONS.REJECTED_RM, name: 'Raw Material Rejected', kind: 'BLOCKED', blocksIssue: true },
  { code: SYSTEM_LOCATIONS.BLOCKED_RM, name: 'Raw Material Blocked / Damaged', kind: 'BLOCKED', blocksIssue: true },
  { code: SYSTEM_LOCATIONS.TRANSIT, name: 'In Transit', kind: 'IN_TRANSIT', blocksIssue: true },
];

/**
 * Kinds whose balance represents stock the organisation actually owns.
 * COUNTERPARTY is excluded (it is the other side of the entry) and so is SINK
 * (the material is gone - burnt into a garment or scrapped).
 */
export const OWNED_KINDS: readonly LocationKind[] = [
  'PHYSICAL',
  'PRODUCTION_FLOOR',
  'JOB_WORKER',
  'QUALITY_HOLD',
  'BLOCKED',
  'IN_TRANSIT',
];

/**
 * Kinds whose stock counts as available to be issued to a NEW order.
 * Deliberately excludes PRODUCTION_FLOOR and JOB_WORKER: that stock is already
 * committed to work in progress.
 */
export const ISSUABLE_KINDS: readonly LocationKind[] = ['PHYSICAL'];

export const isOwned = (kind: LocationKind): boolean => OWNED_KINDS.includes(kind);
export const isVirtual = (kind: LocationKind): boolean => kind === 'SINK' || kind === 'COUNTERPARTY';

export interface LocationRef {
  readonly id: string;
  readonly code?: string;
  readonly kind: LocationKind;
  /** Explicit override: stock here is never available to production. */
  readonly blocksIssue?: boolean;
}

/** True when stock at this location counts towards "available for production". */
export function isIssuable(loc: LocationRef): boolean {
  if (loc.blocksIssue) return false;
  return ISSUABLE_KINDS.includes(loc.kind);
}
