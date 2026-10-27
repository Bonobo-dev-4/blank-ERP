'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtQty, uomShort } from '@/lib/utils';
import {
  Badge, Card, CardHeader, EmptyState, ErrorPanel, Label, LoadingBlock, NativeSelect,
  PageHeader, Stat,
} from '@/components/ui/primitives';

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
              <div className="scroll-x">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface-muted text-[12px] font-medium text-ink-muted">
                      <th className="px-3 py-1.5 text-left font-semibold">Material</th>
                      <th className="px-3 py-1.5 text-left font-semibold">Supplier</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Per week</th>
                      <th className="px-3 py-1.5 text-right font-semibold">On hand</th>
                      <th className="px-3 py-1.5 text-right font-semibold">On order</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Target</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Order</th>
                      <th className="px-3 py-1.5 text-left font-semibold">Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
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
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
