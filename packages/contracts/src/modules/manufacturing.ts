import { z } from 'zod';
import {
  idempotencyKey, isoDate, manufacturingOrderStatus, materialReadiness,
  optionalText, paginationQuery, positiveQty, priority, productionType,
  shortText, uuid,
} from '../common';

// =============================================================================
// Material requirement planning
// =============================================================================

/**
 * What to plan.
 *
 * Exactly one of the two scopes. Planning existing manufacturing orders is the
 * normal path; the ad-hoc scope answers "what would it take to make 100 of
 * this?" before an order exists, which is how a planner decides whether to
 * raise one at all.
 */
export const runMrpRequest = z
  .object({
    manufacturingOrderIds: z.array(uuid).min(1).max(200).optional(),
    adHoc: z
      .object({
        productId: uuid,
        bomVersionId: uuid.nullish(),
        lines: z
          .array(
            z.object({
              productVariantId: uuid.nullish(),
              size: z.string().trim().max(30).nullish(),
              quantity: positiveQty,
            }),
          )
          .min(1)
          .max(200),
      })
      .optional(),
    /**
     * When production must start. Incoming purchase quantity expected after
     * this date is reported as arriving late rather than as cover.
     */
    requiredByDate: isoDate.nullish(),
    notes: optionalText(1000),
  })
  .refine(
    (v) => Boolean(v.manufacturingOrderIds) !== Boolean(v.adHoc),
    'Provide either manufacturingOrderIds or adHoc, not both',
  );
export type RunMrpRequest = z.infer<typeof runMrpRequest>;

export const mrpRunListQuery = paginationQuery.extend({
  status: z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED']).optional(),
});

export const shortageListQuery = paginationQuery.extend({
  /** Only lines that remain short even counting incoming purchase orders. */
  uncoveredOnly: z.coerce.boolean().optional(),
  readiness: materialReadiness.optional(),
});

/**
 * Turn MRP purchase suggestions into a real requisition.
 *
 * Quantities are echoed back by the client rather than recomputed from the
 * run, because a planner routinely adjusts them — and because a suggestion
 * acted on hours later should not silently change under them.
 */
export const requisitionFromMrpRequest = z.object({
  mrpRunId: uuid,
  requiredByDate: isoDate.nullish(),
  remarks: optionalText(1000),
  lines: z
    .array(
      z.object({
        materialRequirementId: uuid,
        rawMaterialId: uuid,
        requestedQty: positiveQty,
        suggestedSupplierId: uuid.nullish(),
      }),
    )
    .min(1)
    .max(500),
});
export type RequisitionFromMrpRequest = z.infer<typeof requisitionFromMrpRequest>;

// =============================================================================
// Manufacturing orders
// =============================================================================

export const createManufacturingOrderRequest = z.object({
  productId: uuid,
  priority: priority.default('NORMAL'),
  productionType: productionType.default('IN_HOUSE'),
  routeId: uuid.nullish(),
  plannedStartDate: isoDate.nullish(),
  plannedEndDate: isoDate.nullish(),
  dueDate: isoDate.nullish(),
  manufacturingLocationId: uuid.nullish(),
  supervisorUserId: uuid.nullish(),
  remarks: optionalText(1000),
  idempotencyKey: idempotencyKey.optional(),
  /**
   * The size/colour breakdown. An MO is always a set of variant lines, even
   * when there is only one: a single `orderedQty` against a style cannot say
   * how many smalls to cut, and the cutting table needs exactly that.
   */
  items: z
    .array(
      z.object({
        productVariantId: uuid,
        orderedQty: positiveQty,
      }),
    )
    .min(1)
    .max(200)
    .superRefine((items, ctx) => {
      const seen = new Set<string>();
      for (const [i, item] of items.entries()) {
        if (seen.has(item.productVariantId)) {
          ctx.addIssue({
            code: 'custom', path: [i, 'productVariantId'],
            message: 'This SKU already has a line; combine the quantities',
          });
        }
        seen.add(item.productVariantId);
      }
    }),
});
export type CreateManufacturingOrderRequest = z.infer<typeof createManufacturingOrderRequest>;

export const updateManufacturingOrderRequest = createManufacturingOrderRequest
  .omit({ items: true, productId: true, idempotencyKey: true })
  .partial()
  .extend({
    items: createManufacturingOrderRequest.shape.items.optional(),
  });
export type UpdateManufacturingOrderRequest = z.infer<typeof updateManufacturingOrderRequest>;

/** Reserve stock against an order's requirements. */
export const reserveMaterialRequest = z.object({
  idempotencyKey,
  /**
   * Keep the whole order on one fabric shade. Mixing shades across panels of
   * one garment is a visible defect, so this is an explicit choice rather
   * than an allocation accident.
   */
  singleShade: z.boolean().default(false),
  /** Limit the reservation to specific materials; omitted means all of them. */
  rawMaterialIds: z.array(uuid).max(300).optional(),
});
export type ReserveMaterialRequest = z.infer<typeof reserveMaterialRequest>;

/**
 * Release an order to the floor.
 *
 * Release is the point of no return: it freezes the BOM version into an
 * immutable snapshot that costing, issue limits and wastage analysis all read
 * from. Everything about this request exists to make that freeze deliberate.
 */
export const releaseManufacturingOrderRequest = z.object({
  idempotencyKey,
  /**
   * Required when any critical material is short. The caller must also hold
   * `manufacturing.release_with_shortage`; supplying a reason without the
   * permission is still refused.
   */
  shortageOverrideReason: z.string().trim().min(10).max(1000).nullish(),
  /**
   * Release fewer garments than ordered — normally the quantity current stock
   * can actually cover. The remainder stays on the order.
   */
  releaseQty: positiveQty.nullish(),
  /** Pin a specific BOM version instead of the product's active one. */
  bomVersionId: uuid.nullish(),
});
export type ReleaseManufacturingOrderRequest = z.infer<typeof releaseManufacturingOrderRequest>;

export const cancelManufacturingOrderRequest = z.object({
  /** Mandatory: cancelling releases reserved stock, so someone owns it. */
  reason: shortText(300),
});

export const holdManufacturingOrderRequest = z.object({
  hold: z.boolean(),
  reason: optionalText(300),
});

export const manufacturingOrderListQuery = paginationQuery.extend({
  status: manufacturingOrderStatus.optional(),
  productId: uuid.optional(),
  priority: priority.optional(),
  overdueOnly: z.coerce.boolean().optional(),
  dueBefore: isoDate.optional(),
});
