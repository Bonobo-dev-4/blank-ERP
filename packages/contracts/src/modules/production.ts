import { z } from 'zod';
import {
  decimalString, idempotencyKey, nonNegativeQty, optionalText, paginationQuery,
  positiveQty, shortText, uuid,
} from '../common';

export const TRACKING_MODES = ['BATCH', 'UNIT'] as const;
export const trackingMode = z.enum(TRACKING_MODES);

export const STAGE_TASK_STATUSES = [
  'NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'BLOCKED',
] as const;
export const stageTaskStatus = z.enum(STAGE_TASK_STATUSES);

export const BATCH_STATUSES = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'CANCELLED'] as const;
export const batchStatus = z.enum(BATCH_STATUSES);

export const SCAN_EVENT_TYPES = [
  'STAGE_RECEIVE', 'STAGE_COMPLETE', 'STAGE_REJECT', 'REWORK_SEND', 'REWORK_RETURN',
  'QC_SCAN', 'FG_INWARD_SCAN', 'MATERIAL_RECEIPT_SCAN', 'FABRIC_ROLL_ISSUE_SCAN',
  'FABRIC_ROLL_RETURN_SCAN', 'LOOKUP',
] as const;
export const scanEventType = z.enum(SCAN_EVENT_TYPES);

// =============================================================================
// Batches
// =============================================================================

/**
 * Create production batches for a released order.
 *
 * Batches are created explicitly rather than at release, because a batch is a
 * physical bundle whose size is a floor decision — see decisions.md §26.
 * Omitting `batches` creates one per order line for its full released quantity,
 * which is the common case for a short run.
 */
export const createBatchesRequest = z.object({
  manufacturingOrderId: uuid,
  /** Overrides the order's route and the product default. */
  routeId: uuid.nullish(),
  trackingMode: trackingMode.default('BATCH'),
  idempotencyKey,
  batches: z
    .array(
      z.object({
        manufacturingOrderItemId: uuid,
        plannedQty: positiveQty,
      }),
    )
    .max(200)
    .optional(),
});
export type CreateBatchesRequest = z.infer<typeof createBatchesRequest>;

/**
 * Split a batch into smaller ones.
 *
 * Only the quantity that has not yet entered the route can be split off: once
 * garments are at a stage they are physically in a bundle somewhere.
 */
export const splitBatchRequest = z.object({
  idempotencyKey,
  reason: shortText(300),
  parts: z.array(z.object({ plannedQty: positiveQty })).min(1).max(50),
});
export type SplitBatchRequest = z.infer<typeof splitBatchRequest>;

/** Put quantity into the first step of the route. */
export const releaseBatchRequest = z.object({
  idempotencyKey,
  releaseQty: positiveQty,
});

export const batchListQuery = paginationQuery.extend({
  manufacturingOrderId: uuid.optional(),
  status: batchStatus.optional(),
  productionStageId: uuid.optional(),
});

// =============================================================================
// Stage transitions
// =============================================================================

/**
 * What a stage did with the garments it holds.
 *
 * At least one quantity must be greater than zero, and their sum is bounded by
 * the stage's own work in progress — which is what stops a second identical
 * submission silently doubling the numbers.
 */
export const stageOutcomeRequest = z
  .object({
    idempotencyKey,
    completedQty: nonNegativeQty.default('0'),
    rejectedQty: nonNegativeQty.default('0'),
    reworkQty: nonNegativeQty.default('0'),
    rejectionReason: optionalText(300),
    operatorUserId: uuid.nullish(),
    remarks: optionalText(500),
  })
  .refine(
    (v) => Number(v.completedQty) + Number(v.rejectedQty) + Number(v.reworkQty) > 0,
    'Record at least one of completed, rejected or rework quantity',
  )
  .refine(
    (v) => Number(v.rejectedQty) === 0 || Boolean(v.rejectionReason),
    { message: 'A rejection needs a reason', path: ['rejectionReason'] },
  );
export type StageOutcomeRequest = z.infer<typeof stageOutcomeRequest>;

/** Hand accepted quantity to the next step of the route. */
export const forwardStageRequest = z.object({
  idempotencyKey,
  forwardQty: positiveQty,
  /** Target step; omitted means the immediately following one. */
  toStageTaskId: uuid.nullish(),
  /**
   * Skipping a step is an authorised exception, not a convenience. Requires
   * `production.override_stage`.
   */
  allowStageSkip: z.boolean().default(false),
  overrideReason: optionalText(500),
  remarks: optionalText(500),
});
export type ForwardStageRequest = z.infer<typeof forwardStageRequest>;

/** Bring reworked quantity back to the stage it left. */
export const returnFromReworkRequest = z.object({
  idempotencyKey,
  returnQty: positiveQty,
  remarks: optionalText(500),
});

export const assignStageTaskRequest = z.object({
  assignedUserId: uuid.nullish(),
  assignedJobWorkerId: uuid.nullish(),
  plannedStartAt: z.string().datetime({ offset: true }).nullish(),
  plannedEndAt: z.string().datetime({ offset: true }).nullish(),
});

export const stageTaskListQuery = paginationQuery.extend({
  productionStageId: uuid.optional(),
  status: stageTaskStatus.optional(),
  productionBatchId: uuid.optional(),
  /** Only steps with work in progress — the shop-floor default. */
  withWipOnly: z.coerce.boolean().optional(),
});

// =============================================================================
// Scanning
// =============================================================================

/**
 * What is this code, and what can be done with it here?
 *
 * Read-only and deliberately separate from recording. The scan station looks a
 * code up first and shows the operator what it found before asking for a
 * quantity, because a scan that silently does the wrong thing to the wrong
 * batch is far harder to unpick than one that asks.
 */
export const resolveScanRequest = z.object({
  code: shortText(120),
  /** Where the operator is standing. Narrows what is offered. */
  productionStageId: uuid.nullish(),
});
export type ResolveScanRequest = z.infer<typeof resolveScanRequest>;

/**
 * Record a scan.
 *
 * `idempotencyKey` is generated ON THE DEVICE at the moment of the physical
 * scan, not when the request is finally sent — see decisions.md §27. That is
 * what makes a replay from the offline queue provably the same event rather
 * than a second one.
 */
export const recordScanRequest = z.object({
  idempotencyKey,
  code: shortText(120),
  eventType: scanEventType,
  productionStageId: uuid.nullish(),
  stageTaskId: uuid.nullish(),
  completedQty: nonNegativeQty.optional(),
  rejectedQty: nonNegativeQty.optional(),
  reworkQty: nonNegativeQty.optional(),
  rejectionReason: optionalText(300),
  /**
   * When the scan actually happened on the device. A queued scan sent an hour
   * later must not be recorded as having happened an hour late.
   */
  scannedAt: z.string().datetime({ offset: true }).optional(),
  deviceId: z.string().trim().max(100).nullish(),
  sessionId: z.string().trim().max(100).nullish(),
  remarks: optionalText(500),
});
export type RecordScanRequest = z.infer<typeof recordScanRequest>;

export const scanHistoryQuery = paginationQuery.extend({
  productionBatchId: uuid.optional(),
  operatorUserId: uuid.optional(),
  eventType: scanEventType.optional(),
  status: z.enum(['ACCEPTED', 'REJECTED_VALIDATION', 'DUPLICATE_IGNORED']).optional(),
  since: z.string().datetime({ offset: true }).optional(),
});

// =============================================================================
// Routes and stages (administration)
// =============================================================================

export const upsertStageRequest = z.object({
  code: shortText(50),
  name: shortText(150),
  sequenceHint: z.coerce.number().int().min(0).max(999).default(0),
  defaultLocationId: uuid.nullish(),
  /** The stage physically consumes material, so it may post consumption. */
  consumesMaterial: z.boolean().default(false),
  allowsJobWork: z.boolean().default(false),
  requiresQc: z.boolean().default(false),
  serialisesUnits: z.boolean().default(false),
});
export type UpsertStageRequest = z.infer<typeof upsertStageRequest>;

/**
 * A route is an ordered list of stages.
 *
 * Steps are replaced wholesale rather than patched: a route's meaning is the
 * sequence, and reconciling partial edits against an older client view is how
 * a step quietly ends up in the wrong place.
 */
export const upsertRouteRequest = z.object({
  code: shortText(50),
  name: shortText(150),
  description: optionalText(500),
  isDefault: z.boolean().default(false),
  steps: z
    .array(
      z.object({
        productionStageId: uuid,
        sequence: z.coerce.number().int().min(1).max(99),
        isOptional: z.boolean().default(false),
        standardMinutes: decimalString().nullish(),
        slaHours: decimalString().nullish(),
        defaultJobWorkerId: uuid.nullish(),
      }),
    )
    .min(1)
    .max(40)
    .superRefine((steps, ctx) => {
      const seenSeq = new Set<number>();
      const seenStage = new Set<string>();
      for (const [i, step] of steps.entries()) {
        if (seenSeq.has(step.sequence)) {
          ctx.addIssue({ code: 'custom', path: [i, 'sequence'], message: `Duplicate sequence ${step.sequence}` });
        }
        seenSeq.add(step.sequence);
        // A stage twice in one route makes "the next step" ambiguous, and the
        // stage ledger moves quantity by sequence.
        if (seenStage.has(step.productionStageId)) {
          ctx.addIssue({
            code: 'custom', path: [i, 'productionStageId'],
            message: 'This stage is already a step on this route',
          });
        }
        seenStage.add(step.productionStageId);
      }
    }),
});
export type UpsertRouteRequest = z.infer<typeof upsertRouteRequest>;
