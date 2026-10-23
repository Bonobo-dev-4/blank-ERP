import { z } from 'zod';
import {
  decimalString, idempotencyKey, movementType, nonNegativeQty, optionalText,
  paginationQuery, positiveQty, shortText, uomCode, uuid,
} from '../common';

/**
 * Every stock mutation carries an idempotency key. The shop floor works over
 * patchy wifi with barcode terminals that retry; without this, one physical
 * issue of fabric becomes two ledger entries.
 */
const mutating = { idempotencyKey };

export const materialInwardRequest = z.object({
  ...mutating,
  rawMaterialId: uuid,
  /** Omit to let the service create a lot from the receipt attributes. */
  materialLotId: uuid.nullish(),
  lotCode: z.string().trim().max(60).nullish(),
  quantity: positiveQty,
  uom: uomCode,
  destinationLocationId: uuid,
  unitCost: decimalString().nullish(),
  supplierId: uuid.nullish(),
  shade: z.string().trim().max(80).nullish(),
  width: decimalString().nullish(),
  reason: shortText(200),
  remarks: optionalText(1000),
});
export type MaterialInwardRequest = z.infer<typeof materialInwardRequest>;

export const materialTransferRequest = z.object({
  ...mutating,
  rawMaterialId: uuid,
  materialLotId: uuid,
  fabricRollId: uuid.nullish(),
  quantity: positiveQty,
  uom: uomCode,
  sourceLocationId: uuid,
  destinationLocationId: uuid,
  reason: optionalText(200),
  remarks: optionalText(1000),
});
export type MaterialTransferRequest = z.infer<typeof materialTransferRequest>;

export const materialIssueLineRequest = z.object({
  rawMaterialId: uuid,
  materialLotId: uuid,
  fabricRollId: uuid.nullish(),
  quantity: positiveQty,
  uom: uomCode,
  remarks: optionalText(500),
});

export const materialIssueRequest = z.object({
  ...mutating,
  manufacturingOrderId: uuid.nullish(),
  stageTaskId: uuid.nullish(),
  jobWorkOrderId: uuid.nullish(),
  sourceLocationId: uuid,
  destinationLocationId: uuid,
  issueType: z.enum(['PRODUCTION', 'JOB_WORK', 'SAMPLE']).default('PRODUCTION'),
  lines: z.array(materialIssueLineRequest).min(1).max(200),
  remarks: optionalText(1000),
});
export type MaterialIssueRequest = z.infer<typeof materialIssueRequest>;

export const materialReturnRequest = z.object({
  ...mutating,
  materialIssueId: uuid.nullish(),
  sourceLocationId: uuid,
  destinationLocationId: uuid,
  lines: z
    .array(
      z.object({
        rawMaterialId: uuid,
        materialLotId: uuid,
        fabricRollId: uuid.nullish(),
        quantity: positiveQty,
        uom: uomCode,
        materialIssueLineId: uuid.nullish(),
      }),
    )
    .min(1)
    .max(200),
  reason: shortText(200),
  remarks: optionalText(1000),
});
export type MaterialReturnRequest = z.infer<typeof materialReturnRequest>;

export const materialConsumptionRequest = z.object({
  ...mutating,
  manufacturingOrderId: uuid,
  productionBatchId: uuid.nullish(),
  stageTaskId: uuid.nullish(),
  sourceLocationId: uuid,
  lines: z
    .array(
      z.object({
        rawMaterialId: uuid,
        materialLotId: uuid,
        fabricRollId: uuid.nullish(),
        consumedQty: nonNegativeQty,
        wastageQty: nonNegativeQty.default('0'),
        uom: uomCode,
        materialIssueLineId: uuid.nullish(),
      }),
    )
    .min(1)
    .max(200),
  remarks: optionalText(1000),
});
export type MaterialConsumptionRequest = z.infer<typeof materialConsumptionRequest>;

/** Stock adjustment: elevated, and a reason is mandatory, not optional. */
export const stockAdjustmentRequest = z.object({
  ...mutating,
  rawMaterialId: uuid,
  materialLotId: uuid,
  locationId: uuid,
  /** Signed: positive increases stock, negative decreases it. */
  adjustmentQty: decimalString({ allowNegative: true }).refine(
    (v) => Number(v) !== 0,
    'Adjustment quantity cannot be zero',
  ),
  uom: uomCode,
  reason: shortText(300),
  remarks: optionalText(1000),
});
export type StockAdjustmentRequest = z.infer<typeof stockAdjustmentRequest>;

export const rollIssueRequest = z.object({
  ...mutating,
  fabricRollId: uuid,
  quantity: positiveQty,
  destinationLocationId: uuid,
  manufacturingOrderId: uuid.nullish(),
  cuttingOrderId: uuid.nullish(),
  remarks: optionalText(500),
});
export type RollIssueRequest = z.infer<typeof rollIssueRequest>;

export const rollReturnRequest = z.object({
  ...mutating,
  fabricRollId: uuid,
  quantity: positiveQty,
  sourceLocationId: uuid,
  destinationLocationId: uuid,
  reason: shortText(200),
  remarks: optionalText(500),
});
export type RollReturnRequest = z.infer<typeof rollReturnRequest>;

export const movementListQuery = paginationQuery.extend({
  rawMaterialId: uuid.optional(),
  materialLotId: uuid.optional(),
  fabricRollId: uuid.optional(),
  locationId: uuid.optional(),
  movementType: movementType.optional(),
  referenceType: z.string().trim().max(60).optional(),
  referenceId: uuid.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export const balanceListQuery = paginationQuery.extend({
  rawMaterialId: uuid.optional(),
  locationId: uuid.optional(),
  materialLotId: uuid.optional(),
  category: z.string().trim().max(40).optional(),
  /** Hide rows whose on-hand quantity is zero. */
  nonZeroOnly: z.coerce.boolean().default(true),
});

export interface StockPositionDto {
  readonly rawMaterialId: string;
  readonly materialCode: string;
  readonly materialName: string;
  readonly baseUom: string;
  readonly onHandQty: string;
  readonly issuableQty: string;
  readonly reservedQty: string;
  readonly availableQty: string;
  readonly qualityHoldQty: string;
  readonly blockedQty: string;
  readonly withJobWorkerQty: string;
  readonly inTransitQty: string;
  readonly minimumStock: string;
  readonly reorderLevel: string;
  readonly alertLevel: 'OK' | 'AT_REORDER_LEVEL' | 'BELOW_MINIMUM' | 'OUT_OF_STOCK';
}

// -----------------------------------------------------------------------------
// Stock counts (cycle counting / stock audits)
// -----------------------------------------------------------------------------

export const openStockCountRequest = z.object({
  ...mutating,
  locationId: uuid,
  /** Limit the count to these materials; omit to count everything at the location. */
  rawMaterialIds: z.array(uuid).max(500).optional(),
  remarks: optionalText(1000),
});
export type OpenStockCountRequest = z.infer<typeof openStockCountRequest>;

export const recordStockCountRequest = z.object({
  ...mutating,
  lines: z
    .array(
      z.object({
        lineId: uuid,
        countedQty: decimalString(),
        reason: optionalText(300),
      }),
    )
    .min(1)
    .max(500),
});
export type RecordStockCountRequest = z.infer<typeof recordStockCountRequest>;

export const postStockCountRequest = z.object({
  ...mutating,
  /**
   * Required: posting a count writes adjustments to the ledger, and the
   * specification does not allow a stock change without a stated reason.
   */
  reason: shortText(300),
});
export type PostStockCountRequest = z.infer<typeof postStockCountRequest>;

export const stockCountListQuery = z.object({
  status: z.enum(['DRAFT', 'COUNTED', 'POSTED', 'CANCELLED']).optional(),
  locationId: uuid.optional(),
});
export type StockCountListQuery = z.infer<typeof stockCountListQuery>;
