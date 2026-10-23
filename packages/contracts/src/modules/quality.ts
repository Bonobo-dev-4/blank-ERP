import { z } from 'zod';
import {
  idempotencyKey, inspectionResult, nonNegativeQty, optionalText,
  paginationQuery, positiveQty, shortText, uuid,
} from '../common';

export const QC_KINDS = ['INLINE_STAGE', 'FINAL', 'REINSPECTION'] as const;
export const qcKind = z.enum(QC_KINDS);

export const DEFECT_CATEGORIES = [
  'STITCHING', 'EMBROIDERY', 'FABRIC', 'COLOR_VARIATION',
  'MEASUREMENT', 'FINISHING', 'DAMAGE', 'OTHER',
] as const;
export const defectCategory = z.enum(DEFECT_CATEGORIES);

export const DEFECT_SEVERITIES = ['MINOR', 'MAJOR', 'CRITICAL'] as const;
export const defectSeverity = z.enum(DEFECT_SEVERITIES);

export const REWORK_ORDER_STATUSES = [
  'OPEN', 'IN_PROGRESS', 'COMPLETED', 'SCRAPPED', 'CANCELLED',
] as const;
export const reworkOrderStatus = z.enum(REWORK_ORDER_STATUSES);

/**
 * One checklist answer.
 *
 * Stored as filled-in JSON on the inspection rather than as rows, because a
 * checklist is a *record of what was asked at the time*. Normalising it would
 * let a later edit to the checklist master silently rewrite the question an
 * inspector actually answered six months ago.
 */
export const checklistAnswer = z.object({
  code: shortText(50),
  label: shortText(200),
  expected: optionalText(200),
  observed: optionalText(200),
  result: z.enum(['PASS', 'FAIL', 'NA']),
});

/**
 * Record an inspection.
 *
 * `passed + failed + rework + hold` must equal exactly `inspectedQty`. A
 * garment that was looked at has an outcome; "some of them were fine" is not
 * an inspection result, and the domain refuses the split rather than letting
 * the remainder vanish.
 */
export const createInspectionRequest = z
  .object({
    idempotencyKey,
    kind: qcKind.default('INLINE_STAGE'),
    productionBatchId: uuid,
    /** The route step being inspected. Omitted for a final inspection. */
    stageTaskId: uuid.nullish(),
    inspectedQty: positiveQty,
    passedQty: nonNegativeQty.default('0'),
    failedQty: nonNegativeQty.default('0'),
    reworkQty: nonNegativeQty.default('0'),
    holdQty: nonNegativeQty.default('0'),
    checklist: z.array(checklistAnswer).max(100).default([]),
    photoUrls: z.array(z.string().url()).max(20).default([]),
    /** Set when this re-checks an earlier inspection. */
    reinspectionOfId: uuid.nullish(),
    remarks: optionalText(1000),
    defects: z
      .array(
        z.object({
          category: defectCategory,
          defectCode: z.string().trim().max(50).nullish(),
          description: optionalText(300),
          qty: positiveQty,
          severity: defectSeverity.default('MINOR'),
          /** Which stage caused it — not necessarily where it was found. */
          attributedStageId: uuid.nullish(),
          attributedJobWorkerId: uuid.nullish(),
          photoUrls: z.array(z.string().url()).max(10).default([]),
        }),
      )
      .max(100)
      .default([]),
  })
  .refine(
    (v) =>
      Number(v.passedQty) + Number(v.failedQty) + Number(v.reworkQty) + Number(v.holdQty) ===
      Number(v.inspectedQty),
    {
      message: 'Passed, failed, rework and hold must add up to exactly the inspected quantity',
      path: ['inspectedQty'],
    },
  )
  .refine(
    (v) => Number(v.failedQty) + Number(v.reworkQty) === 0 || v.defects.length > 0,
    {
      message: 'A failure or rework needs at least one recorded defect',
      path: ['defects'],
    },
  );
export type CreateInspectionRequest = z.infer<typeof createInspectionRequest>;

export const inspectionListQuery = paginationQuery.extend({
  productionBatchId: uuid.optional(),
  manufacturingOrderId: uuid.optional(),
  kind: qcKind.optional(),
  result: inspectionResult.optional(),
});

// =============================================================================
// Rework orders
// =============================================================================

/**
 * A rework ticket.
 *
 * The quantity has already left work-in-progress at its stage — the stage
 * ledger did that when the inspection recorded it. This is the *instruction*
 * to fix it: who, by when, and routed back to which step.
 */
export const createReworkOrderRequest = z.object({
  idempotencyKey,
  productionBatchId: uuid,
  qualityInspectionId: uuid.nullish(),
  /** The step the garments return to. Defaults to where they were found. */
  targetStageId: uuid.nullish(),
  qty: positiveQty,
  reason: shortText(500),
  assignedUserId: uuid.nullish(),
  assignedJobWorkerId: uuid.nullish(),
  dueDate: z.string().datetime({ offset: true }).nullish(),
});
export type CreateReworkOrderRequest = z.infer<typeof createReworkOrderRequest>;

/**
 * Close a rework ticket.
 *
 * Completed garments go back into the stage they left. Scrapped ones do not —
 * they are rejected at that stage, which is what keeps the batch arithmetic
 * closed rather than leaving a quantity permanently "out".
 */
export const closeReworkOrderRequest = z
  .object({
    idempotencyKey,
    completedQty: nonNegativeQty.default('0'),
    scrappedQty: nonNegativeQty.default('0'),
    scrapReason: optionalText(300),
    remarks: optionalText(500),
  })
  .refine(
    (v) => Number(v.completedQty) + Number(v.scrappedQty) > 0,
    'Record a completed or scrapped quantity',
  )
  .refine(
    (v) => Number(v.scrappedQty) === 0 || Boolean(v.scrapReason),
    { message: 'Scrapping garments needs a reason', path: ['scrapReason'] },
  );
export type CloseReworkOrderRequest = z.infer<typeof closeReworkOrderRequest>;

export const reworkListQuery = paginationQuery.extend({
  productionBatchId: uuid.optional(),
  status: reworkOrderStatus.optional(),
  assignedJobWorkerId: uuid.optional(),
});
