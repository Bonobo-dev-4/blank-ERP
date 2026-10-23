import { z } from 'zod';
import {
  bomStatus, codeString, decimalString, nonNegativeQty, optionalText,
  paginationQuery, positiveQty, shortText, uomCode, uuid, wastageBasis,
} from '../common';

/**
 * A BOM line.
 *
 * `consumptionQty` is net consumption per `baseQuantity` garments, BEFORE
 * wastage. Wastage is expressed separately rather than baked into the
 * consumption figure, because the two answer different questions: consumption
 * is what ends up in the garment, wastage is what the cutting table loses. A
 * single combined number makes it impossible to tell a BOM error from a
 * process problem.
 */
export const bomItemInput = z.object({
  lineNo: z.coerce.number().int().min(1).max(999),
  rawMaterialId: uuid,
  consumptionQty: positiveQty,
  uom: uomCode,
  wastageBasis: wastageBasis.default('PERCENT_OF_CONSUMPTION'),
  wastageValue: nonNegativeQty.default('0'),
  productionStageId: uuid.nullish(),
  unitCost: decimalString().nullish(),
  /**
   * False for a line production can start without (a hang tag). Critical lines
   * are what a shortage blocks on; non-critical lines are reported but do not
   * stop a release.
   */
  isCritical: z.boolean().default(true),
  notes: optionalText(500),
  /** Approved substitutes, in preference order. */
  alternatives: z
    .array(
      z.object({
        rawMaterialId: uuid,
        preferenceOrder: z.coerce.number().int().min(1).max(99).default(1),
        conversionFactor: positiveQty.default('1'),
        notes: optionalText(300),
      }),
    )
    .max(20)
    .default([]),
  /** Size-wise consumption overrides, e.g. XS 2.30 m, XXL 2.85 m. */
  sizeOverrides: z
    .array(z.object({ size: shortText(30), consumptionQty: positiveQty }))
    .max(40)
    .default([]),
});
export type BomLineInput = z.infer<typeof bomItemInput>;

const itemsArray = z
  .array(bomItemInput)
  .min(1, 'A BOM needs at least one material line')
  .max(300)
  .superRefine((items, ctx) => {
    const seenLines = new Set<number>();
    const seenMaterials = new Set<string>();
    for (const [i, item] of items.entries()) {
      if (seenLines.has(item.lineNo)) {
        ctx.addIssue({ code: 'custom', path: [i, 'lineNo'], message: `Duplicate line number ${item.lineNo}` });
      }
      seenLines.add(item.lineNo);
      // One line per material: two lines for the same material would make the
      // explosion ambiguous about which wastage basis applies.
      if (seenMaterials.has(item.rawMaterialId)) {
        ctx.addIssue({
          code: 'custom', path: [i, 'rawMaterialId'],
          message: 'This material already has a line; combine them instead',
        });
      }
      seenMaterials.add(item.rawMaterialId);

      if (item.alternatives.some((a) => a.rawMaterialId === item.rawMaterialId)) {
        ctx.addIssue({
          code: 'custom', path: [i, 'alternatives'],
          message: 'A material cannot be its own alternative',
        });
      }
    }
  });

export const createBomRequest = z.object({
  productId: uuid,
  /** Null = a style-level BOM applying to every variant of the product. */
  productVariantId: uuid.nullish(),
  bomCode: codeString(50).optional(),
  name: optionalText(255),
  notes: optionalText(1000),
  baseQuantity: positiveQty.default('1'),
  items: itemsArray,
});
export type CreateBomRequest = z.infer<typeof createBomRequest>;

/**
 * A new draft version of an existing BOM.
 *
 * Omitting `items` clones the lines of `basedOnVersionId` (or the latest
 * version), which is how a revision normally starts: change one line, leave
 * the other forty alone.
 */
export const createBomVersionRequest = z.object({
  basedOnVersionId: uuid.nullish(),
  baseQuantity: positiveQty.optional(),
  changeNote: optionalText(1000),
  items: itemsArray.optional(),
});
export type CreateBomVersionRequest = z.infer<typeof createBomVersionRequest>;

export const updateBomVersionRequest = z.object({
  baseQuantity: positiveQty.optional(),
  changeNote: optionalText(1000),
  items: itemsArray,
});
export type UpdateBomVersionRequest = z.infer<typeof updateBomVersionRequest>;

export const decideBomVersionRequest = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: optionalText(1000),
  /**
   * Make this the active BOM for the variants it covers. Approving without
   * activating is legitimate: a BOM for next season can be approved now and
   * activated when the season starts.
   */
  setActive: z.boolean().default(true),
});
export type DecideBomVersionRequest = z.infer<typeof decideBomVersionRequest>;

/** Size-wise demand for an explosion preview. */
export const explosionDemandLine = z.object({
  productVariantId: uuid.nullish(),
  size: z.string().trim().max(30).nullish(),
  quantity: positiveQty,
});

export const explodeBomRequest = z.object({
  demand: z.array(explosionDemandLine).min(1).max(200),
  /**
   * Explode a DRAFT version. Allowed for preview only — a draft can never
   * drive a real manufacturing order.
   */
  allowUnapproved: z.boolean().default(false),
});
export type ExplodeBomRequest = z.infer<typeof explodeBomRequest>;

export const bomListQuery = paginationQuery.extend({
  productId: uuid.optional(),
  status: bomStatus.optional(),
  rawMaterialId: uuid.optional(),
});

export const bomVersionListQuery = paginationQuery.extend({
  bomId: uuid.optional(),
  status: bomStatus.optional(),
});

export const bomDiffQuery = z.object({ fromVersionId: uuid, toVersionId: uuid });
