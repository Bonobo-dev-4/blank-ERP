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
  pageSize: z.coerce.number().int().min(1).max(250).default(50),
  maxPages: z.coerce.number().int().min(1).max(100).default(10),
});
export type ImportShopifyOrdersRequest = z.infer<typeof importShopifyOrdersRequest>;

export const shopifyOrderListQuery = paginationQuery.extend({
  channel: demandChannel.optional(),
  status: externalOrderStatus.optional(),
});
