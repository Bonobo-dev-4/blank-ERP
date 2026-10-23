import { z } from 'zod';

/**
 * Quantities and money cross the wire as DECIMAL STRINGS, never as JS numbers.
 *
 * A JSON number is an IEEE-754 double. Sending 262.5 survives, but sending a
 * 4-decimal quantity through enough JSON round trips does not, and the failure
 * is silent. A string preserves the exact value the database holds.
 */
export const decimalString = (opts: { min?: string; allowNegative?: boolean } = {}) =>
  z
    .string()
    .trim()
    .regex(/^-?\d{1,14}(\.\d{1,6})?$/, 'Must be a decimal number with at most 6 decimal places')
    .refine((v) => opts.allowNegative || !v.startsWith('-'), 'Must not be negative')
    .refine(
      (v) => opts.min === undefined || Number(v) >= Number(opts.min),
      opts.min !== undefined ? `Must be at least ${opts.min}` : '',
    );

/** A quantity that must be strictly greater than zero. */
export const positiveQty = decimalString().refine((v) => Number(v) > 0, 'Must be greater than zero');
/** A quantity that may be zero. */
export const nonNegativeQty = decimalString();
/** A percentage between 0 and 100. */
export const percentString = decimalString().refine(
  (v) => Number(v) >= 0 && Number(v) <= 100,
  'Must be between 0 and 100',
);

export const uuid = z.string().uuid();
export const isoDate = z.string().datetime({ offset: true });
export const isoDateOptional = isoDate.nullish();

/** Codes are uppercase, dash/underscore separated, and stable. */
export const codeString = (max = 50) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[A-Z0-9][A-Z0-9._\-/]*$/, 'Use uppercase letters, digits, dot, dash, slash or underscore');

export const shortText = (max = 255) => z.string().trim().min(1).max(max);
export const optionalText = (max = 1000) => z.string().trim().max(max).nullish();

/**
 * Idempotency key supplied by the client on every mutating request that
 * touches stock or production quantities. Replaying the same key returns the
 * stored result instead of applying the effect twice.
 */
export const idempotencyKey = z.string().trim().min(8).max(200);

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sortBy: z.string().trim().max(64).optional(),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  search: z.string().trim().max(200).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

export interface Paginated<T> {
  readonly data: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export const UOM_CODES = ['METER', 'YARD', 'PIECE', 'KILOGRAM', 'GRAM', 'ROLL', 'PACKET', 'SET'] as const;
export const uomCode = z.enum(UOM_CODES);

export const MATERIAL_CATEGORIES = [
  'FABRIC', 'LINING', 'BUTTON', 'ZIPPER', 'THREAD', 'LACE', 'LABEL', 'TAG',
  'EMBROIDERY_MATERIAL', 'PACKAGING', 'ACCESSORY', 'TRIM', 'OTHER',
] as const;
export const materialCategory = z.enum(MATERIAL_CATEGORIES);

export const LOCATION_KINDS = [
  'PHYSICAL', 'PRODUCTION_FLOOR', 'JOB_WORKER', 'QUALITY_HOLD',
  'BLOCKED', 'IN_TRANSIT', 'SINK', 'COUNTERPARTY',
] as const;
export const locationKind = z.enum(LOCATION_KINDS);

export const STORAGE_LEVELS = ['WAREHOUSE', 'ROOM', 'RACK', 'BIN', 'DEPARTMENT', 'VIRTUAL'] as const;
export const storageLevel = z.enum(STORAGE_LEVELS);

export const RECORD_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;
export const recordStatus = z.enum(RECORD_STATUSES);

export const PRODUCT_STATUSES = ['DRAFT', 'ACTIVE', 'DISCONTINUED'] as const;
export const productStatus = z.enum(PRODUCT_STATUSES);

export const PRODUCTION_TYPES = ['IN_HOUSE', 'JOB_WORK', 'HYBRID', 'OUTSOURCED'] as const;
export const productionType = z.enum(PRODUCTION_TYPES);

export const MOVEMENT_TYPES = [
  'OPENING_BALANCE', 'PURCHASE_INWARD', 'QC_RELEASE', 'QC_REJECT', 'SUPPLIER_RETURN',
  'ISSUE_TO_PRODUCTION', 'RETURN_FROM_PRODUCTION', 'TRANSFER', 'ISSUE_TO_JOB_WORKER',
  'RETURN_FROM_JOB_WORKER', 'CONSUMPTION', 'WASTAGE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT',
  'STOCK_COUNT_GAIN', 'STOCK_COUNT_LOSS',
] as const;
export const movementType = z.enum(MOVEMENT_TYPES);

export const INSPECTION_RESULTS = ['PASS', 'FAIL', 'REWORK', 'HOLD'] as const;
export const inspectionResult = z.enum(INSPECTION_RESULTS);

export const FABRIC_ROLL_STATUSES = [
  'RECEIVED', 'QC_PENDING', 'AVAILABLE', 'PARTIALLY_ISSUED', 'ISSUED',
  'EXHAUSTED', 'BLOCKED', 'RETURNED_TO_SUPPLIER',
] as const;
export const fabricRollStatus = z.enum(FABRIC_ROLL_STATUSES);

export const PURCHASE_ORDER_STATUSES = [
  'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED',
] as const;
export const purchaseOrderStatus = z.enum(PURCHASE_ORDER_STATUSES);

export const RECEIPT_STATUSES = ['DRAFT', 'PENDING_INSPECTION', 'INSPECTED', 'POSTED', 'CANCELLED'] as const;
export const receiptStatus = z.enum(RECEIPT_STATUSES);

export const BOM_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SUPERSEDED', 'ARCHIVED'] as const;
export const bomStatus = z.enum(BOM_STATUSES);

export const WASTAGE_BASES = [
  'PERCENT_OF_CONSUMPTION', 'FIXED_PER_UNIT', 'FIXED_PER_ORDER', 'NONE',
] as const;
export const wastageBasis = z.enum(WASTAGE_BASES);

export const MANUFACTURING_ORDER_STATUSES = [
  'DRAFT', 'PENDING_MATERIAL', 'MATERIAL_RESERVED', 'RELEASED', 'IN_PROGRESS',
  'ON_HOLD', 'COMPLETED', 'CLOSED', 'CANCELLED',
] as const;
export const manufacturingOrderStatus = z.enum(MANUFACTURING_ORDER_STATUSES);

export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const priority = z.enum(PRIORITIES);

export const MRP_RUN_STATUSES = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'] as const;
export const mrpRunStatus = z.enum(MRP_RUN_STATUSES);

export const MATERIAL_READINESS = ['READY', 'PARTIALLY_AVAILABLE', 'SHORT', 'SHORT_AND_LATE'] as const;
export const materialReadiness = z.enum(MATERIAL_READINESS);

export const RESERVATION_STATUSES = [
  'ACTIVE', 'PARTIALLY_CONSUMED', 'CONSUMED', 'RELEASED', 'CANCELLED',
] as const;
export const reservationStatus = z.enum(RESERVATION_STATUSES);

/** Shape of every error the API returns. */
export interface ApiErrorBody {
  readonly statusCode: number;
  readonly code: string;
  readonly message: string;
  /** The actual numbers that failed a check, so an operator can see why. */
  readonly details?: Record<string, unknown>;
  readonly fieldErrors?: Record<string, readonly string[]>;
  readonly path: string;
  readonly timestamp: string;
  readonly requestId?: string;
}
