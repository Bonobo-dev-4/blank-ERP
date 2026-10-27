'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtQty, humanise } from '@/lib/utils';
import {
  Badge, Card, CardHeader, EmptyState, ErrorPanel, Label, LoadingBlock, NativeSelect,
  PageHeader, Stat,
} from '@/components/ui/primitives';
import { FilterBar, SortTh, useTableControls } from '@/components/ui/table-controls';

interface Row {
  productVariantId: string; sku: string | null; productName: string | null; styleCode: string | null;
  size: string | null; color: string | null;
  unitsSold: string; weeksObserved: number; salesVelocity: string; confidence: string;
  method: string; forecastQty: string; onHandQty: string;
}
interface Report {
  lookbackDays: number; horizonDays: number; method: string;
  note: string | null;
  totals?: { skuCount: number; unitsSold: string; forecastQty: string; lowConfidence: number };
  rows: Row[];
}

/**
 * Demand forecast.
 *
 * Shared by Intelligence → Forecasting and Demand → Forecast, because they are
 * the same question asked from two places. One component means the two screens
 * cannot drift into disagreeing about the same number.
 */
export function DemandForecast({ title, description }: { title: string; description: string }) {
  const [lookback, setLookback] = React.useState('56');
  const [horizon, setHorizon] = React.useState('30');
  const [method, setMethod] = React.useState('WEIGHTED_VELOCITY');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['intelligence', 'forecast', lookback, horizon, method],
    queryFn: () =>
      api.get<Report>(`/intelligence/forecast?lookbackDays=${lookback}&horizonDays=${horizon}&method=${method}`),
  });


  const ctl = useTableControls(data?.rows, {
    search: (r) => `${r.sku ?? ''} ${r.productName ?? ''} ${r.styleCode ?? ''}`,
    filters: [
      { key: 'size', label: 'Size', get: (r) => r.size },
      { key: 'confidence', label: 'Confidence', get: (r) => r.confidence, format: humanise },
    ],
    toggles: [{ key: 'short', label: 'Below forecast', test: (r) => Number(r.onHandQty) < Number(r.forecastQty) }],
    sorts: {
      sku: (r) => r.sku, product: (r) => r.productName, sold: (r) => Number(r.unitsSold),
      week: (r) => Number(r.salesVelocity), forecast: (r) => Number(r.forecastQty),
      onhand: (r) => Number(r.onHandQty), confidence: (r) => r.confidence,
    },
    defaultSort: { key: 'forecast', dir: 'desc' },
  });

  return (
    <div className="space-y-4">
      <PageHeader title={title} description={description} />

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface px-3 py-2.5">
        <div>
          <Label htmlFor="lb" className="text-[12px]">Look back</Label>
          <NativeSelect id="lb" value={lookback} onChange={(e) => setLookback(e.target.value)} className="h-8 w-[130px]">
            <option value="28">4 weeks</option>
            <option value="56">8 weeks</option>
            <option value="84">12 weeks</option>
            <option value="168">24 weeks</option>
          </NativeSelect>
        </div>
        <div>
          <Label htmlFor="hz" className="text-[12px]">Forecast ahead</Label>
          <NativeSelect id="hz" value={horizon} onChange={(e) => setHorizon(e.target.value)} className="h-8 w-[130px]">
            <option value="14">14 days</option>
            <option value="30">30 days</option>
            <option value="60">60 days</option>
            <option value="90">90 days</option>
          </NativeSelect>
        </div>
        <div>
          <Label htmlFor="mt" className="text-[12px]">Method</Label>
          <NativeSelect id="mt" value={method} onChange={(e) => setMethod(e.target.value)} className="h-8 w-[190px]">
            <option value="WEIGHTED_VELOCITY">Weighted — recent weeks count more</option>
            <option value="MOVING_AVERAGE">Moving average — all weeks equal</option>
          </NativeSelect>
        </div>
      </div>

      {isLoading ? <LoadingBlock label="Computing the forecast" /> : null}
      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} /> : null}

      {data?.note ? (
        <EmptyState title="No sales history to forecast from" description={data.note} />
      ) : null}

      {data && !data.note && data.totals ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="SKUs selling" value={String(data.totals.skuCount)} hint={`In the last ${data.lookbackDays} days`} />
            <Stat label="Units sold" value={fmtQty(data.totals.unitsSold, 0)} hint="Net of cancellation and refund" />
            <Stat label={`Forecast ${data.horizonDays}d`} value={fmtQty(data.totals.forecastQty, 0)} hint="Straight-line from velocity" />
            <Stat
              label="Thin history"
              value={String(data.totals.lowConfidence)}
              tone={data.totals.lowConfidence > 0 ? 'warn' : undefined}
              hint="Under half the weeks observed"
            />
          </div>

          <Card>
            <CardHeader
              title="By SKU"
              description="Weighted velocity counts the most recent week n times out of n — transparent enough to reproduce by hand, which is the point of a rule-based forecast."
            />
            {data.rows.length === 0 ? (
              <EmptyState title="Nothing sold in this window" description="Widen the lookback, or import more order history." />
            ) : (
              <>
<div className="border-b border-line px-5 py-3">
  <FilterBar {...ctl.barProps} search={ctl.barProps.search && { ...ctl.barProps.search, placeholder: 'SKU, product or style' }} />
</div>
<div className="scroll-x">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface-muted text-[12px] font-medium text-ink-muted">
                      <SortTh label="SKU" sortKey="sku" sort={ctl.sort} onSort={ctl.onSort} />
                      <SortTh label="Product" sortKey="product" sort={ctl.sort} onSort={ctl.onSort} />
                      <SortTh label="Sold" sortKey="sold" sort={ctl.sort} onSort={ctl.onSort} align="right" numeric />
                      <SortTh label="Per week" sortKey="week" sort={ctl.sort} onSort={ctl.onSort} align="right" numeric />
                      <SortTh label="Forecast" sortKey="forecast" sort={ctl.sort} onSort={ctl.onSort} align="right" numeric />
                      <SortTh label="On hand" sortKey="onhand" sort={ctl.sort} onSort={ctl.onSort} align="right" numeric />
                      <SortTh label="Confidence" sortKey="confidence" sort={ctl.sort} onSort={ctl.onSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {ctl.rows.map((r) => {
                      const short = Number(r.forecastQty) > Number(r.onHandQty);
                      return (
                        <tr key={r.productVariantId} className="border-b border-line last:border-0">
                          <td className="px-3 py-1.5 font-mono text-[12px]">{r.sku ?? '—'}</td>
                          <td className="px-3 py-1.5">
                            {r.productName ?? '—'}
                            {r.size || r.color ? (
                              <span className="ml-2 text-[12px] text-ink-subtle">
                                {[r.color, r.size].filter(Boolean).join(' · ')}
                              </span>
                            ) : null}
                          </td>
                          <td className="num px-3 py-1.5 text-right">{fmtQty(r.unitsSold, 0)}</td>
                          <td className="num px-3 py-1.5 text-right font-medium">{fmtQty(r.salesVelocity)}</td>
                          <td className="num px-3 py-1.5 text-right">{fmtQty(r.forecastQty, 0)}</td>
                          <td className={`num px-3 py-1.5 text-right ${short ? 'text-warn font-medium' : 'text-ink-muted'}`}>
                            {fmtQty(r.onHandQty, 0)}
                          </td>
                          <td className="px-3 py-1.5">
                            <Badge tone={Number(r.confidence) >= 0.5 ? 'outline' : 'warn'}>
                              {Math.round(Number(r.confidence) * 100)}% · {r.weeksObserved}w
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
</>
            )}
          </Card>

          <p className="text-[12px] text-ink-subtle">
            On-hand figures come from finished goods balances, which Phase 5 populates. Until finished
            goods inward is live they will read zero — that is missing data, not a stockout.
          </p>
        </>
      ) : null}
    </div>
  );
}
