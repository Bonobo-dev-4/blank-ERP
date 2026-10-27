'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtMoneyCompact, fmtQty, uomShort } from '@/lib/utils';
import {
  Card, CardHeader, EmptyState, ErrorPanel, LoadingBlock, PageHeader, Stat,
} from '@/components/ui/primitives';
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
          rows={() => (data?.lines ?? []).map((l) => [
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
              <div className="scroll-x">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface-muted text-[11px] uppercase tracking-wide text-ink-muted">
                      <th className="px-3 py-1.5 text-left font-semibold">Material</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Consumed</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Wastage</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Wastage %</th>
                      <th className="px-3 py-1.5 text-right font-semibold">BOM standard</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Variance</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lines.map((l) => (
                      <tr key={l.rawMaterialId} className="border-b border-line last:border-0">
                        <td className="px-3 py-1.5">
                          <span className="font-mono text-[11.5px]">{l.materialCode}</span>
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
                          {l.variancePct ? <span className="ml-1 text-[11px] font-normal">({l.variancePct}%)</span> : null}
                        </td>
                        <td className="num px-3 py-1.5 text-right">{fmtMoneyCompact(l.totalCost)}</td>
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
