import { z } from 'zod';
import {
  codeString, decimalString, optionalText, paginationQuery, productStatus,
  productionType, shortText, uuid,
} from '../common';

export const createProductRequest = z.object({
  styleCode: codeString(50),
  name: shortText(200),
  collection: z.string().trim().max(100).nullish(),
  category: z.string().trim().max(100).nullish(),
  sizeSet: z.string().trim().max(100).nullish(),
  fabricDescription: optionalText(500),
  productionType: productionType.default('IN_HOUSE'),
  standardManufacturingDays: z.coerce.number().int().min(0).max(365).nullish(),
  defaultRouteId: uuid.nullish(),
  status: productStatus.default('DRAFT'),
  imageUrl: z.string().trim().url().max(1000).nullish(),
  notes: optionalText(2000),
});
export type CreateProductRequest = z.infer<typeof createProductRequest>;

export const updateProductRequest = createProductRequest.partial();

export const createVariantRequest = z.object({
  productId: uuid,
  sku: codeString(80),
  barcode: z.string().trim().max(80).nullish(),
  name: z.string().trim().max(200).nullish(),
  color: z.string().trim().max(80).nullish(),
  size: z.string().trim().max(40).nullish(),
  sizeSortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  fabric: z.string().trim().max(200).nullish(),
  sizeSet: z.string().trim().max(100).nullish(),
  isBundle: z.boolean().default(false),
  imageUrl: z.string().trim().url().max(1000).nullish(),
  status: productStatus.default('DRAFT'),
});
export type CreateVariantRequest = z.infer<typeof createVariantRequest>;

export const updateVariantRequest = createVariantRequest.partial().omit({ productId: true });

/**
 * Generate the full colour x size matrix for a style in one call. This is how
 * a 6-size, 4-colour style gets its 24 SKUs without 24 form submissions.
 */
export const generateVariantMatrixRequest = z.object({
  productId: uuid,
  colors: z.array(shortText(80)).min(1).max(40),
  sizes: z.array(shortText(40)).min(1).max(40),
  /** SKU pattern; {STYLE}, {COLOR}, {SIZE} are substituted. */
  skuPattern: z.string().trim().min(3).max(120).default('{STYLE}-{COLOR}-{SIZE}'),
  status: productStatus.default('DRAFT'),
});
export type GenerateVariantMatrixRequest = z.infer<typeof generateVariantMatrixRequest>;

export const EXTERNAL_PROVIDERS = ['SHOPIFY', 'UNICOMMERCE'] as const;
export const externalProvider = z.enum(EXTERNAL_PROVIDERS);

export const upsertExternalMappingRequest = z.object({
  productVariantId: uuid,
  provider: externalProvider,
  /** SHOPIFY: PRODUCT_GID | VARIANT_GID | VARIANT_SKU | INVENTORY_ITEM_GID
   *  UNICOMMERCE: ITEM_SKU_CODE | ITEM_TYPE_ID */
  identifierKind: z.string().trim().min(2).max(60),
  externalId: z.string().trim().min(1).max(300),
  externalSku: z.string().trim().max(200).nullish(),
  isPrimary: z.boolean().default(false),
});
export type UpsertExternalMappingRequest = z.infer<typeof upsertExternalMappingRequest>;

export const bundleComponentRequest = z.object({
  bundleVariantId: uuid,
  components: z
    .array(
      z.object({
        componentVariantId: uuid,
        qtyPerBundle: decimalString().refine((v) => Number(v) > 0, 'Must be greater than zero'),
        role: z.enum(['PRIMARY', 'COMPONENT', 'ACCESSORY']).default('COMPONENT'),
        requiresManufacturing: z.boolean().default(true),
      }),
    )
    .min(1)
    .max(20),
});
export type BundleComponentRequest = z.infer<typeof bundleComponentRequest>;

export const productListQuery = paginationQuery.extend({
  status: productStatus.optional(),
  collection: z.string().trim().max(100).optional(),
  category: z.string().trim().max(100).optional(),
});

export const variantListQuery = paginationQuery.extend({
  productId: uuid.optional(),
  status: productStatus.optional(),
  unmappedProvider: externalProvider.optional(),
  isBundle: z.coerce.boolean().optional(),
});
