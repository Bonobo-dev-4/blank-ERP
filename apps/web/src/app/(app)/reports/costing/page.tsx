'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtMoney, fmtMoneyCompact, fmtQty, humanise } from '@/lib/utils';
import {
  Card, CardHeader, EmptyState, ErrorPanel, LoadingBlock, PageHeader, Stat, StatusBadge,
} from '@/components/ui/primitives';
import { FilterBar, SortTh, useTableControls } from '@/components/ui/table-controls';
import { ExportCsvButton } from '@/components/ui/export-csv';
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


  const ctl = useTableControls(data?.orders, {
    search: (o) => `${o.orderNo} ${o.sku ?? ''} ${o.productName ?? ''}`,
    filters: [{ key: 'status', label: 'Status', get: (o) => o.status, format: humanise }],
    toggles: [{ key: 'over', label: 'Over plan', test: (o) => Number(o.varianceAmount) > 0 }],
    sorts: {
      order: (o) => o.orderNo, product: (o) => o.productName, status: (o) => o.status,
      accepted: (o) => Number(o.acceptedQty), planned: (o) => Number(o.plannedTotal), actual: (o) => Number(o.actualTotal),
      variance: (o) => Number(o.varianceAmount), perUnit: (o) => (o.costPerAcceptedUnit == null ? null : Number(o.costPerAcceptedUnit)),
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Production costing"
        description="Planned from the frozen BOM, actual from the ledger. Unit cost divides by accepted units, so rejected garments carry their own cost rather than spreading it across good ones."
      />
      <ReportWindow value={w} onChange={setW}>
        <ExportCsvButton
          filename="production-costing"
          disabled={!data || data.orders.length === 0}
          headers={['Order', 'Product', 'Status', 'Accepted', 'Planned', 'Actual', 'Variance', 'Variance %', 'Cost per accepted unit']}
          rows={() => ctl.rows.map((o) => [
            o.orderNo, o.productName, o.status, o.acceptedQty, o.plannedTotal,
            o.actualTotal, o.varianceAmount, o.variancePct, o.costPerAcceptedUnit,
          ])}
        />
      </ReportWindow>

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
              <>
<div className="border-b border-line px-5 py-3">
  <FilterBar {...ctl.barProps} search={ctl.barProps.search && { ...ctl.barProps.search, placeholder: 'Order, SKU or product' }} />
</div>
<div className="scroll-x">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface-muted text-[12px] font-medium text-ink-muted">
                      <SortTh label="Order" sortKey="order" sort={ctl.sort} onSort={ctl.onSort} />
                      <SortTh label="Product" sortKey="product" sort={ctl.sort} onSort={ctl.onSort} />
                      <SortTh label="Status" sortKey="status" sort={ctl.sort} onSort={ctl.onSort} />
                      <SortTh label="Accepted" sortKey="accepted" sort={ctl.sort} onSort={ctl.onSort} align="right" numeric />
                      <SortTh label="Planned" sortKey="planned" sort={ctl.sort} onSort={ctl.onSort} align="right" numeric />
                      <SortTh label="Actual" sortKey="actual" sort={ctl.sort} onSort={ctl.onSort} align="right" numeric />
                      <SortTh label="Variance" sortKey="variance" sort={ctl.sort} onSort={ctl.onSort} align="right" numeric />
                      <SortTh label="Per unit" sortKey="perUnit" sort={ctl.sort} onSort={ctl.onSort} align="right" numeric />
                    </tr>
                  </thead>
                  <tbody>
                    {ctl.rows.map((o) => (
                      <tr key={o.id} className="border-b border-line last:border-0">
                        <td className="px-3 py-1.5 font-mono text-[12px]">{o.orderNo}</td>
                        <td className="px-3 py-1.5">{o.productName ?? '—'}</td>
                        <td className="px-3 py-1.5"><StatusBadge status={o.status} /></td>
                        <td className="num px-3 py-1.5 text-right">{fmtQty(o.acceptedQty, 0)}</td>
                        <td className="num px-3 py-1.5 text-right text-ink-muted">{fmtMoneyCompact(o.plannedTotal)}</td>
                        <td className="num px-3 py-1.5 text-right">{fmtMoneyCompact(o.actualTotal)}</td>
                        <td className={`num px-3 py-1.5 text-right font-medium ${Number(o.varianceAmount) > 0 ? 'text-danger' : Number(o.varianceAmount) < 0 ? 'text-ok' : 'text-ink-subtle'}`}>
                          {Number(o.varianceAmount) > 0 ? '+' : ''}{fmtMoneyCompact(o.varianceAmount)}
                          {o.variancePct ? <span className="ml-1 text-[12px] font-normal">({o.variancePct}%)</span> : null}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <Figure value={o.costPerAcceptedUnit ? fmtMoney(o.costPerAcceptedUnit) : null} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
</>
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
