'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtQty, humanise } from '@/lib/utils';
import {
  Badge, Card, CardHeader, EmptyState, ErrorPanel, LoadingBlock, PageHeader, Stat,
} from '@/components/ui/primitives';
import { ExportCsvButton } from '@/components/ui/export-csv';
import { Figure, ReportWindow, lastDays, type Window } from '@/components/app/report-window';

interface Worker {
  id: string; code: string; name: string; workerType: string; status: string;
  taskCount: number; orderCount: number;
  receivedQty: string; completedQty: string; rejectedQty: string; reworkOpenQty: string;
  qualityPct: string | null; rejectionPct: string | null; hasActivity: boolean;
}
interface Report {
  window: { from: string | null; to: string | null };
  totals: { workerCount: number; activeCount: number; receivedQty: string; rejectedQty: string };
  workers: Worker[];
}

export default function JobWorkerReportPage() {
  const [w, setW] = React.useState<Window>(() => lastDays(30));
  const [showIdle, setShowIdle] = React.useState(false);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['report', 'job-workers', w],
    queryFn: () => api.get<Report>(`/reports/job-workers?from=${w.from}&to=${w.to}`),
  });

  const rows = (data?.workers ?? []).filter((x) => showIdle || x.hasActivity);
  const idle = (data?.workers.length ?? 0) - (data?.totals.activeCount ?? 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Job worker performance"
        description="Counted from the stage tasks assigned to each worker, which is where the work happened. An order can be raised and never worked, so order counts alone would flatter."
      />
      <ReportWindow value={w} onChange={setW}>
        <ExportCsvButton
          filename="job-worker-performance"
          disabled={rows.length === 0}
          headers={['Code', 'Worker', 'Kind', 'Tasks', 'Taken in', 'Completed', 'Rejected', 'Rework open', 'Quality %']}
          rows={() => rows.map((x) => [
            x.code, x.name, x.workerType, x.taskCount, x.receivedQty,
            x.completedQty, x.rejectedQty, x.reworkOpenQty, x.qualityPct,
          ])}
        />
        {idle > 0 ? (
          <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-muted">
            <input
              type="checkbox"
              checked={showIdle}
              onChange={(e) => setShowIdle(e.target.checked)}
              className="size-3.5 accent-brand"
            />
            Show {idle} with no activity
          </label>
        ) : null}
      </ReportWindow>

      {isLoading ? <LoadingBlock label="Running the report" /> : null}
      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} /> : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Workers" value={String(data.totals.workerCount)} hint="On the master" />
            <Stat label="Active" value={String(data.totals.activeCount)} hint="Took in work in this window" />
            <Stat label="Taken in" value={fmtQty(data.totals.receivedQty, 0)} hint="Units across active workers" />
            <Stat
              label="Rejected"
              value={fmtQty(data.totals.rejectedQty, 0)}
              tone={Number(data.totals.rejectedQty) > 0 ? 'danger' : 'ok'}
              hint="Units rejected at their stages"
            />
          </div>

          <Card>
            <CardHeader
              title="By worker"
              description="Quality is work completed without going back for rework, as a share of what they took in."
            />
            {rows.length === 0 ? (
              <EmptyState
                title="No job worker activity in this window"
                description="Assign a stage task to a job worker, or widen the date range."
              />
            ) : (
              <div className="scroll-x">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface-muted text-[11px] uppercase tracking-wide text-ink-muted">
                      <th className="px-3 py-1.5 text-left font-semibold">Worker</th>
                      <th className="px-3 py-1.5 text-left font-semibold">Kind</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Tasks</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Taken in</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Completed</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Rejected</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Rework open</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Quality</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((x) => (
                      <tr key={x.id} className={`border-b border-line last:border-0 ${x.hasActivity ? '' : 'opacity-55'}`}>
                        <td className="px-3 py-1.5">
                          <span className="font-mono text-[11.5px]">{x.code}</span>
                          <span className="ml-2 font-medium">{x.name}</span>
                        </td>
                        <td className="px-3 py-1.5">
                          <Badge tone="outline">{humanise(x.workerType)}</Badge>
                        </td>
                        <td className="num px-3 py-1.5 text-right text-ink-muted">{x.taskCount}</td>
                        <td className="num px-3 py-1.5 text-right">{fmtQty(x.receivedQty, 0)}</td>
                        <td className="num px-3 py-1.5 text-right">{fmtQty(x.completedQty, 0)}</td>
                        <td className={`num px-3 py-1.5 text-right ${Number(x.rejectedQty) > 0 ? 'text-danger' : 'text-ink-subtle'}`}>
                          {fmtQty(x.rejectedQty, 0)}
                        </td>
                        <td className={`num px-3 py-1.5 text-right ${Number(x.reworkOpenQty) > 0 ? 'text-warn' : 'text-ink-subtle'}`}>
                          {fmtQty(x.reworkOpenQty, 0)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-medium">
                          <Figure value={x.qualityPct} suffix="%" />
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
