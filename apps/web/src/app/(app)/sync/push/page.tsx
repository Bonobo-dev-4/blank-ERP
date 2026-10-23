'use client';

import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtQty } from '@/lib/utils';
import {
  Button, Card, CardBody, CardHeader, EmptyState, ErrorPanel, LoadingBlock, PageHeader, Stat,
} from '@/components/ui/primitives';

interface Backlog {
  canPush: boolean;
  blockers: { code: string; detail: string }[];
  totals: { pendingQty: string; skuCount: number; inwardsAwaitingSync: number };
  lines: {
    id: string; sku: string; productName: string | null; location: string;
    onHandQty: string; pendingSyncQty: string; syncedQty: string;
  }[];
}

export default function PushPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['sync-backlog'],
    queryFn: () => api.get<Backlog>('/sync/push/backlog'),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Unicommerce inventory push"
        description="Finished stock made here has to reach the system that fulfils orders. Until it does, a garment exists on the floor and nowhere a customer can buy it."
      />

      {isLoading ? <LoadingBlock label="Loading backlog" /> : null}
      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} /> : null}

      {data ? (
        <>
          <Card>
            <CardHeader title="Push is not enabled" description="Every reason, not just the first one." />
            <CardBody className="space-y-3">
              <ul className="space-y-2">
                {data.blockers.map((b) => (
                  <li key={b.code} className="flex gap-2.5 text-[12.5px]">
                    <Lock className="mt-0.5 size-4 shrink-0 text-ink-subtle" />
                    <span>
                      <span className="font-mono text-[11.5px] text-ink-muted">{b.code}</span>
                      <div className="text-ink">{b.detail}</div>
                    </span>
                  </li>
                ))}
              </ul>

              <div className="flex items-center gap-3 border-t border-line pt-3">
                {/*
                  Disabled, not hidden, and not a button that pretends.
                  The specification is explicit that a visible action must
                  either work or be clearly marked unavailable.
                */}
                <Button disabled title="Writing to Unicommerce is not enabled">
                  <Lock /> Push to Unicommerce
                </Button>
                <span className="text-[12px] text-ink-muted">
                  Unavailable. This is a reviewed change, not a setting — see the blockers above.
                </span>
              </div>
            </CardBody>
          </Card>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat
              label="Waiting to push"
              value={fmtQty(data.totals.pendingQty, 0)}
              tone={Number(data.totals.pendingQty) > 0 ? 'warn' : 'ok'}
              hint="Garments not yet reflected externally"
            />
            <Stat label="SKUs affected" value={String(data.totals.skuCount)} hint="With a pending quantity" />
            <Stat
              label="Receipts awaiting sync"
              value={String(data.totals.inwardsAwaitingSync)}
              hint="Posted, not yet pushed"
              href="/finished-goods/grn"
            />
          </div>

          <Card>
            <CardHeader
              title="Backlog"
              description="What a push would send, once it is enabled. Largest first."
            />
            {data.lines.length === 0 ? (
              <EmptyState
                title="Nothing is waiting"
                description="Finished goods queue for sync when an inward is posted. Nothing has been received that has not already been accounted for."
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
                      <th className="px-3 py-1.5 text-right font-semibold">Already synced</th>
                      <th className="px-3 py-1.5 text-right font-semibold">To push</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lines.map((l) => (
                      <tr key={l.id} className="border-b border-line last:border-0">
                        <td className="px-3 py-1.5 font-mono text-[11.5px]">{l.sku}</td>
                        <td className="px-3 py-1.5">{l.productName ?? '—'}</td>
                        <td className="px-3 py-1.5 text-ink-muted">{l.location}</td>
                        <td className="num px-3 py-1.5 text-right">{fmtQty(l.onHandQty, 0)}</td>
                        <td className="num px-3 py-1.5 text-right text-ink-muted">{fmtQty(l.syncedQty, 0)}</td>
                        <td className="num px-3 py-1.5 text-right font-semibold text-warn">
                          {fmtQty(l.pendingSyncQty, 0)}
                        </td>
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
