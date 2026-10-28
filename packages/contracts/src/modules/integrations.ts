import { z } from 'zod';
import { paginationQuery } from '../common';

export const DEMAND_CHANNELS = [
  'ONLINE', 'POS', 'CUSTOM', 'BULK_PO', 'REPLENISHMENT', 'MANUAL',
] as const;
export const demandChannel = z.enum(DEMAND_CHANNELS);

export const EXTERNAL_ORDER_STATUSES = [
  'OPEN', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED', 'CLOSED', 'ON_HOLD',
] as const;
export const externalOrderStatus = z.enum(EXTERNAL_ORDER_STATUSES);

/**
 * Import Shopify orders.
 *
 * Omitting `since` resumes from the newest `externalUpdatedAt` already stored,
 * which is what makes repeated runs cheap and safe. `maxPages` bounds a single
 * run so a first import of a large store does not block a request for minutes.
 */
export const importShopifyOrdersRequest = z.object({
  since: z.string().datetime({ offset: true }).nullish(),
  // 100 orders with full detail stays under Shopify's 1,000-point query ceiling.
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  maxPages: z.coerce.number().int().min(1).max(100).default(10),
});
export type ImportShopifyOrdersRequest = z.infer<typeof importShopifyOrdersRequest>;

export const refreshShopifyOrderDetailsRequest = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(250),
});

/** Columns the order list can be sorted by — a whitelist, never a raw field. */
export const ORDER_SORT_KEYS = [
  'orderPriority', 'expectedDispatchDate', 'orderedAt', 'orderName', 'customerRef', 'totalAmount', 'status',
] as const;

export const ORDER_PRIORITY_VALUES = ['VIP', 'HIGH', 'MEDIUM', 'NORMAL'] as const;
export const DISPATCH_PRESET_VALUES = [
  'TODAY', 'TOMORROW', 'NEXT_3_DAYS', 'NEXT_7_DAYS', 'THIS_WEEK', 'THIS_MONTH', 'OVERDUE', 'NONE', 'CUSTOM',
] as const;

const flag = z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true'));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional();

export const shopifyOrderListQuery = paginationQuery.extend({
  channel: demandChannel.optional(),
  status: externalOrderStatus.optional(),
  /** Unicommerce shipping status as last synced, e.g. PROCESSING, COMPLETE. */
  shipmentStatus: z.string().trim().max(64).optional(),
  /** POS store name, exactly as recorded on the order. */
  location: z.string().trim().max(200).optional(),
  /** Placed on or after / on or before, inclusive, as calendar dates. */
  from: isoDate,
  to: isoDate,
  customised: flag,
  unmapped: flag,
  /** CRM priority, exactly. */
  priority: z.enum(ORDER_PRIORITY_VALUES).optional(),
  /** Expected dispatch date, by preset in Asia/Kolkata; CUSTOM uses the range. */
  dispatch: z.enum(DISPATCH_PRESET_VALUES).optional(),
  dispatchFrom: isoDate,
  dispatchTo: isoDate,
  /** Unset means the CRM default: priority first, then earliest dispatch. */
  sortBy: z.enum(ORDER_SORT_KEYS).optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const setDispatchDateRequest = z.object({
  /** null clears the date. */
  date: ymd.nullable(),
  /** Required when a date that is already set is changed or cleared. */
  reason: z.string().trim().max(500).optional(),
});
export type SetDispatchDateRequest = z.infer<typeof setDispatchDateRequest>;

export const useShopifyDispatchDateRequest = z.object({
  reason: z.string().trim().min(3, 'Say why').max(500),
});

export const setOrderPriorityRequest = z.object({
  priority: z.enum(ORDER_PRIORITY_VALUES),
  reason: z.string().trim().max(500).optional(),
});
export type SetOrderPriorityRequest = z.infer<typeof setOrderPriorityRequest>;

export const setCrmRemarksRequest = z.object({
  remarks: z.string().trim().max(2000).nullable(),
});

/** Turning a connection's external writes on or off is deliberate and explained. */
export const integrationWriteAccessRequest = z.object({
  allow: z.boolean(),
  reason: z.string().trim().min(5, 'Say why, in a few words').max(500),
});
export type IntegrationWriteAccessRequest = z.infer<typeof integrationWriteAccessRequest>;
