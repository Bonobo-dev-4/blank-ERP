import { z } from 'zod';
import {
  codeString, decimalString, locationKind, materialCategory, nonNegativeQty,
  optionalText, paginationQuery, percentString, recordStatus, shortText,
  storageLevel, uomCode, uuid,
} from '../common';

export const createRawMaterialRequest = z.object({
  materialCode: codeString(50),
  name: shortText(200),
  category: materialCategory,
  description: optionalText(1000),
  color: z.string().trim().max(80).nullish(),
  colorCode: z.string().trim().max(40).nullish(),
  fabricComposition: z.string().trim().max(200).nullish(),
  width: decimalString().nullish(),
  widthUom: z.string().trim().max(20).nullish(),
  gsm: z.coerce.number().int().min(0).max(5000).nullish(),
  baseUom: uomCode,
  purchaseUom: uomCode.nullish(),
  defaultSupplierId: uuid.nullish(),
  purchaseRate: decimalString().nullish(),
  minimumStock: nonNegativeQty.default('0'),
  reorderLevel: nonNegativeQty.default('0'),
  reorderQty: nonNegativeQty.default('0'),
  leadTimeDays: z.coerce.number().int().min(0).max(365).default(0),
  defaultLocationId: uuid.nullish(),
  lotTracked: z.boolean().default(true),
  shadeTracked: z.boolean().default(false),
  status: recordStatus.default('ACTIVE'),
});
export type CreateRawMaterialRequest = z.infer<typeof createRawMaterialRequest>;

export const updateRawMaterialRequest = createRawMaterialRequest.partial();

export const materialListQuery = paginationQuery.extend({
  category: materialCategory.optional(),
  status: recordStatus.optional(),
  supplierId: uuid.optional(),
  /** Only materials at or below their reorder level. */
  belowReorderLevel: z.coerce.boolean().optional(),
});

export const upsertUomConversionRequest = z
  .object({
    rawMaterialId: uuid.nullish(),
    fromUom: uomCode,
    toUom: uomCode,
    factor: decimalString().refine((v) => Number(v) > 0, 'Factor must be greater than zero'),
    note: optionalText(300),
  })
  .refine((v) => v.fromUom !== v.toUom, {
    message: 'From and to units must differ',
    path: ['toUom'],
  });
export type UpsertUomConversionRequest = z.infer<typeof upsertUomConversionRequest>;

export const createLocationRequest = z.object({
  code: codeString(40),
  name: shortText(150),
  kind: locationKind,
  storageLevel: storageLevel.nullish(),
  parentId: uuid.nullish(),
  jobWorkerId: uuid.nullish(),
  blocksIssue: z.boolean().default(false),
  status: recordStatus.default('ACTIVE'),
});
export type CreateLocationRequest = z.infer<typeof createLocationRequest>;

export const updateLocationRequest = createLocationRequest.partial().omit({ kind: true });

export const createSupplierRequest = z.object({
  supplierCode: codeString(40),
  name: shortText(200),
  contactPerson: z.string().trim().max(150).nullish(),
  email: z.string().trim().email().max(255).nullish().or(z.literal('')),
  phone: z.string().trim().max(40).nullish(),
  addressLine1: z.string().trim().max(200).nullish(),
  addressLine2: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(100).nullish(),
  state: z.string().trim().max(100).nullish(),
  pincode: z.string().trim().max(20).nullish(),
  gstin: z.string().trim().max(20).nullish(),
  paymentTerms: z.string().trim().max(100).nullish(),
  leadTimeDays: z.coerce.number().int().min(0).max(365).default(0),
  rating: z.coerce.number().int().min(1).max(5).nullish(),
  status: recordStatus.default('ACTIVE'),
  notes: optionalText(2000),
});
export type CreateSupplierRequest = z.infer<typeof createSupplierRequest>;

export const updateSupplierRequest = createSupplierRequest.partial();

export const createFabricRollRequest = z.object({
  rawMaterialId: uuid,
  materialLotId: uuid,
  locationId: uuid,
  supplierId: uuid.nullish(),
  shade: z.string().trim().max(80).nullish(),
  color: z.string().trim().max(80).nullish(),
  width: decimalString().nullish(),
  widthUom: z.string().trim().max(20).nullish(),
  gsm: z.coerce.number().int().min(0).max(5000).nullish(),
  originalLength: decimalString().refine((v) => Number(v) > 0, 'Length must be greater than zero'),
  lengthUom: uomCode.default('METER'),
  purchaseRate: decimalString().nullish(),
  receiptLineId: uuid.nullish(),
});
export type CreateFabricRollRequest = z.infer<typeof createFabricRollRequest>;

export const rollListQuery = paginationQuery.extend({
  rawMaterialId: uuid.optional(),
  materialLotId: uuid.optional(),
  locationId: uuid.optional(),
  shade: z.string().trim().max(80).optional(),
  status: z
    .enum(['RECEIVED', 'QC_PENDING', 'AVAILABLE', 'PARTIALLY_ISSUED', 'ISSUED', 'EXHAUSTED', 'BLOCKED', 'RETURNED_TO_SUPPLIER'])
    .optional(),
  minimumWidth: decimalString().optional(),
});

export const uomConversionPreviewQuery = z.object({
  rawMaterialId: uuid.optional(),
  fromUom: uomCode,
  toUom: uomCode,
  quantity: decimalString(),
});

export const wastagePercent = percentString;
