'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtMoney, fmtMoneyCompact, fmtQty } from '@/lib/utils';
import {
  Card, CardHeader, EmptyState, ErrorPanel, LoadingBlock, PageHeader, Stat, StatusBadge,
} from '@/components/ui/primitives';
import { Figure, ReportWindow, lastDays, type Window } from '@/components/app/report-window';

interface Row {
  id: string; orderNo: string; status: string; sku: string | null; productName: string | null;
  orderedQty: string; acceptedQty: string; rejectedQty: string;
  plannedTotal: string; actualTotal: string; varianceAmount: string; variancePct: string | null;
  costPerAcceptedUnit: string | null;
}
interface Report {
  window: { from: string | null; to: string | null };
  totals: {
    orderCount: number; plannedTotal: string; actualTotal: string;
    varianceAmount: string; variancePct: string | null; jobWorkTotalUnattributed: string;
  } | null;
  orders: Row[];
}

export default function CostingReportPage() {
  const [w, setW] = React.useState<Window>(() => lastDays(90));
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['report', 'costing', w],
    queryFn: () => api.get<Report>(`/reports/costing?from=${w.from}&to=${w.to}`),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Production costing"
        description="Planned from the frozen BOM, actual from the ledger. Unit cost divides by accepted units, so rejected garments carry their own cost rather than spreading it across good ones."
      />
      <ReportWindow value={w} onChange={setW} />

      {isLoading ? <LoadingBlock label="Running the report" /> : null}
      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} /> : null}

      {data && data.totals ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Planned" value={fmtMoneyCompact(data.totals.plannedTotal)} hint="Frozen BOM × planned qty" />
            <Stat label="Actual" value={fmtMoneyCompact(data.totals.actualTotal)} hint="Consumed at lot cost" />
            <Stat
              label="Variance"
              value={fmtMoneyCompact(data.totals.varianceAmount)}
              tone={Number(data.totals.varianceAmount) > 0 ? 'danger' : 'ok'}
              hint={data.totals.variancePct ? `${data.totals.variancePct}% against plan` : 'No planned cost to compare'}
            />
            <Stat label="Orders" value={String(data.totals.orderCount)} hint="Released in this window" />
          </div>

          {Number(data.totals.jobWorkTotalUnattributed) > 0 ? (
            <p className="rounded-lg border border-line bg-surface-muted px-3.5 py-2.5 text-[12px] text-ink-muted">
              <span className="font-medium text-ink">
                {fmtMoney(data.totals.jobWorkTotalUnattributed)} of job work is not included above.
              </span>{' '}
              Job work is charged against job work orders, which the schema does not yet link to a
              manufacturing order. It is reported separately rather than spread across orders, because
              attributing it would need a link that does not exist.
            </p>
          ) : null}

          <Card>
            <CardHeader title="By order" description="Material cost only — labour and overhead are not yet captured per order." />
            {data.orders.length === 0 ? (
              <EmptyState
                title="No released orders in this window"
                description="Costing needs a released order with a frozen BOM. Widen the date range, or release an order."
              />
            ) : (
              <div className="scroll-x">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface-muted text-[11px] uppercase tracking-wide text-ink-muted">
                      <th className="px-3 py-1.5 text-left font-semibold">Order</th>
                      <th className="px-3 py-1.5 text-left font-semibold">Product</th>
                      <th className="px-3 py-1.5 text-left font-semibold">Status</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Accepted</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Planned</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Actual</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Variance</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Per unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.orders.map((o) => (
                      <tr key={o.id} className="border-b border-line last:border-0">
                        <td className="px-3 py-1.5 font-mono text-[11.5px]">{o.orderNo}</td>
                        <td className="px-3 py-1.5">{o.productName ?? '—'}</td>
                        <td className="px-3 py-1.5"><StatusBadge status={o.status} /></td>
                        <td className="num px-3 py-1.5 text-right">{fmtQty(o.acceptedQty, 0)}</td>
                        <td className="num px-3 py-1.5 text-right text-ink-muted">{fmtMoneyCompact(o.plannedTotal)}</td>
                        <td className="num px-3 py-1.5 text-right">{fmtMoneyCompact(o.actualTotal)}</td>
                        <td className={`num px-3 py-1.5 text-right font-medium ${Number(o.varianceAmount) > 0 ? 'text-danger' : Number(o.varianceAmount) < 0 ? 'text-ok' : 'text-ink-subtle'}`}>
                          {Number(o.varianceAmount) > 0 ? '+' : ''}{fmtMoneyCompact(o.varianceAmount)}
                          {o.variancePct ? <span className="ml-1 text-[11px] font-normal">({o.variancePct}%)</span> : null}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <Figure value={o.costPerAcceptedUnit ? fmtMoney(o.costPerAcceptedUnit) : null} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : data ? (
        <EmptyState
          title="No released orders in this window"
          description="Costing compares the frozen BOM against the ledger, so it needs at least one released order."
        />
      ) : null}
    </div>
  );
}
