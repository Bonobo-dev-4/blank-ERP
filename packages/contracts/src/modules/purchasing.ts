import { z } from 'zod';
import {
  decimalString, idempotencyKey, isoDate, nonNegativeQty, optionalText,
  paginationQuery, percentString, positiveQty, purchaseOrderStatus, receiptStatus,
  shortText, uomCode, uuid,
} from '../common';

export const createRequisitionRequest = z.object({
  requiredByDate: isoDate.nullish(),
  mrpRunId: uuid.nullish(),
  remarks: optionalText(1000),
  items: z
    .array(
      z.object({
        rawMaterialId: uuid,
        requestedQty: positiveQty,
        uom: uomCode,
        suggestedSupplierId: uuid.nullish(),
        estimatedRate: decimalString().nullish(),
        materialRequirementId: uuid.nullish(),
        remarks: optionalText(500),
      }),
    )
    .min(1)
    .max(500),
});
export type CreateRequisitionRequest = z.infer<typeof createRequisitionRequest>;

export const approveRequisitionRequest = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: optionalText(1000),
  /** Approve a different quantity than requested, line by line. */
  itemApprovals: z
    .array(z.object({ itemId: uuid, approvedQty: nonNegativeQty }))
    .max(500)
    .optional(),
});

export const createPurchaseOrderRequest = z.object({
  supplierId: uuid,
  orderDate: isoDate.optional(),
  expectedDate: isoDate.nullish(),
  deliverToLocationId: uuid.nullish(),
  overReceiptTolerancePct: percentString.default('0'),
  underReceiptTolerancePct: percentString.default('0'),
  freightAmount: decimalString().default('0'),
  currency: z.string().trim().length(3).default('INR'),
  paymentTerms: z.string().trim().max(100).nullish(),
  remarks: optionalText(1000),
  items: z
    .array(
      z.object({
        rawMaterialId: uuid,
        orderedQty: positiveQty,
        uom: uomCode,
        rate: decimalString(),
        discountPct: percentString.default('0'),
        taxPct: percentString.default('0'),
        expectedDate: isoDate.nullish(),
        requisitionItemId: uuid.nullish(),
        remarks: optionalText(500),
      }),
    )
    .min(1)
    .max(500),
});
export type CreatePurchaseOrderRequest = z.infer<typeof createPurchaseOrderRequest>;

export const updatePurchaseOrderRequest = createPurchaseOrderRequest.partial().omit({ items: true });

export const approvePurchaseOrderRequest = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: optionalText(1000),
});

export const closePurchaseOrderRequest = z.object({
  /** Mandatory: closing a PO short is a decision someone owns. */
  reason: shortText(300),
});

/**
 * Goods receipt. Quantities land in QC hold; the separate inspection step is
 * what releases them to a usable location.
 */
export const createReceiptRequest = z.object({
  idempotencyKey,
  purchaseOrderId: uuid.nullish(),
  supplierId: uuid,
  receiptDate: isoDate.optional(),
  supplierInvoiceNo: z.string().trim().max(80).nullish(),
  supplierDcNo: z.string().trim().max(80).nullish(),
  vehicleNo: z.string().trim().max(40).nullish(),
  /** Where accepted stock will be released to after inspection. */
  targetLocationId: uuid,
  freightAmount: decimalString().default('0'),
  remarks: optionalText(1000),
  lines: z
    .array(
      z.object({
        purchaseItemId: uuid.nullish(),
        rawMaterialId: uuid,
        receivedQty: positiveQty,
        uom: uomCode,
        rate: decimalString().nullish(),
        supplierLotRef: z.string().trim().max(80).nullish(),
        shade: z.string().trim().max(80).nullish(),
        width: decimalString().nullish(),
        gsm: z.coerce.number().int().min(0).max(5000).nullish(),
        /**
         * Individual fabric roll lengths. When supplied, the lengths must add
         * up to the received quantity and one barcoded roll is created per
         * entry.
         */
        rolls: z
          .array(z.object({ length: positiveQty, rollNo: z.string().trim().max(60).nullish() }))
          .max(200)
          .optional(),
        remarks: optionalText(500),
      }),
    )
    .min(1)
    .max(200),
});
export type CreateReceiptRequest = z.infer<typeof createReceiptRequest>;

export const inspectReceiptRequest = z.object({
  idempotencyKey,
  inspectionDate: isoDate.optional(),
  remarks: optionalText(1000),
  lines: z
    .array(
      z.object({
        receiptLineId: uuid,
        acceptedQty: nonNegativeQty,
        rejectedQty: nonNegativeQty.default('0'),
        rejectionReason: optionalText(300),
        /**
         * Which rolls the rejected length came off.
         *
         * Required when the line was received as individual fabric rolls and
         * any quantity is rejected: "10 m rejected" is not actionable unless
         * the system knows which roll it was cut from, and guessing would make
         * the roll lengths disagree with the stock ledger.
         *
         * A roll rejected in full moves to the rejected location. A roll
         * rejected in part is split: the bad length becomes its own roll
         * record, with its own barcode, in the rejected location.
         */
        rollDecisions: z
          .array(z.object({ fabricRollId: uuid, rejectedLength: positiveQty }))
          .max(200)
          .optional(),
      }),
    )
    .min(1)
    .max(200),
});
export type InspectReceiptRequest = z.infer<typeof inspectReceiptRequest>;

export const purchaseOrderListQuery = paginationQuery.extend({
  status: purchaseOrderStatus.optional(),
  supplierId: uuid.optional(),
  rawMaterialId: uuid.optional(),
  overdueOnly: z.coerce.boolean().optional(),
});

export const receiptListQuery = paginationQuery.extend({
  status: receiptStatus.optional(),
  supplierId: uuid.optional(),
  purchaseOrderId: uuid.optional(),
});
