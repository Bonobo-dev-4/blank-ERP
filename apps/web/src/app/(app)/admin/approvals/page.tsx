'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtMoneyCompact, humanise } from '@/lib/utils';
import {
  Badge, Card, CardHeader, EmptyState, ErrorPanel, LoadingBlock, PageHeader, Stat,
} from '@/components/ui/primitives';

interface Item {
  kind: 'REQUISITION' | 'PURCHASE_ORDER' | 'BOM_VERSION';
  id: string; reference: string; title: string; subtitle: string | null;
  amount: string | null; dueAt: string | null; raisedAt: string;
  ageDays: number; href: string; permission: string;
}
interface Queue {
  totals: {
    total: number; requisitions: number; purchaseOrders: number;
    bomVersions: number; olderThanAWeek: number;
  };
  items: Item[];
}

const KIND_LABEL: Record<Item['kind'], string> = {
  REQUISITION: 'Requisition',
  PURCHASE_ORDER: 'Purchase order',
  BOM_VERSION: 'BOM version',
};

export default function ApprovalsPage() {
  const [kind, setKind] = React.useState<'ALL' | Item['kind']>('ALL');
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin', 'approvals'],
    queryFn: () => api.get<Queue>('/admin/approvals'),
    refetchInterval: 60_000,
  });

  const items = (data?.items ?? []).filter((i) => kind === 'ALL' || i.kind === kind);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Approvals"
        description="Everything waiting on a decision, read from the documents themselves. Approving happens on the document, where that document's permission check and state machine live."
      />

      {isLoading ? <LoadingBlock label="Loading the queue" /> : null}
      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} /> : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Waiting" value={String(data.totals.total)} tone={data.totals.total > 0 ? 'warn' : 'ok'} hint="Across every document type" />
            <Stat label="Purchase orders" value={String(data.totals.purchaseOrders)} href="/purchasing/approvals" />
            <Stat label="Requisitions" value={String(data.totals.requisitions)} href="/purchasing/requisitions" />
            <Stat
              label="Over a week old"
              value={String(data.totals.olderThanAWeek)}
              tone={data.totals.olderThanAWeek > 0 ? 'danger' : 'ok'}
              hint="Simply the count waiting 7+ days"
            />
          </div>

          <Card>
            <CardHeader
              title="Queue"
              description="Oldest first — the thing that has been blocked longest is the thing to decide."
              actions={
                <div className="flex gap-1.5">
                  {(['ALL', 'PURCHASE_ORDER', 'REQUISITION', 'BOM_VERSION'] as const).map((k) => (
                    <button
                      key={k}
                      onClick={() => setKind(k)}
                      className={`rounded px-2 py-1 text-[11.5px] font-medium transition-colors ${
                        kind === k ? 'bg-brand text-canvas' : 'text-ink-muted hover:bg-surface-muted'
                      }`}
                    >
                      {k === 'ALL' ? 'All' : KIND_LABEL[k]}
                    </button>
                  ))}
                </div>
              }
            />
            {items.length === 0 ? (
              <EmptyState
                title={kind === 'ALL' ? 'Nothing is waiting on a decision' : `No ${KIND_LABEL[kind as Item['kind']].toLowerCase()} is waiting`}
                description={kind === 'ALL'
                  ? 'Requisitions, purchase orders and BOM versions appear here when they reach pending approval.'
                  : 'Try another document type, or clear the filter.'}
              />
            ) : (
              <ul className="divide-y divide-line">
                {items.map((i) => (
                  <li key={`${i.kind}-${i.id}`}>
                    <Link
                      href={i.href}
                      className="group flex flex-wrap items-center gap-x-4 gap-y-1 px-3.5 py-2.5 transition-colors hover:bg-surface-muted"
                    >
                      <Badge tone="outline">{KIND_LABEL[i.kind]}</Badge>
                      <span className="font-mono text-[11.5px]">{i.reference}</span>
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium">{i.title}</span>
                        {i.subtitle ? <span className="ml-2 text-[11.5px] text-ink-muted">{i.subtitle}</span> : null}
                      </span>
                      {i.amount ? <span className="num text-[12.5px]">{fmtMoneyCompact(i.amount)}</span> : null}
                      <span className={`text-[11.5px] ${i.ageDays >= 7 ? 'font-medium text-danger' : 'text-ink-subtle'}`}>
                        {i.ageDays === 0 ? 'today' : `${i.ageDays}d waiting`}
                      </span>
                      {i.dueAt ? (
                        <span className="text-[11.5px] text-ink-subtle">needed {fmtDate(i.dueAt)}</span>
                      ) : null}
                      <ArrowRight className="size-3.5 shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <p className="text-[11.5px] text-ink-subtle">
            The schema carries an <span className="font-mono">ApprovalRequest</span> table that nothing
            writes to. This queue reads the documents&rsquo; own statuses instead, so it shows what is
            actually blocked rather than what a workflow engine would have recorded.
          </p>
        </>
      ) : null}
    </div>
  );
}
