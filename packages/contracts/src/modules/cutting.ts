import { z } from 'zod';
import {
  idempotencyKey, nonNegativeQty, optionalText, paginationQuery,
  positiveQty, shortText, uomCode, uuid,
} from '../common';

export const CUTTING_ORDER_STATUSES = [
  'PLANNED', 'FABRIC_ISSUED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED',
] as const;
export const cuttingOrderStatus = z.enum(CUTTING_ORDER_STATUSES);

/**
 * A cutting order: the plan for one lay.
 *
 * Created against a batch, because the pieces a cutting table produces are the
 * pieces that bundle travels on through the rest of the route.
 */
export const createCuttingOrderRequest = z.object({
  idempotencyKey,
  productionBatchId: uuid,
  fabricMaterialId: uuid,
  /** Size-wise cutting plan. Must add up to the pieces planned. */
  sizeBreakdown: z
    .array(z.object({ size: shortText(30), plannedPieces: positiveQty }))
    .min(1)
    .max(40),
  plannedPieces: positiveQty,
  remarks: optionalText(500),
});
export type CreateCuttingOrderRequest = z.infer<typeof createCuttingOrderRequest>;

/**
 * Issue fabric to the cutting table.
 *
 * This is a TRANSFER, not a consumption: the fabric moves from the warehouse
 * to the cutting department and the owned quantity is unchanged. Only
 * completing the cut retires it. Conflating the two is the specification's
 * central failure mode — the same material deducted twice as it moves.
 */
export const issueFabricRequest = z.object({
  idempotencyKey,
  sourceLocationId: uuid,
  lines: z
    .array(
      z.object({
        rawMaterialId: uuid,
        materialLotId: uuid,
        fabricRollId: uuid.nullish(),
        quantity: positiveQty,
        uom: uomCode,
      }),
    )
    .min(1)
    .max(100),
  remarks: optionalText(500),
});
export type IssueFabricRequest = z.infer<typeof issueFabricRequest>;

/**
 * Complete the cut.
 *
 * This is the one operation in the cutting module that retires fabric, and it
 * may happen exactly once per cutting order — `consumptionPostedAt` is the
 * guard. Completing twice must never deduct fabric twice.
 *
 * `consumedQty + wastageQty` is bounded by what was actually issued to the
 * cutting department for that lot: a cutting table cannot consume fabric it
 * was never given.
 */
export const completeCuttingRequest = z.object({
  idempotencyKey,
  actualPiecesCut: nonNegativeQty,
  rejectedPieces: nonNegativeQty.default('0'),
  rejectionReason: optionalText(300),
  /** Per-size actuals, so a short cut can be traced to the size it hit. */
  sizeActuals: z
    .array(z.object({ size: shortText(30), actualPieces: nonNegativeQty }))
    .max(40)
    .default([]),
  consumption: z
    .array(
      z.object({
        rawMaterialId: uuid,
        materialLotId: uuid,
        fabricRollId: uuid.nullish(),
        consumedQty: nonNegativeQty,
        wastageQty: nonNegativeQty.default('0'),
        uom: uomCode,
      }),
    )
    .min(1)
    .max(100),
  /** Fabric going back to the warehouse unused. */
  returns: z
    .array(
      z.object({
        rawMaterialId: uuid,
        materialLotId: uuid,
        fabricRollId: uuid.nullish(),
        quantity: positiveQty,
        uom: uomCode,
      }),
    )
    .max(100)
    .default([]),
  remarks: optionalText(500),
});
export type CompleteCuttingRequest = z.infer<typeof completeCuttingRequest>;

export const cuttingOrderListQuery = paginationQuery.extend({
  manufacturingOrderId: uuid.optional(),
  productionBatchId: uuid.optional(),
  status: cuttingOrderStatus.optional(),
});

// =============================================================================
// Job work
// =============================================================================

export const JOB_WORK_ORDER_STATUSES = [
  'DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED',
] as const;
export const jobWorkOrderStatus = z.enum(JOB_WORK_ORDER_STATUSES);

export const createJobWorkOrderRequest = z.object({
  idempotencyKey,
  manufacturingOrderId: uuid,
  jobWorkerId: uuid,
  productionStageId: uuid,
  ratePerPiece: nonNegativeQty.default('0'),
  dueDate: z.string().datetime({ offset: true }).nullish(),
  remarks: optionalText(500),
  lines: z
    .array(z.object({ productionBatchId: uuid, assignedQty: positiveQty }))
    .min(1)
    .max(100),
});
export type CreateJobWorkOrderRequest = z.infer<typeof createJobWorkOrderRequest>;

/**
 * Receive work back from a job worker.
 *
 * Quantities are recorded per batch, because the charge is per piece and a
 * worker who returns 90 good and 10 rejected is not paid for 100.
 */
export const receiveJobWorkRequest = z.object({
  idempotencyKey,
  lines: z
    .array(
      z.object({
        productionBatchId: uuid,
        completedQty: nonNegativeQty.default('0'),
        rejectedQty: nonNegativeQty.default('0'),
        reworkQty: nonNegativeQty.default('0'),
        rejectionReason: optionalText(300),
      }),
    )
    .min(1)
    .max(100),
  remarks: optionalText(500),
});
export type ReceiveJobWorkRequest = z.infer<typeof receiveJobWorkRequest>;

export const jobWorkListQuery = paginationQuery.extend({
  manufacturingOrderId: uuid.optional(),
  jobWorkerId: uuid.optional(),
  productionStageId: uuid.optional(),
  status: jobWorkOrderStatus.optional(),
  overdueOnly: z.coerce.boolean().optional(),
});

// =============================================================================
// Unit serialisation
// =============================================================================

/**
 * Give each garment in a batch its own barcode.
 *
 * Only worth doing where a single garment has to be traceable on its own — a
 * made-to-measure piece, or a style with a history of returns. For everything
 * else the batch is the unit, and minting 500 barcodes nobody scans is work
 * the floor will route around.
 */
export const serialiseBatchRequest = z.object({
  idempotencyKey,
  /** Defaults to the batch's released quantity. */
  quantity: positiveQty.optional(),
});
export type SerialiseBatchRequest = z.infer<typeof serialiseBatchRequest>;

export const PRODUCTION_UNIT_STATUSES = [
  'CREATED', 'IN_PROGRESS', 'REWORK', 'REJECTED', 'QC_PASSED', 'INWARDED',
] as const;
export const productionUnitStatus = z.enum(PRODUCTION_UNIT_STATUSES);

export const unitListQuery = paginationQuery.extend({
  productionBatchId: uuid.optional(),
  status: productionUnitStatus.optional(),
});
