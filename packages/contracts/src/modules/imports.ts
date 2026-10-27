import { z } from 'zod';
import {
  idempotencyKey, LOCATION_KINDS, MATERIAL_CATEGORIES, PRODUCT_STATUSES, PRODUCTION_TYPES,
  RECORD_STATUSES, STORAGE_LEVELS, UOM_CODES,
} from '../common';
import { EXTERNAL_PROVIDERS } from './products';

/**
 * CSV import — one definition per importable record type.
 *
 * Read by the API (to validate and to build templates) and by the screens
 * (to describe columns), so the template, the rules and the dialog can never
 * disagree. Imports go through the same services as the screens: the same
 * validation, numbering, permissions and audit. Stock goes through the
 * ledger's adjustment, never into balances directly.
 */

export const IMPORT_TYPES = [
  'raw-materials', 'suppliers', 'locations', 'products', 'product-mappings', 'stock-adjustments',
] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];
export const importType = z.enum(IMPORT_TYPES);

/** 'always' = needed on every row; 'create' = needed only when the row creates a record. */
export type ImportRequirement = 'always' | 'create' | 'optional';

export interface ImportColumn {
  readonly key: string;
  readonly label: string;
  readonly required: ImportRequirement;
  readonly hint: string;
  readonly values?: readonly string[];
}

export interface ImportSpec {
  readonly type: ImportType;
  readonly label: string;
  readonly description: string;
  /** The permission the matching screen requires to create or edit. */
  readonly permission: string;
  /** upsert: create new, update existing by key. append: every row is a new event. */
  readonly mode: 'upsert' | 'append';
  readonly keyColumns: readonly string[];
  readonly columns: readonly ImportColumn[];
  /** What "Download current data" exports, in words. */
  readonly exportNote: string;
}

const BOOL = ['true', 'false'] as const;

export const IMPORT_SPECS: Record<ImportType, ImportSpec> = {
  'raw-materials': {
    type: 'raw-materials',
    label: 'Raw materials',
    description: 'Create new materials and update existing ones, matched by material code.',
    permission: 'materials.write',
    mode: 'upsert',
    keyColumns: ['materialCode'],
    exportNote: 'Every raw material, ready to edit and re-import.',
    columns: [
      { key: 'materialCode', label: 'Material code', required: 'always', hint: 'Unique code, e.g. FAB-CHN-01. Matches an existing material to update it.' },
      { key: 'name', label: 'Name', required: 'create', hint: 'Material name.' },
      { key: 'category', label: 'Category', required: 'create', hint: 'Material category.', values: MATERIAL_CATEGORIES },
      { key: 'baseUom', label: 'Base unit', required: 'create', hint: 'Unit stock is counted in.', values: UOM_CODES },
      { key: 'purchaseUom', label: 'Purchase unit', required: 'optional', hint: 'Unit it is bought in, if different.', values: UOM_CODES },
      { key: 'description', label: 'Description', required: 'optional', hint: 'Free text.' },
      { key: 'color', label: 'Colour', required: 'optional', hint: 'Colour name.' },
      { key: 'colorCode', label: 'Colour code', required: 'optional', hint: 'Shade or Pantone code.' },
      { key: 'fabricComposition', label: 'Fabric composition', required: 'optional', hint: 'e.g. 100% cotton.' },
      { key: 'width', label: 'Width', required: 'optional', hint: 'Fabric width, a number.' },
      { key: 'widthUom', label: 'Width unit', required: 'optional', hint: 'e.g. inch, cm.' },
      { key: 'gsm', label: 'GSM', required: 'optional', hint: 'Whole number.' },
      { key: 'defaultSupplierCode', label: 'Default supplier code', required: 'optional', hint: 'Code of an existing supplier.' },
      { key: 'purchaseRate', label: 'Purchase rate', required: 'optional', hint: 'Price per purchase unit, a number.' },
      { key: 'minimumStock', label: 'Minimum stock', required: 'optional', hint: 'In the base unit.' },
      { key: 'reorderLevel', label: 'Reorder level', required: 'optional', hint: 'In the base unit.' },
      { key: 'reorderQty', label: 'Reorder quantity', required: 'optional', hint: 'In the base unit.' },
      { key: 'leadTimeDays', label: 'Lead time (days)', required: 'optional', hint: 'Whole days, 0–365.' },
      { key: 'defaultLocationCode', label: 'Default location code', required: 'optional', hint: 'Code of an existing location.' },
      { key: 'lotTracked', label: 'Lot tracked', required: 'optional', hint: 'true or false.', values: BOOL },
      { key: 'shadeTracked', label: 'Shade tracked', required: 'optional', hint: 'true or false.', values: BOOL },
      { key: 'status', label: 'Status', required: 'optional', hint: 'Defaults to ACTIVE on create.', values: RECORD_STATUSES },
    ],
  },
  suppliers: {
    type: 'suppliers',
    label: 'Suppliers',
    description: 'Create new suppliers and update existing ones, matched by supplier code.',
    permission: 'purchasing.manage_suppliers',
    mode: 'upsert',
    keyColumns: ['supplierCode'],
    exportNote: 'Every supplier, ready to edit and re-import.',
    columns: [
      { key: 'supplierCode', label: 'Supplier code', required: 'always', hint: 'Unique code. Matches an existing supplier to update it.' },
      { key: 'name', label: 'Name', required: 'create', hint: 'Supplier name.' },
      { key: 'contactPerson', label: 'Contact person', required: 'optional', hint: '' },
      { key: 'email', label: 'Email', required: 'optional', hint: '' },
      { key: 'phone', label: 'Phone', required: 'optional', hint: '' },
      { key: 'addressLine1', label: 'Address line 1', required: 'optional', hint: '' },
      { key: 'addressLine2', label: 'Address line 2', required: 'optional', hint: '' },
      { key: 'city', label: 'City', required: 'optional', hint: '' },
      { key: 'state', label: 'State', required: 'optional', hint: '' },
      { key: 'pincode', label: 'Pincode', required: 'optional', hint: '' },
      { key: 'gstin', label: 'GSTIN', required: 'optional', hint: '' },
      { key: 'paymentTerms', label: 'Payment terms', required: 'optional', hint: 'e.g. 30 days.' },
      { key: 'leadTimeDays', label: 'Lead time (days)', required: 'optional', hint: 'Whole days, 0–365.' },
      { key: 'rating', label: 'Rating', required: 'optional', hint: '1 to 5.' },
      { key: 'status', label: 'Status', required: 'optional', hint: 'Defaults to ACTIVE on create.', values: RECORD_STATUSES },
      { key: 'notes', label: 'Notes', required: 'optional', hint: '' },
    ],
  },
  locations: {
    type: 'locations',
    label: 'Stock locations',
    description: 'Create and update warehouses, rooms, racks, bins and departments, matched by location code.',
    permission: 'admin.manage_locations',
    mode: 'upsert',
    keyColumns: ['code'],
    exportNote: 'Every location you manage (system locations are not included).',
    columns: [
      { key: 'code', label: 'Location code', required: 'always', hint: 'Unique code. Matches an existing location to update it.' },
      { key: 'name', label: 'Name', required: 'create', hint: '' },
      { key: 'kind', label: 'Kind', required: 'create', hint: 'Cannot be changed once created.', values: LOCATION_KINDS.filter((k) => k !== 'SINK' && k !== 'COUNTERPARTY') },
      { key: 'storageLevel', label: 'Storage level', required: 'optional', hint: '', values: STORAGE_LEVELS },
      { key: 'parentCode', label: 'Parent location code', required: 'optional', hint: 'Code of the location this one sits inside. Parents listed earlier in the same file count.' },
      { key: 'blocksIssue', label: 'Blocks issue', required: 'optional', hint: 'true if stock here must not be issued.', values: BOOL },
      { key: 'status', label: 'Status', required: 'optional', hint: '', values: RECORD_STATUSES },
    ],
  },
  products: {
    type: 'products',
    label: 'Products (styles)',
    description: 'Update ERP details on existing styles — or add styles that are not on Shopify — matched by style code.',
    permission: 'products.write',
    mode: 'upsert',
    keyColumns: ['styleCode'],
    exportNote: 'Every style with its ERP-owned fields.',
    columns: [
      { key: 'styleCode', label: 'Style code', required: 'always', hint: 'Matches an existing style to update it.' },
      { key: 'name', label: 'Name', required: 'create', hint: '' },
      { key: 'collection', label: 'Collection', required: 'optional', hint: '' },
      { key: 'category', label: 'Category', required: 'optional', hint: '' },
      { key: 'sizeSet', label: 'Size set', required: 'optional', hint: '' },
      { key: 'fabricDescription', label: 'Fabric description', required: 'optional', hint: '' },
      { key: 'productionType', label: 'Production type', required: 'optional', hint: '', values: PRODUCTION_TYPES },
      { key: 'standardManufacturingDays', label: 'Standard manufacturing days', required: 'optional', hint: 'Whole days.' },
      { key: 'status', label: 'Status', required: 'optional', hint: '', values: PRODUCT_STATUSES },
      { key: 'notes', label: 'Notes', required: 'optional', hint: '' },
    ],
  },
  'product-mappings': {
    type: 'product-mappings',
    label: 'Product mappings',
    description: 'Link Shopify or Unicommerce SKUs to ERP product variants, matched by provider, identifier kind and external id.',
    permission: 'products.manage_mappings',
    mode: 'upsert',
    keyColumns: ['provider', 'identifierKind', 'externalId'],
    exportNote: 'The work list: SKUs on imported orders that no ERP variant is linked to yet. Fill in the ERP SKU column and import.',
    columns: [
      { key: 'provider', label: 'Provider', required: 'always', hint: '', values: EXTERNAL_PROVIDERS },
      { key: 'identifierKind', label: 'Identifier kind', required: 'always', hint: 'Shopify: VARIANT_SKU, VARIANT_GID, PRODUCT_GID, INVENTORY_ITEM_GID. Unicommerce: ITEM_SKU_CODE, ITEM_TYPE_ID.' },
      { key: 'externalId', label: 'External id', required: 'always', hint: 'The SKU or id in that system.' },
      { key: 'externalSku', label: 'External SKU', required: 'optional', hint: 'The SKU as that system shows it.' },
      { key: 'variantSku', label: 'ERP variant SKU', required: 'always', hint: 'SKU of the ERP product variant to link to.' },
      { key: 'isPrimary', label: 'Primary', required: 'optional', hint: 'true to make this the primary link for the provider.', values: BOOL },
    ],
  },
  'stock-adjustments': {
    type: 'stock-adjustments',
    label: 'Stock adjustments',
    description: 'Authorised corrections posted through the stock ledger, one adjustment per row. Each row needs a reason.',
    permission: 'inventory.adjust',
    mode: 'append',
    keyColumns: [],
    exportNote: 'A blank template — adjustments are events, so there is nothing to export for editing.',
    columns: [
      { key: 'materialCode', label: 'Material code', required: 'always', hint: 'Existing raw material.' },
      { key: 'lotCode', label: 'Lot code', required: 'always', hint: 'Existing lot of that material.' },
      { key: 'locationCode', label: 'Location code', required: 'always', hint: 'Where the stock is.' },
      { key: 'adjustmentQty', label: 'Adjustment quantity', required: 'always', hint: 'Signed: positive adds stock, negative removes it.' },
      { key: 'uom', label: 'Unit', required: 'always', hint: '', values: UOM_CODES },
      { key: 'reason', label: 'Reason', required: 'always', hint: 'Why the stock is being corrected.' },
      { key: 'remarks', label: 'Remarks', required: 'optional', hint: '' },
    ],
  },
};

/** One import is at most this many rows; split larger files. */
export const MAX_IMPORT_ROWS = 2000;

/** Rows arrive already parsed from CSV: header → cell text. */
export const importRowsRequest = z.object({
  rows: z.array(z.record(z.string().max(120), z.string().max(4000))).min(1).max(MAX_IMPORT_ROWS),
});
export const importCommitRequest = importRowsRequest.extend({ idempotencyKey });
export type ImportRowsRequest = z.infer<typeof importRowsRequest>;
export type ImportCommitRequest = z.infer<typeof importCommitRequest>;

export type ImportAction = 'create' | 'update' | 'unchanged' | 'adjust' | 'error';

export interface ImportRowResult {
  /** 1-based, counting the header as row 1 — the number a spreadsheet shows. */
  readonly row: number;
  readonly key: string;
  readonly action: ImportAction;
  readonly errors: readonly string[];
  readonly changes: readonly string[];
  /** Set on commit: what actually happened to this row. */
  readonly outcome?: 'created' | 'updated' | 'unchanged' | 'adjusted' | 'failed';
  readonly message?: string;
}

export interface ImportResult {
  readonly type: ImportType;
  readonly committed: boolean;
  readonly unknownColumns: readonly string[];
  readonly missingColumns: readonly string[];
  readonly counts: Readonly<Record<ImportAction, number>>;
  readonly rows: readonly ImportRowResult[];
}

/** Header matching: case, spaces, underscores and punctuation do not matter. */
export const normaliseHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');
