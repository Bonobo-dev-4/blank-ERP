'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDateTime, fmtQty, humanise } from '@/lib/utils';
import {
  Badge, Card, CardHeader, EmptyState, ErrorPanel, LoadingBlock, PageHeader, Stat, StatusBadge,
} from '@/components/ui/primitives';

interface Inward {
  id: string; inwardNo: string; status: string; syncStatus: string;
  moNo: string | null; manufacturingOrderId: string | null;
  lineCount: number; acceptedQty: string; rejectedQty: string; isPosted: boolean;
  inwardDate: string; postedAt: string | null; remarks: string | null;
}

export default function GrnPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['fg-inwards'],
    queryFn: () => api.get<Inward[]>('/finished-goods/inwards'),
  });

  const posted = (data ?? []).filter((i) => i.status === 'POSTED');
  const accepted = posted.reduce((s, i) => s + Number(i.acceptedQty), 0);
  const awaitingSync = posted.filter((i) => i.syncStatus === 'SYNC_PENDING').length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="GRN management"
        description="The register of finished goods receipts. Each posted receipt has a movement behind every line, which is what lets a quantity in stock be traced back to the order that produced it."
        actions={
          <Link href="/finished-goods/inward" className="inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline">
            New receipt <ArrowUpRight className="size-3.5" />
          </Link>
        }
      />

      {isLoading ? <LoadingBlock label="Loading receipts" /> : null}
      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} /> : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Receipts" value={String(data.length)} hint="All time" />
            <Stat label="Posted" value={String(posted.length)} hint="Stock exists from these" />
            <Stat label="Garments received" value={fmtQty(String(accepted), 0)} hint="Across posted receipts" />
            <Stat
              label="Awaiting external sync"
              value={String(awaitingSync)}
              tone={awaitingSync > 0 ? 'warn' : 'ok'}
              hint="Not yet pushed to Unicommerce"
              href="/sync/push"
            />
          </div>

          <Card>
            <CardHeader title="Receipts" description="Newest first." />
            {data.length === 0 ? (
              <EmptyState
                title="No receipts yet"
                description="A receipt is created when finished garments are taken from production into stock."
                action={
                  <Link href="/finished-goods/inward" className="inline-flex items-center gap-1 rounded border border-line px-2.5 py-1 text-[12px] font-medium hover:bg-surface-muted">
                    Receive from production <ArrowUpRight className="size-3.5" />
                  </Link>
                }
              />
            ) : (
              <div className="scroll-x">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface-muted text-[12px] font-medium text-ink-muted">
                      <th className="px-3 py-1.5 text-left font-semibold">Receipt</th>
                      <th className="px-3 py-1.5 text-left font-semibold">Order</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Lines</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Accepted</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Rejected</th>
                      <th className="px-3 py-1.5 text-left font-semibold">Status</th>
                      <th className="px-3 py-1.5 text-left font-semibold">External sync</th>
                      <th className="px-3 py-1.5 text-left font-semibold">Posted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((i) => (
                      <tr key={i.id} className="border-b border-line last:border-0">
                        <td className="px-3 py-1.5 font-mono text-[12px]">{i.inwardNo}</td>
                        <td className="px-3 py-1.5 font-mono text-[12px] text-ink-muted">{i.moNo ?? '—'}</td>
                        <td className="num px-3 py-1.5 text-right">{i.lineCount}</td>
                        <td className="num px-3 py-1.5 text-right font-medium">{fmtQty(i.acceptedQty, 0)}</td>
                        <td className={`num px-3 py-1.5 text-right ${Number(i.rejectedQty) > 0 ? 'text-danger' : 'text-ink-subtle'}`}>
                          {fmtQty(i.rejectedQty, 0)}
                        </td>
                        <td className="px-3 py-1.5"><StatusBadge status={i.status} /></td>
                        <td className="px-3 py-1.5">
                          <Badge tone={i.syncStatus === 'SYNC_SUCCESS' ? 'ok' : i.syncStatus === 'SYNC_FAILED' ? 'danger' : 'outline'}>
                            {humanise(i.syncStatus)}
                          </Badge>
                        </td>
                        <td className="px-3 py-1.5 text-ink-muted">
                          {i.postedAt ? fmtDateTime(i.postedAt) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <p className="text-[12px] text-ink-subtle">
            Everything posted here sits at <span className="font-mono">SYNC_PENDING</span> until the
            Unicommerce push runs. That push is not enabled yet, so the backlog is expected rather than
            a fault.
          </p>
        </>
      ) : null}
    </div>
  );
}
