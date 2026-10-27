'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtMoneyCompact, fmtQty, uomShort, humanise } from '@/lib/utils';
import {
  Card, CardHeader, EmptyState, ErrorPanel, LoadingBlock, PageHeader, Stat,
} from '@/components/ui/primitives';
import { FilterBar, SortTh, useTableControls } from '@/components/ui/table-controls';
import { ExportCsvButton } from '@/components/ui/export-csv';
import { Figure, ReportWindow, lastDays, type Window } from '@/components/app/report-window';

interface Line {
  rawMaterialId: string; materialCode: string; name: string; category: string | null;
  baseUom: string | null; postings: number;
  consumedQty: string; wastageQty: string; totalQty: string; wastagePct: string | null;
  standardQty: string; varianceQty: string; variancePct: string | null;
  isOverConsumption: boolean; totalCost: string;
}
interface Report {
  window: { from: string | null; to: string | null };
  totals: { materialCount: number; consumedCost: string; overConsuming: number };
  lines: Line[];
}

export default function ConsumptionReportPage() {
  const [w, setW] = React.useState<Window>(() => lastDays(30));
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['report', 'consumption', w],
    queryFn: () => api.get<Report>(`/reports/consumption?from=${w.from}&to=${w.to}`),
  });


  const ctl = useTableControls(data?.lines, {
    search: (l) => `${l.materialCode} ${l.name}`,
    filters: [{ key: 'category', label: 'Category', get: (l) => l.category, format: humanise }],
    toggles: [{ key: 'over', label: 'Over BOM standard', test: (l) => l.isOverConsumption }],
    sorts: {
      material: (l) => l.materialCode, consumed: (l) => Number(l.consumedQty), wastage: (l) => Number(l.wastageQty),
      wastagePct: (l) => (l.wastagePct == null ? null : Number(l.wastagePct)), standard: (l) => Number(l.standardQty),
      variance: (l) => Number(l.varianceQty), value: (l) => Number(l.totalCost),
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Material consumption"
        description="What was actually consumed, against the BOM frozen at release. Comparing to the live BOM would measure later edits rather than the production run."
      />
      <ReportWindow value={w} onChange={setW}>
        <ExportCsvButton
          filename="material-consumption"
          disabled={!data || data.lines.length === 0}
          headers={['Material code', 'Material', 'Consumed', 'Wastage', 'Wastage %', 'BOM standard', 'Variance', 'Variance %', 'Value']}
          rows={() => ctl.rows.map((l) => [
            l.materialCode, l.name, l.consumedQty, l.wastageQty, l.wastagePct,
            l.standardQty, l.varianceQty, l.variancePct, l.totalCost,
          ])}
        />
      </ReportWindow>

      {isLoading ? <LoadingBlock label="Running the report" /> : null}
      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} /> : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat label="Materials consumed" value={String(data.totals.materialCount)} hint="Distinct materials in this window" />
            <Stat label="Consumed value" value={fmtMoneyCompact(data.totals.consumedCost)} hint="At lot cost" />
            <Stat
              label="Over standard"
              value={String(data.totals.overConsuming)}
              tone={data.totals.overConsuming > 0 ? 'warn' : 'ok'}
              hint="Materials consumed above the frozen BOM"
            />
          </div>

          <Card>
            <CardHeader
              title="By material"
              description="Variance compares consumed plus wastage against the frozen standard. A positive variance means more left stock than the BOM allowed for."
            />
            {data.lines.length === 0 ? (
              <EmptyState
                title="Nothing consumed in this window"
                description="Material consumption is posted when production records an outcome. Widen the date range, or check that orders have been released."
              />
            ) : (
              <>
<div className="border-b border-line px-5 py-3">
  <FilterBar {...ctl.barProps} search={ctl.barProps.search && { ...ctl.barProps.search, placeholder: 'Material code or name' }} />
</div>
<div className="scroll-x">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface-muted text-[12px] font-medium text-ink-muted">
                      <SortTh label="Material" sortKey="material" sort={ctl.sort} onSort={ctl.onSort} />
                      <SortTh label="Consumed" sortKey="consumed" sort={ctl.sort} onSort={ctl.onSort} align="right" numeric />
                      <SortTh label="Wastage" sortKey="wastage" sort={ctl.sort} onSort={ctl.onSort} align="right" numeric />
                      <SortTh label="Wastage %" sortKey="wastagePct" sort={ctl.sort} onSort={ctl.onSort} align="right" numeric />
                      <SortTh label="BOM standard" sortKey="standard" sort={ctl.sort} onSort={ctl.onSort} align="right" numeric />
                      <SortTh label="Variance" sortKey="variance" sort={ctl.sort} onSort={ctl.onSort} align="right" numeric />
                      <SortTh label="Value" sortKey="value" sort={ctl.sort} onSort={ctl.onSort} align="right" numeric />
                    </tr>
                  </thead>
                  <tbody>
                    {ctl.rows.map((l) => (
                      <tr key={l.rawMaterialId} className="border-b border-line last:border-0">
                        <td className="px-3 py-1.5">
                          <span className="font-mono text-[12px]">{l.materialCode}</span>
                          <span className="ml-2 text-ink-muted">{l.name}</span>
                        </td>
                        <td className="num px-3 py-1.5 text-right">
                          {fmtQty(l.consumedQty)} {l.baseUom ? uomShort(l.baseUom) : ''}
                        </td>
                        <td className={`num px-3 py-1.5 text-right ${Number(l.wastageQty) > 0 ? 'text-warn' : 'text-ink-subtle'}`}>
                          {fmtQty(l.wastageQty)}
                        </td>
                        <td className="px-3 py-1.5 text-right"><Figure value={l.wastagePct} suffix="%" /></td>
                        <td className="num px-3 py-1.5 text-right text-ink-muted">{fmtQty(l.standardQty)}</td>
                        <td className={`num px-3 py-1.5 text-right font-medium ${l.isOverConsumption ? 'text-danger' : 'text-ok'}`}>
                          {Number(l.varianceQty) > 0 ? '+' : ''}{fmtQty(l.varianceQty)}
                          {l.variancePct ? <span className="ml-1 text-[12px] font-normal">({l.variancePct}%)</span> : null}
                        </td>
                        <td className="num px-3 py-1.5 text-right">{fmtMoneyCompact(l.totalCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
</>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
