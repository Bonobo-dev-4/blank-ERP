'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { ScanSearch } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtQty } from '@/lib/utils';
import {
  Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorPanel, Field, LoadingBlock,
  NativeSelect, PageHeader, Stat,
} from '@/components/ui/primitives';

interface Row {
  sku: string; productName: string | null;
  erpQty: string; externalQty: string | null; varianceQty: string | null;
  isMatched: boolean; recommendation: string;
}
interface Result {
  available: boolean; reason: string | null; facilityCode: string | null;
  rows: Row[];
  totals: { compared: number; matched: number; shortfall: number; overage: number; unreadable: number } | null;
}

const VERDICT: Record<string, { label: string; tone: 'ok' | 'warn' | 'danger' | 'outline' }> = {
  MARK_RECONCILED: { label: 'Matches', tone: 'ok' },
  RETRY_SHORTFALL: { label: 'Short externally', tone: 'warn' },
  INVESTIGATE_OVERAGE: { label: 'Overage — investigate', tone: 'danger' },
  UNREADABLE: { label: 'Could not read', tone: 'outline' },
};

export default function ReconciliationPage() {
  const [limit, setLimit] = React.useState('25');
  const run = useMutation({
    mutationFn: () => api.get<Result>(`/sync/reconciliation?limit=${limit}`),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="External reconciliation"
        description="Does Unicommerce agree with what we hold? Read-only, and it works today — the comparison needs no write access."
      />

      <Card>
        <CardHeader
          title="Run a comparison"
          description="Checks one SKU at a time against the default facility, so a wide run takes a few seconds."
        />
        <CardBody>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="SKUs to compare" className="w-[150px]">
              <NativeSelect value={limit} onChange={(e) => setLimit(e.target.value)}>
                <option value="10">Top 10</option>
                <option value="25">Top 25</option>
                <option value="50">Top 50</option>
              </NativeSelect>
            </Field>
            <Button onClick={() => run.mutate()} disabled={run.isPending}>
              <ScanSearch /> {run.isPending ? 'Comparing…' : 'Compare with Unicommerce'}
            </Button>
          </div>
        </CardBody>
      </Card>

      {run.isPending ? <LoadingBlock label="Reading external stock" /> : null}
      {run.error ? <ErrorPanel error={run.error} /> : null}

      {run.data && !run.data.available ? (
        <EmptyState title="Unicommerce is not connected" description={run.data.reason ?? ''} />
      ) : null}

      {run.data?.available && run.data.totals ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Compared" value={String(run.data.totals.compared)} hint={`Facility ${run.data.facilityCode}`} />
            <Stat label="Matching" value={String(run.data.totals.matched)} tone="ok" hint="Both systems agree" />
            <Stat
              label="Short externally"
              value={String(run.data.totals.shortfall)}
              tone={run.data.totals.shortfall > 0 ? 'warn' : 'ok'}
              hint="We hold more than Unicommerce"
            />
            <Stat
              label="Overage"
              value={String(run.data.totals.overage)}
              tone={run.data.totals.overage > 0 ? 'danger' : 'ok'}
              hint="Unicommerce holds more — investigate"
            />
          </div>

          <Card>
            <CardHeader
              title="Line by line"
              description="An overage is never corrected automatically: it means stock was credited more than once, and adjusting it down would hide the defect that caused it."
            />
            {run.data.rows.length === 0 ? (
              <EmptyState
                title="No finished stock to compare"
                description="Receive garments into finished stock first — there is nothing to reconcile against."
              />
            ) : (
              <div className="scroll-x">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface-muted text-[11px] uppercase tracking-wide text-ink-muted">
                      <th className="px-3 py-1.5 text-left font-semibold">SKU</th>
                      <th className="px-3 py-1.5 text-left font-semibold">Product</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Here</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Unicommerce</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Variance</th>
                      <th className="px-3 py-1.5 text-left font-semibold">Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.data.rows.map((r) => {
                      const v = VERDICT[r.recommendation] ?? VERDICT.UNREADABLE;
                      return (
                        <tr key={r.sku} className="border-b border-line last:border-0">
                          <td className="px-3 py-1.5 font-mono text-[11.5px]">{r.sku}</td>
                          <td className="px-3 py-1.5">{r.productName ?? '—'}</td>
                          <td className="num px-3 py-1.5 text-right">{fmtQty(r.erpQty, 0)}</td>
                          <td className="num px-3 py-1.5 text-right">
                            {r.externalQty === null
                              ? <span className="text-ink-subtle">not readable</span>
                              : fmtQty(r.externalQty, 0)}
                          </td>
                          <td className={`num px-3 py-1.5 text-right font-medium ${
                            r.varianceQty === null ? 'text-ink-subtle'
                              : Number(r.varianceQty) === 0 ? 'text-ink-subtle'
                              : Number(r.varianceQty) > 0 ? 'text-danger' : 'text-warn'
                          }`}>
                            {r.varianceQty === null ? '—' : `${Number(r.varianceQty) > 0 ? '+' : ''}${fmtQty(r.varianceQty, 0)}`}
                          </td>
                          <td className="px-3 py-1.5"><Badge tone={v.tone}>{v.label}</Badge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {run.data.totals.unreadable > 0 ? (
              <CardBody className="text-[11.5px] text-ink-muted">
                {run.data.totals.unreadable} SKUs could not be read at that facility. They are reported
                as unreadable rather than as zero — treating the two alike would invent a variance.
              </CardBody>
            ) : null}
          </Card>
        </>
      ) : null}
    </div>
  );
}
