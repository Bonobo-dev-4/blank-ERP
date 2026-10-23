import { ValidationError } from './errors';

/**
 * Document number scopes and their prefixes.
 *
 * Numbers are allocated from a per-organisation counter row updated inside the
 * caller's transaction, so they are gap-free and unique. They are NOT derived
 * from a timestamp or a random suffix: operations staff quote these numbers to
 * each other, and "MO-000125" is a great deal easier to read over a noisy
 * factory floor than a UUID.
 */
export const DOC_SCOPES = {
  MANUFACTURING_ORDER: 'MANUFACTURING_ORDER',
  PRODUCTION_BATCH: 'PRODUCTION_BATCH',
  MANUFACTURING_DEMAND: 'MANUFACTURING_DEMAND',
  PURCHASE_REQUISITION: 'PURCHASE_REQUISITION',
  PURCHASE_ORDER: 'PURCHASE_ORDER',
  GOODS_RECEIPT: 'GOODS_RECEIPT',
  MATERIAL_MOVEMENT: 'MATERIAL_MOVEMENT',
  MATERIAL_ISSUE: 'MATERIAL_ISSUE',
  MATERIAL_LOT: 'MATERIAL_LOT',
  FABRIC_ROLL: 'FABRIC_ROLL',
  STOCK_COUNT: 'STOCK_COUNT',
  CUTTING_ORDER: 'CUTTING_ORDER',
  JOB_WORK_ORDER: 'JOB_WORK_ORDER',
  QUALITY_INSPECTION: 'QUALITY_INSPECTION',
  REWORK_ORDER: 'REWORK_ORDER',
  FINISHED_GOODS_INWARD: 'FINISHED_GOODS_INWARD',
  FINISHED_GOODS_MOVEMENT: 'FINISHED_GOODS_MOVEMENT',
  INVENTORY_PUSH_JOB: 'INVENTORY_PUSH_JOB',
  MRP_RUN: 'MRP_RUN',
  BOM: 'BOM',
} as const;

export type DocScope = (typeof DOC_SCOPES)[keyof typeof DOC_SCOPES];

export interface SequenceSpec {
  readonly prefix: string;
  readonly padding: number;
  /** Include the calendar year, e.g. DD-MFG-2026-000125. */
  readonly includeYear?: boolean;
}

export const SEQUENCE_SPECS: Readonly<Record<DocScope, SequenceSpec>> = {
  MANUFACTURING_ORDER: { prefix: 'DD-MFG', padding: 6, includeYear: true },
  PRODUCTION_BATCH: { prefix: 'BATCH', padding: 6 },
  MANUFACTURING_DEMAND: { prefix: 'DEM', padding: 6 },
  PURCHASE_REQUISITION: { prefix: 'PR', padding: 6 },
  PURCHASE_ORDER: { prefix: 'RMPO', padding: 6 },
  GOODS_RECEIPT: { prefix: 'GRN', padding: 6 },
  MATERIAL_MOVEMENT: { prefix: 'MOV', padding: 8 },
  MATERIAL_ISSUE: { prefix: 'ISS', padding: 6 },
  MATERIAL_LOT: { prefix: 'LOT', padding: 6 },
  FABRIC_ROLL: { prefix: 'ROLL', padding: 6 },
  STOCK_COUNT: { prefix: 'SC', padding: 6 },
  CUTTING_ORDER: { prefix: 'CUT', padding: 6 },
  JOB_WORK_ORDER: { prefix: 'JW', padding: 6 },
  QUALITY_INSPECTION: { prefix: 'QC', padding: 6 },
  REWORK_ORDER: { prefix: 'RW', padding: 6 },
  FINISHED_GOODS_INWARD: { prefix: 'FGI', padding: 6 },
  FINISHED_GOODS_MOVEMENT: { prefix: 'FGM', padding: 8 },
  INVENTORY_PUSH_JOB: { prefix: 'PUSH', padding: 6 },
  MRP_RUN: { prefix: 'MRP', padding: 6 },
  BOM: { prefix: 'BOM', padding: 5 },
};

/** Format an allocated counter value into its document number. */
export function formatDocNo(scope: DocScope, value: number, year?: number): string {
  const spec = SEQUENCE_SPECS[scope];
  if (!spec) {
    throw new ValidationError('UNKNOWN_DOC_SCOPE', `No sequence specification for scope ${scope}`, { scope });
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new ValidationError('INVALID_SEQUENCE_VALUE', 'Sequence value must be a positive integer', {
      scope, value,
    });
  }
  const body = String(value).padStart(spec.padding, '0');
  if (spec.includeYear) {
    const y = year ?? new Date().getUTCFullYear();
    return `${spec.prefix}-${y}-${body}`;
  }
  return `${spec.prefix}-${body}`;
}

/**
 * The sequence scope key. Year-scoped sequences restart each year, so the
 * counter row is per (scope, year).
 */
export function sequenceScopeKey(scope: DocScope, year?: number): string {
  const spec = SEQUENCE_SPECS[scope];
  if (spec?.includeYear) return `${scope}:${year ?? new Date().getUTCFullYear()}`;
  return scope;
}
