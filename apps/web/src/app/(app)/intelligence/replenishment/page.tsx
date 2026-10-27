'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtQty, uomShort, humanise } from '@/lib/utils';
import {
  Badge, Card, CardHeader, EmptyState, ErrorPanel, Label, LoadingBlock, NativeSelect,
  PageHeader, Stat,
} from '@/components/ui/primitives';
import { FilterBar, SortTh, useTableControls } from '@/components/ui/table-controls';

interface Row {
  rawMaterialId: string; materialCode: string; name: string; category: string | null;
  baseUom: string; supplier: string | null; leadTimeDays: number;
  weeksObserved: number; confidence: string; consumptionVelocity: string;
  availableQty: string; incomingQty: string; reorderLevel: string;
  leadTimeDemandQty: string; safetyStockQty: string; targetStockQty: string;
  suggestedQty: string; rationale: string; hasLeadTime: boolean;
}
interface Report {
  lookbackDays: number; safetyStockDays: number;
  totals: { materialCount: number; toOrder: number; missingLeadTime: number; lowConfidence: number };
  rows: Row[];
}

export default function ReplenishmentPage() {
  const [lookback, setLookback] = React.useState('56');
  const [safety, setSafety] = React.useState('0');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['intelligence', 'replenishment', lookback, safety],
    queryFn: () =>
      api.get<Report>(`/intelligence/replenishment?lookbackDays=${lookback}&safetyStockDays=${safety}`),
  });


  const ctl = useTableControls(data?.rows, {
    search: (r) => `${r.materialCode} ${r.name} ${r.supplier ?? ''}`,
    filters: [
      { key: 'supplier', label: 'Supplier', get: (r) => r.supplier },
      { key: 'category', label: 'Category', get: (r) => r.category, format: humanise },
      { key: 'confidence', label: 'Confidence', get: (r) => r.confidence, format: humanise },
    ],
    toggles: [
      { key: 'order', label: 'Needs ordering', test: (r) => Number(r.suggestedQty) > 0 },
      { key: 'nolead', label: 'Missing lead time', test: (r) => !r.hasLeadTime },
    ],
    sorts: {
      material: (r) => r.materialCode, supplier: (r) => r.supplier,
      week: (r) => Number(r.consumptionVelocity), onhand: (r) => Number(r.availableQty),
      onorder: (r) => Number(r.incomingQty), target: (r) => Number(r.targetStockQty),
      order: (r) => Number(r.suggestedQty), confidence: (r) => r.confidence,
    },
    defaultSort: { key: 'order', dir: 'desc' },
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Replenishment"
        description="What to buy, and why. Velocity comes from what production actually consumed rather than from sales — a garment sold today was cut weeks ago, so consumption is the series that predicts the next purchase order."
      />

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface px-3 py-2.5">
        <div>
          <Label htmlFor="lookback" className="text-[12px]">Look back</Label>
          <NativeSelect id="lookback" value={lookback} onChange={(e) => setLookback(e.target.value)} className="h-8 w-[130px]">
            <option value="28">4 weeks</option>
            <option value="56">8 weeks</option>
            <option value="84">12 weeks</option>
            <option value="168">24 weeks</option>
          </NativeSelect>
        </div>
        <div>
          <Label htmlFor="safety" className="text-[12px]">Safety stock</Label>
          <NativeSelect id="safety" value={safety} onChange={(e) => setSafety(e.target.value)} className="h-8 w-[130px]">
            <option value="0">None</option>
            <option value="7">7 days</option>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
          </NativeSelect>
        </div>
      </div>

      {isLoading ? <LoadingBlock label="Computing suggestions" /> : null}
      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} /> : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="To order" value={String(data.totals.toOrder)} tone={data.totals.toOrder > 0 ? 'warn' : 'ok'} hint="Below target stock position" />
            <Stat label="Materials moving" value={String(data.totals.materialCount)} hint="Consumed or needing an order" />
            <Stat
              label="No lead time set"
              value={String(data.totals.missingLeadTime)}
              tone={data.totals.missingLeadTime > 0 ? 'danger' : 'ok'}
              hint="Suggestion cannot be computed"
            />
            <Stat
              label="Thin history"
              value={String(data.totals.lowConfidence)}
              tone={data.totals.lowConfidence > 0 ? 'warn' : undefined}
              hint="Under half the weeks observed"
            />
          </div>

          <Card>
            <CardHeader
              title="Suggestions"
              description="Target is lead-time demand plus safety stock. The suggestion subtracts stock on hand and quantity already on an open purchase order, so nothing is ordered twice."
            />
            {data.rows.length === 0 ? (
              <EmptyState
                title="No material movement in this window"
                description="Replenishment needs consumption history. Post production outcomes, or look back further."
              />
            ) : (
              <>
<div className="border-b border-line px-5 py-3">
  <FilterBar {...ctl.barProps} search={ctl.barProps.search && { ...ctl.barProps.search, placeholder: 'Material or supplier' }} />
</div>
<div className="scroll-x">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface-muted text-[12px] font-medium text-ink-muted">
                      <SortTh label="Material" sortKey="material" sort={ctl.sort} onSort={ctl.onSort} />
                      <SortTh label="Supplier" sortKey="supplier" sort={ctl.sort} onSort={ctl.onSort} />
                      <SortTh label="Per week" sortKey="week" sort={ctl.sort} onSort={ctl.onSort} align="right" numeric />
                      <SortTh label="On hand" sortKey="onhand" sort={ctl.sort} onSort={ctl.onSort} align="right" numeric />
                      <SortTh label="On order" sortKey="onorder" sort={ctl.sort} onSort={ctl.onSort} align="right" numeric />
                      <SortTh label="Target" sortKey="target" sort={ctl.sort} onSort={ctl.onSort} align="right" numeric />
                      <SortTh label="Order" sortKey="order" sort={ctl.sort} onSort={ctl.onSort} align="right" numeric />
                      <SortTh label="Confidence" sortKey="confidence" sort={ctl.sort} onSort={ctl.onSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {ctl.rows.map((r) => (
                      <tr key={r.rawMaterialId} className="border-b border-line last:border-0 align-top">
                        <td className="px-3 py-1.5">
                          <span className="font-mono text-[12px]">{r.materialCode}</span>
                          <span className="ml-2 text-ink-muted">{r.name}</span>
                          {!r.hasLeadTime ? (
                            <span className="ml-2 inline-flex items-center gap-1 text-[12px] text-danger">
                              <TriangleAlert className="size-3" /> no lead time
                            </span>
                          ) : null}
                          <div className="mt-0.5 text-[12px] text-ink-subtle">{r.rationale}</div>
                        </td>
                        <td className="px-3 py-1.5 text-ink-muted">{r.supplier ?? '—'}</td>
                        <td className="num px-3 py-1.5 text-right">{fmtQty(r.consumptionVelocity)}</td>
                        <td className="num px-3 py-1.5 text-right">{fmtQty(r.availableQty)} {uomShort(r.baseUom)}</td>
                        <td className="num px-3 py-1.5 text-right text-ink-muted">{fmtQty(r.incomingQty)}</td>
                        <td className="num px-3 py-1.5 text-right text-ink-muted">{fmtQty(r.targetStockQty)}</td>
                        <td className={`num px-3 py-1.5 text-right font-semibold ${Number(r.suggestedQty) > 0 ? 'text-brand-strong' : 'text-ink-subtle'}`}>
                          {fmtQty(r.suggestedQty)}
                        </td>
                        <td className="px-3 py-1.5">
                          <Badge tone={Number(r.confidence) >= 0.5 ? 'outline' : 'warn'}>
                            {Math.round(Number(r.confidence) * 100)}% · {r.weeksObserved}w
                          </Badge>
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
      ) : null}
    </div>
  );
}
