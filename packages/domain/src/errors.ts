/**
 * Domain errors. Each carries a stable machine-readable `code` so the API layer
 * can map it to an HTTP status and the UI can show a specific message, and
 * `details` so an operator can see the actual numbers that failed the check.
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** A quantity, invariant or state transition rule was violated. */
export class InvariantViolation extends DomainError {}
/** Input was structurally valid but not acceptable for this operation. */
export class ValidationError extends DomainError {}
/** The requested operation is not legal from the current state. */
export class IllegalStateError extends DomainError {}
/** A required configuration (UOM conversion, mapping, system location) is absent. */
export class ConfigurationError extends DomainError {}

export const ERR = {
  // quantities & ledger
  NON_POSITIVE_QTY: 'NON_POSITIVE_QTY',
  SAME_SOURCE_AND_DESTINATION: 'SAME_SOURCE_AND_DESTINATION',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  INSUFFICIENT_UNRESERVED_STOCK: 'INSUFFICIENT_UNRESERVED_STOCK',
  RESERVATION_EXCEEDS_ON_HAND: 'RESERVATION_EXCEEDS_ON_HAND',
  NEGATIVE_BALANCE_NOT_ALLOWED: 'NEGATIVE_BALANCE_NOT_ALLOWED',
  CONSUMPTION_EXCEEDS_ISSUED: 'CONSUMPTION_EXCEEDS_ISSUED',
  RETURN_EXCEEDS_ISSUED: 'RETURN_EXCEEDS_ISSUED',
  LEDGER_NOT_BALANCED: 'LEDGER_NOT_BALANCED',
  // uom
  NO_UOM_CONVERSION: 'NO_UOM_CONVERSION',
  INVALID_UOM_FACTOR: 'INVALID_UOM_FACTOR',
  // fabric rolls
  ROLL_LENGTH_EXCEEDED: 'ROLL_LENGTH_EXCEEDED',
  ROLL_NOT_ISSUABLE: 'ROLL_NOT_ISSUABLE',
  SHADE_MIX_NOT_APPROVED: 'SHADE_MIX_NOT_APPROVED',
  // purchasing
  RECEIPT_EXCEEDS_TOLERANCE: 'RECEIPT_EXCEEDS_TOLERANCE',
  PO_NOT_RECEIVABLE: 'PO_NOT_RECEIVABLE',
  INSPECTION_SPLIT_MISMATCH: 'INSPECTION_SPLIT_MISMATCH',
  // bom & mrp
  BOM_NOT_APPROVED: 'BOM_NOT_APPROVED',
  BOM_EMPTY: 'BOM_EMPTY',
  BOM_VERSION_FROZEN: 'BOM_VERSION_FROZEN',
  // production
  STAGE_SEQUENCE_VIOLATION: 'STAGE_SEQUENCE_VIOLATION',
  STAGE_RECEIPT_EXCEEDS_UPSTREAM: 'STAGE_RECEIPT_EXCEEDS_UPSTREAM',
  STAGE_OUTCOME_EXCEEDS_RECEIVED: 'STAGE_OUTCOME_EXCEEDS_RECEIVED',
  STAGE_FORWARD_EXCEEDS_COMPLETED: 'STAGE_FORWARD_EXCEEDS_COMPLETED',
  RELEASE_EXCEEDS_BATCH_QTY: 'RELEASE_EXCEEDS_BATCH_QTY',
  REWORK_RETURN_EXCEEDS_SENT: 'REWORK_RETURN_EXCEEDS_SENT',
  UNIT_NOT_AT_STAGE: 'UNIT_NOT_AT_STAGE',
  DUPLICATE_SCAN: 'DUPLICATE_SCAN',
  BARCODE_UNKNOWN: 'BARCODE_UNKNOWN',
  BARCODE_REVOKED: 'BARCODE_REVOKED',
  // quality & finished goods
  QC_SPLIT_MISMATCH: 'QC_SPLIT_MISMATCH',
  INWARD_EXCEEDS_QC_PASSED: 'INWARD_EXCEEDS_QC_PASSED',
  REJECTED_CANNOT_BE_SELLABLE: 'REJECTED_CANNOT_BE_SELLABLE',
  // external sync
  PUSH_EXCEEDS_ACCEPTED: 'PUSH_EXCEEDS_ACCEPTED',
  SKU_NOT_MAPPED: 'SKU_NOT_MAPPED',
  FACILITY_NOT_MAPPED: 'FACILITY_NOT_MAPPED',
  FACILITY_PUSH_DISABLED: 'FACILITY_PUSH_DISABLED',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
  EXTERNAL_WRITES_DISABLED: 'EXTERNAL_WRITES_DISABLED',
  DUPLICATE_DEMAND: 'DUPLICATE_DEMAND',
} as const;

export type ErrCode = (typeof ERR)[keyof typeof ERR];
