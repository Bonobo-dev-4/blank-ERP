import type { DispatchDateFinding, DispatchDateSource } from './dispatch-date';
import type { OrderPriority, PrioritySource } from './order-priority';

export interface CrmCurrent {
  readonly expectedDispatchDate: string | null;
  readonly dispatchDateSource: DispatchDateSource;
  readonly dispatchDateLocked: boolean;
  readonly orderPriority: OrderPriority;
  readonly prioritySource: PrioritySource | string;
}

export interface CrmChange {
  readonly field: 'EXPECTED_DISPATCH_DATE' | 'PRIORITY';
  readonly previousValue: string | null;
  readonly newValue: string | null;
  readonly source: string;
}

export interface CrmSyncPlan {
  /** Always stored: what Shopify says now, beside whatever is effective. */
  readonly shopify: {
    readonly date: string | null; readonly source: DispatchDateSource | null;
    readonly text: string | null; readonly issue: string | null;
  };
  /** Present only when the effective dispatch date changes. */
  readonly dispatch?: { readonly date: string | null; readonly source: DispatchDateSource; readonly text: string | null };
  /** Present only when the effective priority changes. */
  readonly priority?: { readonly value: OrderPriority; readonly source: PrioritySource };
  readonly changes: readonly CrmChange[];
}

/**
 * What a Shopify import may change on an order's CRM fields.
 *
 * Anything the CRM set is untouchable: a locked dispatch date and a manual
 * priority survive every sync, and Shopify's reading is only recorded beside
 * them, where a disagreement shows. Otherwise Shopify's current reading
 * becomes the effective value — including going back to unassigned when the
 * note no longer names a date, so a stale note-date cannot linger.
 */
export function planShopifyCrmSync(
  current: CrmCurrent | null,
  finding: DispatchDateFinding,
  shopify: { readonly priority: OrderPriority; readonly source: 'SHOPIFY_TAG' | 'SHOPIFY_METAFIELD' } | null,
): CrmSyncPlan {
  const changes: CrmChange[] = [];
  const plan: { -readonly [K in keyof CrmSyncPlan]: CrmSyncPlan[K] } = {
    shopify: { date: finding.date, source: finding.source, text: finding.text, issue: finding.issue },
    changes,
  };

  if (!current?.dispatchDateLocked) {
    const date = finding.date;
    const source: DispatchDateSource = date && finding.source ? finding.source : 'UNASSIGNED';
    const before = current?.expectedDispatchDate ?? null;
    if (before !== date || (current && current.dispatchDateSource !== source && date !== null)) {
      plan.dispatch = { date, source, text: date ? finding.text : null };
      if (before !== date) {
        changes.push({ field: 'EXPECTED_DISPATCH_DATE', previousValue: before, newValue: date, source });
      }
    }
  }

  if (current?.prioritySource !== 'CRM_MANUAL') {
    const value: OrderPriority = shopify?.priority ?? 'NORMAL';
    const source: PrioritySource = shopify?.source ?? 'DEFAULT';
    const before = current?.orderPriority ?? 'NORMAL';
    if (before !== value || (current?.prioritySource ?? 'DEFAULT') !== source) {
      plan.priority = { value, source };
      if (before !== value) changes.push({ field: 'PRIORITY', previousValue: before, newValue: value, source });
    }
  }

  return plan;
}
