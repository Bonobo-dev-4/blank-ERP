/**
 * CRM order priority.
 *
 * One ranking for now, as the business asked: VIP, then High, Medium, Normal.
 * VIP is really a customer classification and High an urgency, so they may
 * become two fields later — everything that ranks goes through `priorityRank`
 * so that split stays a local change.
 */

export const ORDER_PRIORITIES = ['VIP', 'HIGH', 'MEDIUM', 'NORMAL'] as const;
export type OrderPriority = (typeof ORDER_PRIORITIES)[number];

export const ORDER_PRIORITY_LABELS: Readonly<Record<OrderPriority, string>> = {
  VIP: 'VIP Order', HIGH: 'High Priority', MEDIUM: 'Medium Priority', NORMAL: 'Normal Priority',
};

export const PRIORITY_SOURCES = ['CRM_MANUAL', 'SHOPIFY_TAG', 'SHOPIFY_METAFIELD', 'DEFAULT'] as const;
export type PrioritySource = (typeof PRIORITY_SOURCES)[number];

export function priorityRank(p: OrderPriority): number {
  return ORDER_PRIORITIES.indexOf(p) + 1;
}

/** The more urgent of two priorities. */
export function higherPriority(a: OrderPriority, b: OrderPriority): OrderPriority {
  return priorityRank(a) <= priorityRank(b) ? a : b;
}

export function isOrderPriority(v: unknown): v is OrderPriority {
  return typeof v === 'string' && (ORDER_PRIORITIES as readonly string[]).includes(v);
}

/**
 * Read an approved tag map, "tag:PRIORITY" pairs separated by commas —
 * e.g. `VIP:VIP, express-shipping:HIGH`. Unknown priorities are dropped, so a
 * typo maps nothing rather than something wrong. Tags compare case-blind.
 */
export function parsePriorityTagMap(config: string | null | undefined): ReadonlyMap<string, OrderPriority> {
  const map = new Map<string, OrderPriority>();
  for (const pair of (config ?? '').split(',')) {
    const i = pair.lastIndexOf(':');
    if (i <= 0) continue;
    const tag = pair.slice(0, i).trim().toLowerCase();
    const p = pair.slice(i + 1).trim().toUpperCase();
    if (tag && isOrderPriority(p)) map.set(tag, p);
  }
  return map;
}

/**
 * Priority from Shopify, only through approved tags or an approved metafield.
 * Never from names, notes or anything inferred. Null means Shopify says nothing.
 */
export function shopifyPriority(input: {
  readonly tags: readonly string[];
  readonly tagMap: ReadonlyMap<string, OrderPriority>;
  readonly metafieldValue?: string | null;
}): { priority: OrderPriority; source: 'SHOPIFY_TAG' | 'SHOPIFY_METAFIELD' } | null {
  const fromField = input.metafieldValue?.trim().toUpperCase().replace(/\s+PRIORITY$|\s+ORDER$/, '');
  if (fromField && isOrderPriority(fromField)) return { priority: fromField, source: 'SHOPIFY_METAFIELD' };
  let best: OrderPriority | null = null;
  for (const tag of input.tags) {
    const p = input.tagMap.get(tag.trim().toLowerCase());
    if (p) best = best ? higherPriority(best, p) : p;
  }
  return best ? { priority: best, source: 'SHOPIFY_TAG' } : null;
}
