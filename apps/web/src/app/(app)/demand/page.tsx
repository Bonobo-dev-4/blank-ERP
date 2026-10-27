'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Wand2 } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtQty, humanise } from '@/lib/utils';
import {
  Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorPanel, Field, Input,
  LoadingBlock, PageHeader, Stat, StatusBadge,
} from '@/components/ui/primitives';

interface Demand {
  id: string; demandNo: string; channel: string; sku: string | null; productName: string | null;
  size: string | null; color: string | null; isMapped: boolean;
  requestedQty: string; manufacturingQty: string; allocatedQty: string; openQty: string;
  status: string; priority: string; requiredByDate: string | null;
  decisionReason: string | null; createdAt: string;
  sources: { system: string; docNo: string | null; qty: string; isPrimary: boolean }[];
}
interface Page {
  data: Demand[]; page: number; pageSize: number; total: number; totalPages: number;
  byStatus: Record<string, number>;
}

const key = () => crypto.randomUUID();

export default function DemandPage() {
  const qc = useQueryClient();
  const [status, setStatus] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [since, setSince] = React.useState('');

  const qs = new URLSearchParams({ page: String(page), pageSize: '25', ...(status ? { status } : {}) });
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['demand', status, page],
    queryFn: () => api.get<Page>(`/demand?${qs}`),
  });

  const promote = useMutation({
    mutationFn: () =>
      api.post<{ result: { ordersScanned: number; created: number; attached: number; updated: number; ignored: number; skippedNoDemand: number } }>(
        '/demand/promote/shopify',
        { idempotencyKey: key(), ...(since ? { since } : {}), limit: 500 },
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
            <Field label="Orders placed since" className="w-[180px]" hint="Blank scans the most recent 500">
              <Input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
            </Field>
            <Button onClick={() => promote.mutate()} disabled={promote.isPending}>
              <Wand2 /> {promote.isPending ? 'Promoting…' : 'Promote orders to demand'}
            </Button>
          </div>
          {promote.error ? <div className="mt-3"><ErrorPanel error={promote.error} /></div> : null}
          {promote.data ? (
            <div className="mt-3 rounded-lg border border-line bg-surface-muted px-3.5 py-2.5 text-[12.5px]">
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
              description="Soonest required first."
              actions={
                <select
                  value={status}
                  onChange={(e) => { setStatus(e.target.value); setPage(1); }}
                  className="h-7 rounded border border-line bg-surface px-2 text-[12px]"
                >
                  <option value="">All statuses</option>
                  {['NEW', 'NEEDS_MAPPING', 'PENDING_REVIEW', 'APPROVED_FOR_PRODUCTION', 'PARTIALLY_ALLOCATED', 'FULLY_ALLOCATED', 'CANCELLED'].map((s) => (
                    <option key={s} value={s}>{humanise(s)}</option>
                  ))}
                </select>
              }
            />
            {data.data.length === 0 ? (
              <EmptyState
                title={status ? 'No demand with that status' : 'No demand yet'}
                description={status
                  ? 'Clear the filter to see everything.'
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
                        <th className="px-3 py-1.5 text-left font-semibold">Demand</th>
                        <th className="px-3 py-1.5 text-left font-semibold">SKU</th>
                        <th className="px-3 py-1.5 text-left font-semibold">Channel</th>
                        <th className="px-3 py-1.5 text-right font-semibold">To make</th>
                        <th className="px-3 py-1.5 text-right font-semibold">Allocated</th>
                        <th className="px-3 py-1.5 text-right font-semibold">Open</th>
                        <th className="px-3 py-1.5 text-left font-semibold">Status</th>
                        <th className="px-3 py-1.5 text-left font-semibold">Sources</th>
                        <th className="px-3 py-1.5 text-left font-semibold">Needed</th>
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
                          <td className="px-3 py-1.5 text-ink-muted">
                            {d.requiredByDate ? fmtDate(d.requiredByDate) : '—'}
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
