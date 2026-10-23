'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDateTime, fmtQty } from '@/lib/utils';
import {
  Card, CardHeader, EmptyState, ErrorPanel, Input, LoadingBlock, PageHeader, Stat,
} from '@/components/ui/primitives';

interface Row {
  id: string; productVariantId: string; sku: string; productName: string | null;
  size: string | null; color: string | null;
  location: { id: string; code: string; name: string };
  onHandQty: string; pendingSyncQty: string; syncedQty: string; updatedAt: string;
}
interface Balances {
  totals: { skuCount: number; lineCount: number; onHandQty: string; pendingSyncQty: string };
  rows: Row[];
}

export default function FinishedStockPage() {
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['fg-balances', debounced],
    queryFn: () => api.get<Balances>(`/finished-goods/balances${debounced ? `?search=${encodeURIComponent(debounced)}` : ''}`),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Finished stock"
        description="Garments received from production and available to sell. Stock appears here only when an inward is posted — a movement always explains the quantity."
        actions={
          <Link href="/finished-goods/inward" className="inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline">
            Receive from production <ArrowUpRight className="size-3.5" />
          </Link>
        }
      />

      {isLoading ? <LoadingBlock label="Loading finished stock" /> : null}
      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} /> : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="On hand" value={fmtQty(data.totals.onHandQty, 0)} hint="Garments in finished stock" />
            <Stat label="SKUs" value={String(data.totals.skuCount)} hint="Distinct variants held" />
            <Stat label="Stock lines" value={String(data.totals.lineCount)} hint="SKU × location" />
            <Stat
              label="Awaiting external sync"
              value={fmtQty(data.totals.pendingSyncQty, 0)}
              tone={Number(data.totals.pendingSyncQty) > 0 ? 'warn' : 'ok'}
              hint="Made here, not yet in Unicommerce"
              href="/sync/push"
            />
          </div>

          <Card>
            <CardHeader
              title="Stock by SKU"
              description="Awaiting sync is the backlog the Unicommerce push exists to clear."
              actions={
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search SKU or product"
                  className="h-7 w-[200px]"
                />
              }
            />
            {data.rows.length === 0 ? (
              <EmptyState
                title={debounced ? 'Nothing matches that search' : 'No finished stock yet'}
                description={debounced
                  ? 'Try a different SKU or product name.'
                  : 'Finished garments appear here once an inward is posted against a manufacturing order.'}
                action={
                  !debounced ? (
                    <Link href="/finished-goods/inward" className="inline-flex items-center gap-1 rounded border border-line px-2.5 py-1 text-[12px] font-medium hover:bg-surface-muted">
                      Receive from production <ArrowUpRight className="size-3.5" />
                    </Link>
                  ) : undefined
                }
              />
            ) : (
              <div className="scroll-x">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface-muted text-[11px] uppercase tracking-wide text-ink-muted">
                      <th className="px-3 py-1.5 text-left font-semibold">SKU</th>
                      <th className="px-3 py-1.5 text-left font-semibold">Product</th>
                      <th className="px-3 py-1.5 text-left font-semibold">Location</th>
                      <th className="px-3 py-1.5 text-right font-semibold">On hand</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Awaiting sync</th>
                      <th className="px-3 py-1.5 text-left font-semibold">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.id} className="border-b border-line last:border-0">
                        <td className="px-3 py-1.5 font-mono text-[11.5px]">{r.sku}</td>
                        <td className="px-3 py-1.5">
                          {r.productName ?? '—'}
                          {r.size || r.color ? (
                            <span className="ml-2 text-[11px] text-ink-subtle">
                              {[r.color, r.size].filter(Boolean).join(' · ')}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-1.5 text-ink-muted">{r.location.code}</td>
                        <td className="num px-3 py-1.5 text-right font-medium">{fmtQty(r.onHandQty, 0)}</td>
                        <td className={`num px-3 py-1.5 text-right ${Number(r.pendingSyncQty) > 0 ? 'text-warn' : 'text-ink-subtle'}`}>
                          {fmtQty(r.pendingSyncQty, 0)}
                        </td>
                        <td className="px-3 py-1.5 text-ink-muted">{fmtDateTime(r.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
