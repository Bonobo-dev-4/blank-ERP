'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtQty } from '@/lib/utils';
import {
  Card, CardHeader, EmptyState, ErrorPanel, LoadingBlock, PageHeader, Stat, StatusBadge,
} from '@/components/ui/primitives';
import { Figure, ReportWindow, lastDays, type Window } from '@/components/app/report-window';

interface StageRow {
  stageId: string; code: string; name: string; sequence: number; taskCount: number;
  plannedQty: string; receivedQty: string; completedQty: string; forwardedQty: string;
  rejectedQty: string; reworkOpenQty: string; wipQty: string;
  rejectionPct: string | null; firstPassYieldPct: string | null;
}
interface Report {
  window: { from: string | null; to: string | null };
  totals: {
    orderCount: number; batchCount: number; orderedQty: string; completedQty: string;
    rejectedQty: string; completionPct: string | null; rejectionPct: string | null;
  };
  byStage: StageRow[];
  orders: {
    id: string; orderNo: string; status: string; sku: string | null; productName: string | null;
    orderedQty: string; releasedQty: string; completedQty: string; rejectedQty: string; createdAt: string;
  }[];
}

export default function ProductionReportPage() {
  const [w, setW] = React.useState<Window>(() => lastDays(30));
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['report', 'production', w],
    queryFn: () => api.get<Report>(`/reports/production?from=${w.from}&to=${w.to}`),
  });

  const active = data?.byStage.filter((s) => Number(s.receivedQty) > 0) ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Production reports"
        description="Throughput and where it is being lost. Stage figures are never summed — a garment passes through every stage, so adding them counts it once per stage."
      />
      <ReportWindow value={w} onChange={setW} />

      {isLoading ? <LoadingBlock label="Running the report" /> : null}
      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} /> : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Stat label="Orders" value={String(data.totals.orderCount)} hint="Created in this window" />
            <Stat label="Ordered" value={fmtQty(data.totals.orderedQty, 0)} hint="Units asked for" />
            <Stat label="Completed" value={fmtQty(data.totals.completedQty, 0)} hint="Accepted units" tone="ok" />
            <Stat
              label="Rejected"
              value={fmtQty(data.totals.rejectedQty, 0)}
              tone={Number(data.totals.rejectedQty) > 0 ? 'danger' : undefined}
              hint={data.totals.rejectionPct ? `${data.totals.rejectionPct}% of ordered` : 'Nothing rejected'}
            />
            <Stat
              label="Completion"
              value={data.totals.completionPct ? `${data.totals.completionPct}%` : '—'}
              hint="Completed ÷ ordered"
            />
          </div>

          <Card>
            <CardHeader
              title="By stage"
              description="First-pass yield is completed work that never went back for rework — the number a rework loop hides."
            />
            {active.length === 0 ? (
              <EmptyState
                title="No stage activity in this window"
                description="Release a manufacturing order, or widen the date range."
              />
            ) : (
              <div className="scroll-x">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface-muted text-[11px] uppercase tracking-wide text-ink-muted">
                      <th className="px-3 py-1.5 text-left font-semibold">Stage</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Taken in</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Completed</th>
                      <th className="px-3 py-1.5 text-right font-semibold">On the floor</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Rejected</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Rework open</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Reject %</th>
                      <th className="px-3 py-1.5 text-right font-semibold">First-pass yield</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.map((s) => (
                      <tr key={s.stageId} className="border-b border-line last:border-0">
                        <td className="px-3 py-1.5 font-medium">{s.name}</td>
                        <td className="num px-3 py-1.5 text-right">{fmtQty(s.receivedQty, 0)}</td>
                        <td className="num px-3 py-1.5 text-right">{fmtQty(s.completedQty, 0)}</td>
                        <td className="num px-3 py-1.5 text-right font-medium">{fmtQty(s.wipQty, 0)}</td>
                        <td className={`num px-3 py-1.5 text-right ${Number(s.rejectedQty) > 0 ? 'text-danger' : 'text-ink-subtle'}`}>
                          {fmtQty(s.rejectedQty, 0)}
                        </td>
                        <td className={`num px-3 py-1.5 text-right ${Number(s.reworkOpenQty) > 0 ? 'text-warn' : 'text-ink-subtle'}`}>
                          {fmtQty(s.reworkOpenQty, 0)}
                        </td>
                        <td className="px-3 py-1.5 text-right"><Figure value={s.rejectionPct} suffix="%" /></td>
                        <td className="px-3 py-1.5 text-right"><Figure value={s.firstPassYieldPct} suffix="%" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Orders" description={`${data.orders.length} created in this window`} />
            {data.orders.length === 0 ? (
              <EmptyState title="No orders created in this window" description="Widen the date range to see earlier orders." />
            ) : (
              <div className="scroll-x">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface-muted text-[11px] uppercase tracking-wide text-ink-muted">
                      <th className="px-3 py-1.5 text-left font-semibold">Order</th>
                      <th className="px-3 py-1.5 text-left font-semibold">Product</th>
                      <th className="px-3 py-1.5 text-left font-semibold">Status</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Ordered</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Completed</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Rejected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.orders.map((o) => (
                      <tr key={o.id} className="border-b border-line last:border-0">
                        <td className="px-3 py-1.5 font-mono text-[11.5px]">{o.orderNo}</td>
                        <td className="px-3 py-1.5">
                          {o.productName ?? '—'}
                          {o.sku ? <span className="ml-2 font-mono text-[11px] text-ink-subtle">{o.sku}</span> : null}
                        </td>
                        <td className="px-3 py-1.5"><StatusBadge status={o.status} /></td>
                        <td className="num px-3 py-1.5 text-right">{fmtQty(o.orderedQty, 0)}</td>
                        <td className="num px-3 py-1.5 text-right">{fmtQty(o.completedQty, 0)}</td>
                        <td className={`num px-3 py-1.5 text-right ${Number(o.rejectedQty) > 0 ? 'text-danger' : 'text-ink-subtle'}`}>
                          {fmtQty(o.rejectedQty, 0)}
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
