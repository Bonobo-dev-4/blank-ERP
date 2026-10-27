'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtQty, humanise } from '@/lib/utils';
import {
  Badge, Card, CardHeader, EmptyState, ErrorPanel, LoadingBlock, PageHeader, Stat,
} from '@/components/ui/primitives';
import { FilterBar, SortTh, useTableControls } from '@/components/ui/table-controls';
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


  const ctl = useTableControls(rows, {
    search: (x) => `${x.code} ${x.name}`,
    filters: [{ key: 'kind', label: 'Kind', get: (x) => x.workerType, format: humanise }],
    sorts: {
      worker: (x) => x.name, kind: (x) => x.workerType, tasks: (x) => x.taskCount,
      taken: (x) => Number(x.receivedQty), completed: (x) => Number(x.completedQty), rejected: (x) => Number(x.rejectedQty),
      rework: (x) => Number(x.reworkOpenQty), quality: (x) => (x.qualityPct == null ? null : Number(x.qualityPct)),
    },
  });

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
          rows={() => ctl.rows.map((x) => [
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
              <>
<div className="border-b border-line px-5 py-3">
  <FilterBar {...ctl.barProps} search={ctl.barProps.search && { ...ctl.barProps.search, placeholder: 'Worker code or name' }} />
</div>
<div className="scroll-x">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface-muted text-[12px] font-medium text-ink-muted">
                      <SortTh label="Worker" sortKey="worker" sort={ctl.sort} onSort={ctl.onSort} />
                      <SortTh label="Kind" sortKey="kind" sort={ctl.sort} onSort={ctl.onSort} />
                      <SortTh label="Tasks" sortKey="tasks" sort={ctl.sort} onSort={ctl.onSort} align="right" numeric />
                      <SortTh label="Taken in" sortKey="taken" sort={ctl.sort} onSort={ctl.onSort} align="right" numeric />
                      <SortTh label="Completed" sortKey="completed" sort={ctl.sort} onSort={ctl.onSort} align="right" numeric />
                      <SortTh label="Rejected" sortKey="rejected" sort={ctl.sort} onSort={ctl.onSort} align="right" numeric />
                      <SortTh label="Rework open" sortKey="rework" sort={ctl.sort} onSort={ctl.onSort} align="right" numeric />
                      <SortTh label="Quality" sortKey="quality" sort={ctl.sort} onSort={ctl.onSort} align="right" numeric />
                    </tr>
                  </thead>
                  <tbody>
                    {ctl.rows.map((x) => (
                      <tr key={x.id} className={`border-b border-line last:border-0 ${x.hasActivity ? '' : 'opacity-55'}`}>
                        <td className="px-3 py-1.5">
                          <span className="font-mono text-[12px]">{x.code}</span>
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
</>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
