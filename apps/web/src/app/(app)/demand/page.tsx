'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Wand2 } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtQty, humanise } from '@/lib/utils';
import {
  Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorPanel, Field, Input,
  LoadingBlock, PageHeader, Stat, StatusBadge,
} from '@/components/ui/primitives';
import { FilterBar, SortTh, nextSort, type SortState } from '@/components/ui/table-controls';
import { SwitchFacilityButton } from '@/components/app/switch-facility';
import { DispatchDateText, PRIORITIES, PriorityBadge, type DispatchState, type OrderPriority } from '@/components/app/order-crm';

interface Demand {
  id: string; demandNo: string; channel: string; sku: string | null; productName: string | null;
  size: string | null; color: string | null; isMapped: boolean;
  requestedQty: string; manufacturingQty: string; allocatedQty: string; openQty: string;
  status: string; priority: string; requiredByDate: string | null;
  decisionReason: string | null; createdAt: string;
  /** The customer promise behind this demand: highest priority, earliest open dispatch. */
  crm: { priority: OrderPriority; dispatchDate: string | null; dispatchState: DispatchState; orderCount: number } | null;
  sources: {
    system: string; docNo: string | null; qty: string; isPrimary: boolean;
    orderId: string | null; orderLineId: string | null;
  }[];
}
interface Page {
  data: Demand[]; page: number; pageSize: number; total: number; totalPages: number;
  byStatus: Record<string, number>;
  byChannel?: Record<string, number>;
  byPriority?: Record<string, number>;
}

/** Filters from the address bar, so links like /demand?status=NEEDS_MAPPING land filtered. */
const fromUrl = (k: string) => (typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get(k) ?? '');

const key = () => crypto.randomUUID();

export default function DemandPage() {
  const qc = useQueryClient();
  const [status, setStatusRaw] = React.useState(() => fromUrl('status'));
  const [channel, setChannelRaw] = React.useState(() => fromUrl('channel'));
  const [priority, setPriorityRaw] = React.useState(() => fromUrl('priority'));
  const [orderPriority, setOrderPriorityRaw] = React.useState(() => fromUrl('orderPriority'));
  const [unmappedOnly, setUnmappedRaw] = React.useState(false);
  const [searchDraft, setSearchDraft] = React.useState(() => fromUrl('q'));
  const [search, setSearch] = React.useState(searchDraft);
  const [sort, setSort] = React.useState<SortState | null>(null);
  const [page, setPage] = React.useState(1);
  const [since, setSince] = React.useState('');

  // Every filter change returns to page one.
  const setStatus = (v: string) => { setStatusRaw(v); setPage(1); };
  const setChannel = (v: string) => { setChannelRaw(v); setPage(1); };
  const setPriority = (v: string) => { setPriorityRaw(v); setPage(1); };
  const setOrderPriority = (v: string) => { setOrderPriorityRaw(v); setPage(1); };
  const setUnmapped = (v: boolean) => { setUnmappedRaw(v); setPage(1); };
  React.useEffect(() => {
    const t = window.setTimeout(() => { setSearch(searchDraft.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(t);
  }, [searchDraft]);

  const params = {
    page, pageSize: 25,
    status: status || undefined, channel: channel || undefined, priority: priority || undefined,
    orderPriority: orderPriority || undefined,
    search: search || undefined, mapped: unmappedOnly ? 'false' : undefined,
    sortBy: sort?.key, sortDir: sort?.dir,
  };
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['demand', params],
    queryFn: () => api.get<Page>('/demand', params),
    placeholderData: keepPreviousData,
  });
  const onSort = (key: string, firstDir: 'asc' | 'desc') => { setSort((cur) => nextSort(cur, key, firstDir)); setPage(1); };
  const filtersActive = Boolean(status || channel || priority || orderPriority || search || unmappedOnly);
  const clearAll = () => {
    setStatusRaw(''); setChannelRaw(''); setPriorityRaw(''); setOrderPriorityRaw(''); setUnmappedRaw(false); setSearchDraft(''); setSearch(''); setPage(1);
  };
  const opts = (counts?: Record<string, number>) =>
    Object.entries(counts ?? {}).sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, label: humanise(value), count }));

  const promote = useMutation({
    mutationFn: () =>
      api.post<{ result: {
        ordersScanned: number; created: number; attached: number; updated: number; ignored: number;
        skippedNoDemand: number; remaining?: number; upToDate?: boolean;
      } }>(
        '/demand/promote/shopify',
        { idempotencyKey: key(), ...(since ? { since } : {}), limit: 1000 },
      ),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['demand'] }); },
  });

  const needsMapping = data?.byStatus?.NEEDS_MAPPING ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Manufacturing demand"
        description="What the factory is being asked to make. An order line records what a customer bought; demand is the decision to make it — so promoting one into the other is deliberate, not a side effect of import."
      />

      <Card>
        <CardHeader
          title="Promote from Shopify"
          description="The same order arriving twice — once direct, once mirrored through Unicommerce — collapses onto one demand row instead of being manufactured twice."
        />
        <CardBody>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Orders placed since" className="w-[180px]" hint="Up to 1,000 orders a run; run again for more">
              <Input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
            </Field>
            <Button onClick={() => promote.mutate()} disabled={promote.isPending}>
              <Wand2 /> {promote.isPending ? 'Promoting…' : 'Promote orders to demand'}
            </Button>
          </div>
          {promote.error ? <div className="mt-3"><ErrorPanel error={promote.error} /></div> : null}
          {promote.data?.result.upToDate && promote.data.result.ordersScanned === 0 ? (
            <div className="mt-3 rounded-lg border border-line bg-surface-muted px-3.5 py-2.5 text-[12.5px]">
              Up to date — every line still owed in this window is already demand.
            </div>
          ) : promote.data ? (
            <div className="mt-3 rounded-lg border border-line bg-surface-muted px-3.5 py-2.5 text-[12.5px]">
              {promote.data.result.remaining ? (
                <div className="mb-1 font-medium text-warn">
                  {promote.data.result.remaining.toLocaleString('en-IN')} more orders still to promote — press the button again.
                </div>
              ) : null}
              Scanned {promote.data.result.ordersScanned} orders —{' '}
              <span className="font-medium">{promote.data.result.created} new</span>,{' '}
              {promote.data.result.attached} attached to existing demand,{' '}
              {promote.data.result.updated} quantity changes,{' '}
              {promote.data.result.ignored} already imported.
              {promote.data.result.skippedNoDemand > 0 ? (
                <div className="mt-1 text-ink-muted">
                  {promote.data.result.skippedNoDemand} lines owed nothing — already shipped, refunded
                  or cancelled.
                </div>
              ) : null}
            </div>
          ) : null}
        </CardBody>
      </Card>

      {isLoading ? <LoadingBlock label="Loading demand" /> : null}
      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} /> : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Demand rows" value={fmtQty(String(data.total), 0)} hint="After deduplication" />
            <Stat label="New" value={String(data.byStatus?.NEW ?? 0)} hint="Not yet allocated to an order" />
            <Stat
              label="Needs mapping"
              value={String(needsMapping)}
              tone={needsMapping > 0 ? 'warn' : 'ok'}
              hint="SKU has no product variant"
              href={needsMapping > 0 ? '/admin/mappings' : undefined}
            />
            <Stat label="Allocated" value={String(data.byStatus?.FULLY_ALLOCATED ?? 0)} hint="Covered by a manufacturing order" />
          </div>

          <Card>
            <CardHeader
              title="Demand"
              description={sort ? 'Sorted by the column you chose.' : 'Soonest required first.'}
            />
            <div className="border-b border-line px-5 py-3">
              <FilterBar
                search={{ value: searchDraft, onChange: setSearchDraft, placeholder: 'Demand no., SKU or product' }}
                selects={[
                  { key: 'status', label: 'Status', value: status, options: opts(data.byStatus), onChange: setStatus },
                  { key: 'channel', label: 'Channel', value: channel, options: opts(data.byChannel), onChange: setChannel },
                  { key: 'orderPriority', label: 'Order priority', value: orderPriority, options: PRIORITIES.map((x) => ({ value: x.value, label: x.label })), onChange: setOrderPriority },
                  { key: 'priority', label: 'Production priority', value: priority, options: opts(data.byPriority), onChange: setPriority },
                ]}
                toggles={[{ key: 'unmapped', label: 'Unmapped only', checked: unmappedOnly, onChange: setUnmapped }]}
                resultLabel={`${fmtQty(String(data.total), 0)} rows${isFetching ? ' · updating…' : ''}`}
                onClear={clearAll}
              />
            </div>
            {data.data.length === 0 ? (
              <EmptyState
                title={filtersActive ? 'No demand matches these filters' : 'No demand yet'}
                description={filtersActive
                  ? 'Clear a filter or change the search.'
                  : 'Import Shopify orders, then promote them above. Demand does not appear on its own — it is a decision, not a copy of an order.'}
                action={
                  <Link href="/admin/integrations" className="inline-flex items-center gap-1 rounded border border-line px-2.5 py-1 text-[12px] font-medium hover:bg-surface-muted">
                    Import orders <ArrowUpRight className="size-3.5" />
                  </Link>
                }
              />
            ) : (
              <>
                <div className="scroll-x">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="border-b border-line bg-surface-muted text-[12px] font-medium text-ink-muted">
                        <SortTh label="Demand" sortKey="demandNo" sort={sort} onSort={onSort} />
                        <th className="px-3 py-1.5 text-left font-semibold">SKU</th>
                        <th className="px-3 py-1.5 text-left font-semibold">Channel</th>
                        <SortTh label="To make" sortKey="manufacturingQty" sort={sort} onSort={onSort} align="right" numeric />
                        <th className="px-3 py-1.5 text-right font-semibold">Allocated</th>
                        <th className="px-3 py-1.5 text-right font-semibold">Open</th>
                        <SortTh label="Status" sortKey="status" sort={sort} onSort={onSort} />
                        <th className="px-3 py-1.5 text-left font-semibold">Sources</th>
                        <th className="px-3 py-1.5 text-left font-semibold">Order priority</th>
                        <SortTh label="Dispatch by" sortKey="requiredByDate" sort={sort} onSort={onSort} />
                        <th className="w-10 px-2 py-1.5"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.data.map((d) => (
                        <tr key={d.id} className="border-b border-line last:border-0">
                          <td className="px-3 py-1.5 font-mono text-[12px]">{d.demandNo}</td>
                          <td className="px-3 py-1.5">
                            <span className="font-mono text-[12px]">{d.sku ?? '—'}</span>
                            {!d.isMapped ? <Badge tone="warn" className="ml-2">unmapped</Badge> : null}
                            {d.productName ? <div className="text-[12px] text-ink-muted">{d.productName}</div> : null}
                          </td>
                          <td className="px-3 py-1.5"><Badge tone="outline">{humanise(d.channel)}</Badge></td>
                          <td className="num px-3 py-1.5 text-right font-medium">{fmtQty(d.manufacturingQty, 0)}</td>
                          <td className="num px-3 py-1.5 text-right text-ink-muted">{fmtQty(d.allocatedQty, 0)}</td>
                          <td className={`num px-3 py-1.5 text-right ${Number(d.openQty) > 0 ? 'font-medium text-warn' : 'text-ink-subtle'}`}>
                            {fmtQty(d.openQty, 0)}
                          </td>
                          <td className="px-3 py-1.5"><StatusBadge status={d.status} /></td>
                          <td className="px-3 py-1.5 text-[12px] text-ink-muted">
                            {d.sources.map((s) => s.docNo ?? s.system).join(', ') || '—'}
                          </td>
                          <td className="px-3 py-1.5">
                            {d.crm ? <PriorityBadge priority={d.crm.priority} compact /> : <span className="text-ink-subtle">—</span>}
                          </td>
                          <td className="px-3 py-1.5">
                            {d.crm
                              ? <DispatchDateText date={d.crm.dispatchDate} state={d.crm.dispatchState} />
                              : <span className="text-ink-muted">{d.requiredByDate ? fmtDate(d.requiredByDate) : '—'}</span>}
                          </td>
                          <td className="px-2 py-1">
                            {(() => {
                              const src = d.sources.find((x) => x.orderId) ?? null;
                              return src ? <SwitchFacilityButton orderId={src.orderId} lineId={src.orderLineId} compact /> : null;
                            })()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.totalPages > 1 ? (
                  <div className="flex items-center justify-between border-t border-line px-3.5 py-2 text-[12px]">
                    <span className="text-ink-muted">Page {data.page} of {data.totalPages}</span>
                    <div className="flex gap-1.5">
                      <button className="rounded border border-line px-2 py-1 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
                      <button className="rounded border border-line px-2 py-1 disabled:opacity-40" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
