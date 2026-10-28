'use client';

import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/components/app/auth-context';
import { SwitchFacilityButton } from '@/components/app/switch-facility';
import { DispatchDateCell, PRIORITIES, PriorityPicker, type DispatchState, type OrderPriority } from '@/components/app/order-crm';
import { fmtDateTime, fmtMoneyCompact, fmtQty, humanise } from '@/lib/utils';
import {
  Badge, Button, Card, EmptyState, ErrorPanel, LoadingBlock, PageHeader, Stat, StatusBadge,
} from '@/components/ui/primitives';
import { FilterBar, SortTh, nextSort, type SortState } from '@/components/ui/table-controls';

interface Line {
  id: string; externalSku: string | null; title: string | null; productVariantId: string | null;
  orderedQty: string; cancelledQty: string; fulfilledQty: string;
  manufacturingQty: string; availabilityStatus: string;
}
interface Order {
  id: string; orderNumber: string; orderName: string | null; channel: string;
  externalShipmentStatus: string | null;
  channelBasis: string | null; isCustomised: boolean;
  posLocationName: string | null; orderedAt: string; status: string;
  financialStatus: string | null; fulfillmentStatus: string | null;
  currency: string | null; totalAmount: string | null; customerRef: string | null;
  /** Present only for a reader allowed to see customer details. */
  shippingCity?: string | null; shippingZip?: string | null;
  tags: string[]; cancelledAt: string | null;
  lines: Line[]; demandQty: string; unmappedLineCount: number;
  orderPriority: OrderPriority; expectedDispatchDate: string | null; dispatchState: DispatchState;
  dispatchDateSource: string; shopifyDispatchIssue: string | null; hasCrmRemarks: boolean;
}
interface Page { data: Order[]; page: number; pageSize: number; total: number; totalPages: number }
interface Facet { value: string; count: number }
interface Facets {
  statuses: Facet[]; shipmentStatuses: Facet[]; locations: Facet[]; channels: Facet[];
  priorities: Facet[];
  dispatch: { today: number; tomorrow: number; next7Days: number; overdue: number; none: number };
}

const DISPATCH_OPTIONS: { value: string; label: string }[] = [
  { value: 'TODAY', label: 'Today' },
  { value: 'TOMORROW', label: 'Tomorrow' },
  { value: 'NEXT_3_DAYS', label: 'Next 3 days' },
  { value: 'NEXT_7_DAYS', label: 'Next 7 days' },
  { value: 'THIS_WEEK', label: 'This week' },
  { value: 'THIS_MONTH', label: 'This month' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'NONE', label: 'No dispatch date' },
  { value: 'CUSTOM', label: 'Custom range…' },
];

/** Everything the list can be narrowed or ordered by — mirrored in the URL. */
interface ListParams {
  q: string; status: string; ship: string; channel: string; loc: string;
  from: string; to: string; bespoke: boolean; unmapped: boolean;
  prio: string; disp: string; dfrom: string; dto: string;
  /** Empty means the CRM default: priority, then earliest dispatch, then newest. */
  sort: string; dir: 'asc' | 'desc'; page: number; size: number;
}

const DEFAULTS: ListParams = {
  q: '', status: '', ship: '', channel: '', loc: '', from: '', to: '',
  bespoke: false, unmapped: false, prio: '', disp: '', dfrom: '', dto: '',
  sort: '', dir: 'desc', page: 1, size: 25,
};

/** One-click views the CRM team uses most. */
const SAVED_VIEWS: { key: string; label: string; patch: Partial<ListParams>; count?: (f: Facets) => number | undefined }[] = [
  { key: 'vip', label: 'VIP Orders', patch: { prio: 'VIP', disp: '' }, count: (f) => f.priorities.find((x) => x.value === 'VIP')?.count ?? 0 },
  { key: 'high', label: 'High Priority', patch: { prio: 'HIGH', disp: '' }, count: (f) => f.priorities.find((x) => x.value === 'HIGH')?.count ?? 0 },
  { key: 'medium', label: 'Medium Priority', patch: { prio: 'MEDIUM', disp: '' }, count: (f) => f.priorities.find((x) => x.value === 'MEDIUM')?.count ?? 0 },
  { key: 'today', label: 'Dispatch Today', patch: { disp: 'TODAY', prio: '' }, count: (f) => f.dispatch.today },
  { key: 'overdue', label: 'Dispatch Overdue', patch: { disp: 'OVERDUE', prio: '' }, count: (f) => f.dispatch.overdue },
  { key: 'upcoming', label: 'Upcoming Dispatch', patch: { disp: 'NEXT_7_DAYS', prio: '' }, count: (f) => f.dispatch.next7Days },
];

function readUrl(): ListParams {
  if (typeof window === 'undefined') return DEFAULTS;
  const sp = new URLSearchParams(window.location.search);
  const num = (k: string, d: number) => {
    const n = Number(sp.get(k));
    return Number.isInteger(n) && n > 0 ? n : d;
  };
  return {
    q: sp.get('q') ?? '',
    status: sp.get('status') ?? '',
    ship: sp.get('ship') ?? '',
    channel: sp.get('channel') ?? '',
    loc: sp.get('loc') ?? '',
    from: sp.get('from') ?? '',
    to: sp.get('to') ?? '',
    bespoke: sp.get('bespoke') === '1',
    unmapped: sp.get('unmapped') === '1',
    prio: sp.get('prio') ?? '',
    disp: sp.get('disp') ?? '',
    dfrom: sp.get('dfrom') ?? '',
    dto: sp.get('dto') ?? '',
    sort: sp.get('sort') ?? DEFAULTS.sort,
    dir: sp.get('dir') === 'asc' ? 'asc' : 'desc',
    page: num('page', 1),
    size: [25, 50, 100].includes(num('size', 25)) ? num('size', 25) : 25,
  };
}

/** Keep the address bar in step, so a filtered view survives refresh and can be shared. */
function writeUrl(p: ListParams) {
  const sp = new URLSearchParams();
  if (p.q) sp.set('q', p.q);
  if (p.status) sp.set('status', p.status);
  if (p.ship) sp.set('ship', p.ship);
  if (p.channel) sp.set('channel', p.channel);
  if (p.loc) sp.set('loc', p.loc);
  if (p.from) sp.set('from', p.from);
  if (p.to) sp.set('to', p.to);
  if (p.bespoke) sp.set('bespoke', '1');
  if (p.unmapped) sp.set('unmapped', '1');
  if (p.prio) sp.set('prio', p.prio);
  if (p.disp) sp.set('disp', p.disp);
  if (p.disp === 'CUSTOM' && p.dfrom) sp.set('dfrom', p.dfrom);
  if (p.disp === 'CUSTOM' && p.dto) sp.set('dto', p.dto);
  if (p.sort !== DEFAULTS.sort || p.dir !== DEFAULTS.dir) { sp.set('sort', p.sort); sp.set('dir', p.dir); }
  if (p.page > 1) sp.set('page', String(p.page));
  if (p.size !== DEFAULTS.size) sp.set('size', String(p.size));
  const s = sp.toString();
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${s ? `?${s}` : ''}`);
}

const shipLabel = (v: string) => (v === 'NONE' ? 'Not synced yet' : humanise(v));

/**
 * Imported external orders.
 *
 * One component behind All / Shopify / POS, filtered by channel, so the three
 * routes cannot drift into disagreeing about the same order. Filtering and
 * sorting happen on the server — there are thousands of orders, and sorting
 * only the page on screen would answer the wrong question.
 */
export function OrderList({
  title, description, channel,
}: {
  title: string; description: string; channel?: 'ONLINE' | 'POS' | 'CUSTOM';
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const canSeeCustomer = useAuth().can('demand.view_customer');
  const [p, setP] = React.useState<ListParams>(readUrl);
  const [searchDraft, setSearchDraft] = React.useState(p.q);

  // Any change except paging returns to page one.
  const update = (patch: Partial<ListParams>) =>
    setP((cur) => ({ ...cur, ...patch, page: 'page' in patch ? patch.page! : 1 }));

  React.useEffect(() => { writeUrl(p); }, [p]);

  // Search is debounced; typing should not fire a request per keystroke.
  React.useEffect(() => {
    if (searchDraft === p.q) return;
    const t = window.setTimeout(() => update({ q: searchDraft.trim() }), 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  const effectiveChannel = channel ?? (p.channel || undefined);
  const query = {
    page: p.page,
    pageSize: p.size,
    channel: effectiveChannel,
    search: p.q || undefined,
    status: p.status || undefined,
    shipmentStatus: p.ship || undefined,
    location: p.loc || undefined,
    from: p.from || undefined,
    to: p.to || undefined,
    customised: p.bespoke ? 'true' : undefined,
    unmapped: p.unmapped ? 'true' : undefined,
    priority: p.prio || undefined,
    dispatch: p.disp || undefined,
    dispatchFrom: p.disp === 'CUSTOM' ? p.dfrom || undefined : undefined,
    dispatchTo: p.disp === 'CUSTOM' ? p.dto || undefined : undefined,
    sortBy: p.sort || undefined,
    sortDir: p.dir,
  };

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['shopify-orders', query],
    queryFn: () => api.get<Page>('/integrations/shopify/orders', query),
    placeholderData: keepPreviousData,
  });

  const facets = useQuery({
    queryKey: ['order-facets', channel ?? 'all'],
    queryFn: () => api.get<Facets>('/integrations/shopify/orders/facets', { channel }),
    staleTime: 60_000,
  });

  const resync = useMutation({
    mutationFn: () =>
      api.post<{
        shopify: { imported?: number; skippedStale?: number; error?: string };
        unicommerce: { checked?: number; matched?: number; updated?: number; error?: string; skipped?: string };
      }>('/sync/orders/resync', {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['shopify-orders'] });
      void qc.invalidateQueries({ queryKey: ['order-facets'] });
    },
  });

  const unmapped = (data?.data ?? []).reduce((n, o) => n + o.unmappedLineCount, 0);
  const demand = (data?.data ?? []).reduce((n, o) => n + Number(o.demandQty), 0);
  const sort: SortState = { key: p.sort, dir: p.dir };
  const onSort = (key: string, firstDir: 'asc' | 'desc') => {
    const n = nextSort(sort, key, firstDir);
    update({ sort: n.key, dir: n.dir });
  };

  const f = facets.data;
  const dispatchCount: Record<string, number | undefined> = {
    TODAY: f?.dispatch.today, TOMORROW: f?.dispatch.tomorrow, NEXT_7_DAYS: f?.dispatch.next7Days,
    OVERDUE: f?.dispatch.overdue, NONE: f?.dispatch.none,
  };
  const selects = [
    {
      key: 'prio', label: 'Priority', value: p.prio,
      options: PRIORITIES.map((x) => ({ value: x.value, label: x.label, count: f?.priorities.find((c) => c.value === x.value)?.count ?? 0 })),
      onChange: (v: string) => update({ prio: v }),
    },
    {
      key: 'disp', label: 'Dispatch', value: p.disp,
      options: DISPATCH_OPTIONS.map((x) => ({ ...x, count: dispatchCount[x.value] })),
      onChange: (v: string) => update({ disp: v, ...(v !== 'CUSTOM' ? { dfrom: '', dto: '' } : {}) }),
    },
    {
      key: 'status', label: 'Status', value: p.status,
      options: (f?.statuses ?? []).map((x) => ({ value: x.value, label: humanise(x.value), count: x.count })),
      onChange: (v: string) => update({ status: v }),
    },
    {
      key: 'ship', label: 'Shipping', value: p.ship,
      options: (f?.shipmentStatuses ?? []).map((x) => ({ value: x.value, label: shipLabel(x.value), count: x.count })),
      onChange: (v: string) => update({ ship: v }),
    },
    ...(!channel
      ? [{
          key: 'channel', label: 'Channel', value: p.channel,
          options: (f?.channels ?? []).map((x) => ({ value: x.value, label: humanise(x.value), count: x.count })),
          onChange: (v: string) => update({ channel: v, loc: '' }),
        }]
      : []),
    ...((f?.locations.length ?? 0) > 0 && channel !== 'ONLINE'
      ? [{
          key: 'loc', label: 'Store', value: p.loc,
          options: (f?.locations ?? []).map((x) => ({ value: x.value, label: x.value, count: x.count })),
          onChange: (v: string) => update({ loc: v }),
        }]
      : []),
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        description={description}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="default" onClick={() => resync.mutate()} disabled={resync.isPending}>
              <RefreshCw className={resync.isPending ? 'animate-spin' : ''} />
              {resync.isPending ? 'Resyncing…' : 'Resync status'}
            </Button>
            <Link
              href="/admin/integrations"
              className="inline-flex items-center gap-1 text-[13px] font-medium text-ink hover:underline"
            >
              Import orders <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
        }
      />

      {resync.data ? (
        <p className="glass rounded-xl px-3.5 py-2.5 text-[12.5px] text-ink">
          {resync.data.shopify.error
            ? `Shopify: ${resync.data.shopify.error}`
            : `Shopify: ${resync.data.shopify.imported ?? 0} orders refreshed`}
          {' · '}
          {resync.data.unicommerce.error
            ? `Unicommerce: ${resync.data.unicommerce.error}`
            : resync.data.unicommerce.skipped
            ? `Unicommerce: ${resync.data.unicommerce.skipped}`
            : `Unicommerce: ${resync.data.unicommerce.matched ?? 0} matched, ${resync.data.unicommerce.updated ?? 0} status changes`}
        </p>
      ) : null}
      {resync.error ? <ErrorPanel error={resync.error} /> : null}

      {data ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Matching orders" value={fmtQty(String(data.total), 0)} hint={effectiveChannel ? `Channel ${humanise(effectiveChannel)}` : 'All channels'} />
          <Stat label="On this page" value={String(data.data.length)} hint={`Page ${data.page} of ${Math.max(1, data.totalPages)}`} />
          <Stat label="Demand on this page" value={fmtQty(String(demand), 0)} hint="Units still to make or fulfil" />
          <Stat
            label="Unmapped on this page"
            value={String(unmapped)}
            tone={unmapped > 0 ? 'warn' : 'ok'}
            hint="Lines whose SKU has no product"
            href={unmapped > 0 ? '/admin/mappings' : undefined}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Saved views">
        <button
          type="button"
          onClick={() => update({ prio: '', disp: '', dfrom: '', dto: '' })}
          aria-pressed={!p.prio && !p.disp}
          className={`h-8 rounded-full border px-3 text-[12.5px] font-medium transition-colors ${!p.prio && !p.disp ? 'glass-raised border-transparent text-ink' : 'border-line text-ink-muted hover:text-ink'}`}
        >
          All orders
        </button>
        {SAVED_VIEWS.map((v) => {
          const active = Object.entries(v.patch).every(([k, val]) => p[k as keyof ListParams] === val);
          const n = f && v.count ? v.count(f) : undefined;
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => update({ ...v.patch, dfrom: '', dto: '' })}
              aria-pressed={active}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors ${active ? 'glass-raised border-transparent text-ink' : 'border-line text-ink-muted hover:text-ink'} ${v.key === 'overdue' && n ? 'text-danger' : ''}`}
            >
              {v.label}
              {n !== undefined ? <span className="num text-[11.5px] opacity-70">{n.toLocaleString('en-IN')}</span> : null}
            </button>
          );
        })}
      </div>

      <Card material="dense" className="overflow-hidden">
        <div className="border-b border-line px-4 py-3.5">
          <FilterBar
            search={{ value: searchDraft, onChange: setSearchDraft, placeholder: canSeeCustomer ? 'Order no., customer, phone, email or pincode' : 'Order number or customer' }}
            selects={selects}
            toggles={[
              { key: 'bespoke', label: 'Bespoke only', checked: p.bespoke, onChange: (v) => update({ bespoke: v }) },
              { key: 'unmapped', label: 'Has unmapped lines', checked: p.unmapped, onChange: (v) => update({ unmapped: v }) },
            ]}
            dateRange={{ from: p.from, to: p.to, onChange: (r) => update({ from: r.from, to: r.to }) }}
            resultLabel={data ? `${fmtQty(String(data.total), 0)} orders${isFetching ? ' · updating…' : ''}` : undefined}
            extra={p.disp === 'CUSTOM' ? (
              <span className="inline-flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-muted">
                Dispatch from
                <input type="date" value={p.dfrom} max={p.dto || undefined} onChange={(e) => update({ dfrom: e.target.value })} className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink" aria-label="Dispatch from" />
                to
                <input type="date" value={p.dto} min={p.dfrom || undefined} onChange={(e) => update({ dto: e.target.value })} className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink" aria-label="Dispatch to" />
              </span>
            ) : undefined}
            onClear={() => { setSearchDraft(''); setP({ ...DEFAULTS, sort: p.sort, dir: p.dir, size: p.size }); }}
          />
          <ActiveChips p={p} update={update} onSearchClear={() => setSearchDraft('')} />
        </div>

        {isLoading ? <LoadingBlock label="Loading orders" /> : null}
        {error ? <div className="p-4"><ErrorPanel error={error} onRetry={() => void refetch()} /></div> : null}

        {data && data.data.length === 0 ? (
          data.total === 0 && !p.q && !p.status && !p.ship && !p.loc && !p.from && !p.to && !p.bespoke && !p.unmapped && !p.channel && !p.prio && !p.disp ? (
            <EmptyState
              title="No orders imported yet"
              description="Run an import from Integrations. With no date it backfills history; set a date to pull recent orders."
              action={
                <Link href="/admin/integrations" className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[13px] font-medium hover:bg-surface-muted">
                  Go to Integrations <ArrowUpRight className="size-3.5" />
                </Link>
              }
            />
          ) : (
            <EmptyState title="No orders match these filters" description="Widen the date range or clear a filter." />
          )
        ) : null}

        {data && data.data.length > 0 ? (
          <>
            <div className={`table-scroll transition-opacity ${isFetching ? 'opacity-70' : ''}`}>
              <table className="w-full border-separate border-spacing-0 text-[13px]">
                <thead className="text-[12px] text-ink-muted">
                  <tr>
                    <SortTh label="Order" sortKey="orderName" sort={sort} onSort={onSort} />
                    <SortTh label="Priority" sortKey="orderPriority" sort={sort} onSort={onSort} />
                    <SortTh label="Dispatch" sortKey="expectedDispatchDate" sort={sort} onSort={onSort} />
                    <th scope="col" className="px-3 py-2.5 text-left font-semibold">Channel</th>
                    <SortTh label="Customer" sortKey="customerRef" sort={sort} onSort={onSort} />
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">Lines</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">Demand</th>
                    <SortTh label="Value" sortKey="totalAmount" sort={sort} onSort={onSort} align="right" numeric />
                    <SortTh label="Status" sortKey="status" sort={sort} onSort={onSort} />
                    <th scope="col" className="px-3 py-2.5 text-left font-semibold">Shipping</th>
                    <SortTh label="Placed" sortKey="orderedAt" sort={sort} onSort={onSort} numeric />
                    <th scope="col" className="w-10 px-2 py-2.5"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((o) => (
                    <tr
                      key={o.id}
                      onClick={() => router.push(`/orders/${o.id}`)}
                      className="cursor-pointer transition-colors hover:bg-surface-muted [&>td]:border-b [&>td]:border-line last:[&>td]:border-0"
                    >
                      <td className="px-3 py-2">
                        <Link
                          href={`/orders/${o.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-mono text-[12.5px] font-medium underline-offset-2 hover:underline"
                        >
                          {o.orderName ?? o.orderNumber}
                        </Link>
                        {o.isCustomised ? <Badge tone="violet" className="ml-2">bespoke</Badge> : null}
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <PriorityPicker orderId={o.id} value={o.orderPriority} />
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <DispatchDateCell orderId={o.id} date={o.expectedDispatchDate} state={o.dispatchState} source={o.dispatchDateSource} />
                        {o.shopifyDispatchIssue ? (
                          <span className="ml-1 text-[11px] font-medium text-warn" title="The Shopify note's dispatch date needs review">review</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone="outline">{humanise(o.channel)}</Badge>
                        {o.posLocationName ? <span className="ml-1.5 text-[12px] text-ink-muted">{o.posLocationName}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-ink-muted">
                        {o.customerRef ?? '—'}
                        {o.shippingCity || o.shippingZip ? (
                          <span className="block text-[12px] text-ink-subtle">
                            {[o.shippingCity, o.shippingZip].filter(Boolean).join(' · ')}
                          </span>
                        ) : null}
                      </td>
                      <td className="num px-3 py-2 text-right">
                        {o.lines.length}
                        {o.unmappedLineCount > 0 ? (
                          <span className="ml-1 text-warn" title={`${o.unmappedLineCount} unmapped`}>({o.unmappedLineCount}?)</span>
                        ) : null}
                      </td>
                      <td className="num px-3 py-2 text-right font-medium">{fmtQty(o.demandQty, 0)}</td>
                      <td className="num px-3 py-2 text-right">{o.totalAmount ? fmtMoneyCompact(o.totalAmount) : '—'}</td>
                      <td className="px-3 py-2"><StatusBadge status={o.status} /></td>
                      <td className="px-3 py-2">
                        {o.externalShipmentStatus
                          ? <StatusBadge status={o.externalShipmentStatus} />
                          : <span className="text-[12px] text-ink-subtle">not synced</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{fmtDateTime(o.orderedAt)}</td>
                      {/* Clicks inside the dialog bubble through the portal; stop them reaching the row. */}
                      <td className="px-2 py-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                        <SwitchFacilityButton orderId={o.id} compact />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[13px] text-ink-muted">
              <span className="num">
                {((data.page - 1) * data.pageSize + 1).toLocaleString('en-IN')}–
                {Math.min(data.page * data.pageSize, data.total).toLocaleString('en-IN')} of {data.total.toLocaleString('en-IN')}
              </span>
              <div className="flex items-center gap-1.5">
                <select
                  value={p.size}
                  onChange={(e) => update({ size: Number(e.target.value) })}
                  aria-label="Orders per page"
                  className="h-8 rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink [&>option]:bg-canvas"
                >
                  {[25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
                </select>
                <Button size="sm" variant="ghost" disabled={p.page <= 1} onClick={() => update({ page: p.page - 1 })}>Previous</Button>
                <span className="num px-1">{data.page} / {Math.max(1, data.totalPages)}</span>
                <Button size="sm" variant="default" disabled={p.page >= data.totalPages} onClick={() => update({ page: p.page + 1 })}>Next</Button>
              </div>
            </div>
          </>
        ) : null}
      </Card>
    </div>
  );
}

/** The filters in force, each removable on its own. */
function ActiveChips({
  p, update, onSearchClear,
}: { p: ListParams; update: (patch: Partial<ListParams>) => void; onSearchClear: () => void }) {
  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (p.q) chips.push({ key: 'q', label: `Search: ${p.q}`, clear: () => { onSearchClear(); update({ q: '' }); } });
  if (p.prio) chips.push({ key: 'prio', label: PRIORITIES.find((x) => x.value === p.prio)?.label ?? p.prio, clear: () => update({ prio: '' }) });
  if (p.disp) {
    const base = DISPATCH_OPTIONS.find((x) => x.value === p.disp)?.label.replace('…', '') ?? p.disp;
    const range = p.disp === 'CUSTOM' ? ` ${p.dfrom || '…'} – ${p.dto || '…'}` : '';
    chips.push({ key: 'disp', label: `Dispatch: ${base}${range}`, clear: () => update({ disp: '', dfrom: '', dto: '' }) });
  }
  if (p.status) chips.push({ key: 'status', label: `Status: ${humanise(p.status)}`, clear: () => update({ status: '' }) });
  if (p.ship) chips.push({ key: 'ship', label: `Shipping: ${shipLabel(p.ship)}`, clear: () => update({ ship: '' }) });
  if (p.channel) chips.push({ key: 'channel', label: `Channel: ${humanise(p.channel)}`, clear: () => update({ channel: '', loc: '' }) });
  if (p.loc) chips.push({ key: 'loc', label: `Store: ${p.loc}`, clear: () => update({ loc: '' }) });
  if (p.from || p.to) chips.push({ key: 'dates', label: `Placed ${p.from || '…'} – ${p.to || '…'}`, clear: () => update({ from: '', to: '' }) });
  if (p.bespoke) chips.push({ key: 'bespoke', label: 'Bespoke only', clear: () => update({ bespoke: false }) });
  if (p.unmapped) chips.push({ key: 'unmapped', label: 'Has unmapped lines', clear: () => update({ unmapped: false }) });
  if (chips.length === 0) return null;
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Active filters">
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={c.clear}
          className="inline-flex h-7 items-center gap-1 rounded-full border border-brand/40 bg-brand-soft px-2.5 text-[12px] font-medium text-ink hover:border-brand"
          aria-label={`Remove filter ${c.label}`}
        >
          {c.label} <span aria-hidden className="text-ink-muted">×</span>
        </button>
      ))}
    </div>
  );
}
