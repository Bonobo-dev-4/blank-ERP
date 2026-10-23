'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { fmtDateTime, fmtMoneyCompact, fmtQty, humanise } from '@/lib/utils';
import {
  Badge, Card, CardHeader, EmptyState, ErrorPanel, LoadingBlock, PageHeader, Stat, StatusBadge,
} from '@/components/ui/primitives';

interface Line {
  id: string; externalSku: string | null; title: string | null; productVariantId: string | null;
  orderedQty: string; cancelledQty: string; fulfilledQty: string;
  manufacturingQty: string; availabilityStatus: string;
}
interface Order {
  id: string; orderNumber: string; orderName: string | null; channel: string;
  channelBasis: string | null; isCustomised: boolean;
  posLocationName: string | null; orderedAt: string; status: string;
  financialStatus: string | null; fulfillmentStatus: string | null;
  currency: string | null; totalAmount: string | null; customerRef: string | null;
  tags: string[]; cancelledAt: string | null;
  lines: Line[]; demandQty: string; unmappedLineCount: number;
}
interface Page { data: Order[]; page: number; pageSize: number; total: number; totalPages: number }

/**
 * Imported external orders.
 *
 * One component behind All / Shopify / POS, filtered by channel, so the three
 * routes cannot drift into disagreeing about the same order.
 */
export function OrderList({
  title, description, channel,
}: {
  title: string; description: string; channel?: 'ONLINE' | 'POS' | 'CUSTOM';
}) {
  const [page, setPage] = React.useState(1);
  const qs = new URLSearchParams({ page: String(page), pageSize: '25', ...(channel ? { channel } : {}) });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['shopify-orders', channel ?? 'all', page],
    queryFn: () => api.get<Page>(`/integrations/shopify/orders?${qs}`),
  });

  const unmapped = (data?.data ?? []).reduce((n, o) => n + o.unmappedLineCount, 0);
  const demand = (data?.data ?? []).reduce((n, o) => n + Number(o.demandQty), 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        description={description}
        actions={
          <Link
            href="/admin/integrations"
            className="inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline"
          >
            Import orders <ArrowUpRight className="size-3.5" />
          </Link>
        }
      />

      {isLoading ? <LoadingBlock label="Loading orders" /> : null}
      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} /> : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Orders" value={fmtQty(String(data.total), 0)} hint={channel ? `Channel ${humanise(channel)}` : 'All channels'} />
            <Stat label="On this page" value={String(data.data.length)} hint={`Page ${data.page} of ${data.totalPages}`} />
            <Stat label="Demand" value={fmtQty(String(demand), 0)} hint="Units still to make or fulfil" />
            <Stat
              label="Unmapped lines"
              value={String(unmapped)}
              tone={unmapped > 0 ? 'warn' : 'ok'}
              hint="SKU has no product variant"
              href={unmapped > 0 ? '/admin/mappings' : undefined}
            />
          </div>

          <Card>
            <CardHeader title="Orders" description="Newest first. Demand is net of cancellation, refund and what has already shipped." />
            {data.data.length === 0 ? (
              <EmptyState
                title="No orders imported yet"
                description="Run an import from Integrations. With no date it backfills history; set a date to pull recent orders."
                action={
                  <Link
                    href="/admin/integrations"
                    className="inline-flex items-center gap-1 rounded border border-line px-2.5 py-1 text-[12px] font-medium hover:bg-surface-muted"
                  >
                    Go to Integrations <ArrowUpRight className="size-3.5" />
                  </Link>
                }
              />
            ) : (
              <>
                <div className="scroll-x">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="border-b border-line bg-surface-muted text-[11px] uppercase tracking-wide text-ink-muted">
                        <th className="px-3 py-1.5 text-left font-semibold">Order</th>
                        <th className="px-3 py-1.5 text-left font-semibold">Channel</th>
                        <th className="px-3 py-1.5 text-left font-semibold">Customer</th>
                        <th className="px-3 py-1.5 text-right font-semibold">Lines</th>
                        <th className="px-3 py-1.5 text-right font-semibold">Demand</th>
                        <th className="px-3 py-1.5 text-right font-semibold">Value</th>
                        <th className="px-3 py-1.5 text-left font-semibold">Status</th>
                        <th className="px-3 py-1.5 text-left font-semibold">Placed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.data.map((o) => (
                        <tr key={o.id} className="border-b border-line last:border-0">
                          <td className="px-3 py-1.5">
                            <span className="font-mono text-[11.5px]">{o.orderName ?? o.orderNumber}</span>
                            {o.isCustomised ? <Badge tone="info" className="ml-2">bespoke</Badge> : null}
                          </td>
                          <td className="px-3 py-1.5">
                            <Badge tone="outline">{humanise(o.channel)}</Badge>
                            {o.posLocationName ? (
                              <span className="ml-1.5 text-[11px] text-ink-muted">{o.posLocationName}</span>
                            ) : null}
                          </td>
                          <td className="px-3 py-1.5 text-ink-muted">{o.customerRef ?? '—'}</td>
                          <td className="num px-3 py-1.5 text-right">
                            {o.lines.length}
                            {o.unmappedLineCount > 0 ? (
                              <span className="ml-1 text-warn" title={`${o.unmappedLineCount} unmapped`}>
                                ({o.unmappedLineCount}?)
                              </span>
                            ) : null}
                          </td>
                          <td className="num px-3 py-1.5 text-right font-medium">{fmtQty(o.demandQty, 0)}</td>
                          <td className="num px-3 py-1.5 text-right">
                            {o.totalAmount ? fmtMoneyCompact(o.totalAmount) : '—'}
                          </td>
                          <td className="px-3 py-1.5"><StatusBadge status={o.status} /></td>
                          <td className="px-3 py-1.5 text-ink-muted">{fmtDateTime(o.orderedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {data.totalPages > 1 ? (
                  <div className="flex items-center justify-between border-t border-line px-3.5 py-2 text-[12px]">
                    <span className="text-ink-muted">
                      Page {data.page} of {data.totalPages} · {fmtQty(String(data.total), 0)} orders
                    </span>
                    <div className="flex gap-1.5">
                      <button
                        className="rounded border border-line px-2 py-1 disabled:opacity-40"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => p - 1)}
                      >
                        Previous
                      </button>
                      <button
                        className="rounded border border-line px-2 py-1 disabled:opacity-40"
                        disabled={page >= data.totalPages}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        Next
                      </button>
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
