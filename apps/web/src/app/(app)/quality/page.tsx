'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { ClipboardCheck, Plus } from 'lucide-react';
import { DEFECT_CATEGORIES, DEFECT_SEVERITIES, INSPECTION_RESULTS, QC_KINDS } from '@dnd/contracts';
import { api, type Paginated } from '@/lib/api';
import { useListQuery, useListState, paginationProps } from '@/lib/hooks';
import { fmtDateTime, fmtQty, humanise, newIdempotencyKey } from '@/lib/utils';
import {
  Badge, Button, ErrorPanel, Field, NativeSelect, PageHeader, QtyInput, StatusBadge, Textarea,
} from '@/components/ui/primitives';
import { CodeCell, DataTable, StackedCell } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useAuth } from '@/components/app/auth-context';

interface Defect {
  id: string; category: string; qty: string; severity: string | null; description: string | null;
}

interface InspectionRow {
  id: string; inspectionNo: string; kind: string; result: string; inspectedAt: string;
  inspectedQty: string; passedQty: string; failedQty: string; reworkQty: string; holdQty: string;
  remarks: string | null;
  defects: Defect[];
  productionBatch: { id: string; batchNo: string } | null;
  productionStage: { id: string; code: string; name: string } | null;
  manufacturingOrder: { id: string; moNo: string };
  inspector: { id: string; fullName: string; employeeCode: string | null } | null;
  _count?: { reworkOrders: number };
}

interface BatchOption {
  id: string; batchNo: string;
  manufacturingOrder: { moNo: string };
  progress: { inProgressQty: string; currentStageCode: string | null };
  stageTasks: { id: string; wipQty: string; productionStage: { code: string; name: string } }[];
}

const RESULT_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'neutral'> = {
  PASS: 'ok', REWORK: 'warn', HOLD: 'warn', FAIL: 'danger',
};

export default function QualityPage() {
  const { can } = useAuth();
  const [recording, setRecording] = React.useState(false);
  const state = useListState({});

  const { data, isLoading, isFetching, error, refetch } = useListQuery<InspectionRow>(
    'inspections', '/quality/inspections', state,
  );

  const columns = React.useMemo<ColumnDef<InspectionRow, unknown>[]>(
    () => [
      {
        id: 'inspectionNo', header: 'Inspection', accessorKey: 'inspectionNo',
        cell: ({ row }) => <CodeCell>{row.original.inspectionNo}</CodeCell>,
      },
      {
        id: 'batch', header: 'Batch', accessorFn: (r) => r.productionBatch?.batchNo ?? '',
        cell: ({ row }) => (
          <StackedCell
            primary={row.original.productionBatch?.batchNo ?? '—'}
            secondary={row.original.manufacturingOrder.moNo}
          />
        ),
      },
      {
        id: 'stage', header: 'Stage', accessorFn: (r) => r.productionStage?.code ?? '',
        cell: ({ row }) => (
          <span className="text-ink-muted">{row.original.productionStage?.name ?? '—'}</span>
        ),
      },
      {
        id: 'inspected', header: 'Inspected', accessorKey: 'inspectedQty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => <span className="font-medium">{fmtQty(row.original.inspectedQty, 0)}</span>,
      },
      {
        id: 'passed', header: 'Passed', accessorKey: 'passedQty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => <span className="text-ok">{fmtQty(row.original.passedQty, 0)}</span>,
      },
      {
        id: 'failed', header: 'Failed', accessorKey: 'failedQty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) =>
          Number(row.original.failedQty) > 0
            ? <span className="text-danger">{fmtQty(row.original.failedQty, 0)}</span>
            : <span className="text-ink-subtle">—</span>,
      },
      {
        id: 'rework', header: 'Rework', accessorKey: 'reworkQty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) =>
          Number(row.original.reworkQty) > 0
            ? <span className="text-warn">{fmtQty(row.original.reworkQty, 0)}</span>
            : <span className="text-ink-subtle">—</span>,
      },
      {
        id: 'hold', header: 'Hold', accessorKey: 'holdQty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) =>
          Number(row.original.holdQty) > 0
            ? fmtQty(row.original.holdQty, 0)
            : <span className="text-ink-subtle">—</span>,
      },
      {
        id: 'defects', header: 'Defects', accessorFn: (r) => r.defects.length,
        cell: ({ row }) =>
          row.original.defects.length === 0 ? (
            <span className="text-ink-subtle">—</span>
          ) : (
            <span className="block max-w-[220px] truncate text-[12px] text-ink-muted">
              {row.original.defects
                .map((d) => `${humanise(d.category)} ${fmtQty(d.qty, 0)}`)
                .join(', ')}
            </span>
          ),
      },
      {
        id: 'inspector', header: 'Inspector', accessorFn: (r) => r.inspector?.fullName ?? '',
        cell: ({ row }) => (
          <StackedCell
            primary={row.original.inspector?.fullName ?? '—'}
            secondary={fmtDateTime(row.original.inspectedAt)}
          />
        ),
      },
      {
        id: 'result', header: 'Result', accessorKey: 'result',
        cell: ({ row }) => (
          <Badge tone={RESULT_TONE[row.original.result] ?? 'neutral'}>{humanise(row.original.result)}</Badge>
        ),
      },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="Quality Control"
        description="Passed, failed, rework and hold must add up to exactly the quantity inspected — a garment that was looked at has an outcome. The verdict moves the stage counters itself, so QC and the floor can never report different numbers for the same garments."
        actions={
          can('quality.inspect') ? (
            <Button variant="primary" onClick={() => setRecording(true)}>
              <Plus />
              Record inspection
            </Button>
          ) : null
        }
      />

      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} className="mb-3" /> : null}

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        isFetching={isFetching}
        pagination={paginationProps(data, state)}
        search={{ value: state.search, onChange: state.setSearch, placeholder: 'Inspection number' }}
        exportFileName="quality-inspections"
        emptyTitle="No inspections yet"
        emptyDescription="Inspections are recorded against a batch at the route step holding the work."
        toolbar={
          <>
            <NativeSelect
              value={String(state.filters.result ?? '')}
              onChange={(e) => state.setFilter('result', e.target.value || undefined)}
              className="w-auto"
              aria-label="Result"
            >
              <option value="">Any result</option>
              {INSPECTION_RESULTS.map((r) => (
                <option key={r} value={r}>{humanise(r)}</option>
              ))}
            </NativeSelect>
            <NativeSelect
              value={String(state.filters.kind ?? '')}
              onChange={(e) => state.setFilter('kind', e.target.value || undefined)}
              className="w-auto"
              aria-label="Kind"
            >
              <option value="">Any kind</option>
              {QC_KINDS.map((k) => (
                <option key={k} value={k}>{humanise(k)}</option>
              ))}
            </NativeSelect>
          </>
        }
      />

      <RecordInspectionDialog open={recording} onOpenChange={setRecording} />
    </div>
  );
}

/**
 * Record an inspection.
 *
 * The split is validated as the inspector types, because the server will
 * refuse an incomplete one and finding that out after filling in the defects
 * is worse than being told up front.
 */
function RecordInspectionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [batchId, setBatchId] = React.useState('');
  const [stageTaskId, setStageTaskId] = React.useState('');
  const [inspected, setInspected] = React.useState('');
  const [passed, setPassed] = React.useState('');
  const [failed, setFailed] = React.useState('');
  const [rework, setRework] = React.useState('');
  const [hold, setHold] = React.useState('');
  const [remarks, setRemarks] = React.useState('');
  const [defects, setDefects] = React.useState<
    { key: string; category: string; qty: string; severity: string; description: string }[]
  >([]);

  const batches = useQuery({
    queryKey: ['batches', 'qc-picker'],
    queryFn: () => api.get<Paginated<BatchOption>>('/production/batches', { pageSize: 100 }),
    enabled: open,
  });

  const batch = (batches.data?.data ?? []).find((b) => b.id === batchId);
  const steps = (batch?.stageTasks ?? []).filter((t) => Number(t.wipQty) > 0);
  const chosenStep = steps.find((s) => s.id === stageTaskId) ?? steps[0];

  React.useEffect(() => {
    if (!open) return;
    setBatchId(''); setStageTaskId(''); setInspected(''); setPassed('');
    setFailed(''); setRework(''); setHold(''); setRemarks(''); setDefects([]);
  }, [open]);

  React.useEffect(() => {
    // Default to inspecting everything the step is holding, all passing.
    if (chosenStep) {
      setStageTaskId(chosenStep.id);
      setInspected(chosenStep.wipQty);
      setPassed(chosenStep.wipQty);
    }
  }, [chosenStep]);

  const record = useMutation({
    mutationFn: () =>
      api.post('/quality/inspections', {
        idempotencyKey: newIdempotencyKey(),
        kind: 'INLINE_STAGE',
        productionBatchId: batchId,
        stageTaskId: stageTaskId || null,
        inspectedQty: inspected,
        passedQty: passed || '0',
        failedQty: failed || '0',
        reworkQty: rework || '0',
        holdQty: hold || '0',
        remarks: remarks || null,
        defects: defects
          .filter((d) => Number(d.qty) > 0)
          .map((d) => ({
            category: d.category,
            qty: d.qty,
            severity: d.severity,
            description: d.description || null,
          })),
      }),
    onSuccess: () => {
      toast.success('Inspection recorded');
      void queryClient.invalidateQueries();
      onOpenChange(false);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const split = Number(passed || 0) + Number(failed || 0) + Number(rework || 0) + Number(hold || 0);
  const total = Number(inspected || 0);
  const balances = total > 0 && split === total;
  const notAccepted = Number(failed || 0) + Number(rework || 0);
  const needsDefect = notAccepted > 0 && defects.filter((d) => Number(d.qty) > 0).length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Record an inspection"
        footer={
          <>
            <Button onClick={() => onOpenChange(false)} disabled={record.isPending}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!batchId || !balances || needsDefect}
              loading={record.isPending}
              onClick={() => record.mutate()}
            >
              Record
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {record.error ? <ErrorPanel error={record.error} /> : null}

          <Field label="Batch" required>
            <NativeSelect value={batchId} onChange={(e) => { setBatchId(e.target.value); setStageTaskId(''); }}>
              <option value="">Select a batch</option>
              {(batches.data?.data ?? [])
                .filter((b) => Number(b.progress.inProgressQty) > 0)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.batchNo} — {b.manufacturingOrder.moNo} ({fmtQty(b.progress.inProgressQty, 0)} in progress)
                  </option>
                ))}
            </NativeSelect>
          </Field>

          {batch ? (
            steps.length === 0 ? (
              <p className="rounded border border-line bg-surface-muted px-2.5 py-2 text-[12.5px] text-ink-muted">
                No route step on this batch is holding work to inspect.
              </p>
            ) : (
              <Field label="Route step" required>
                <NativeSelect value={stageTaskId} onChange={(e) => setStageTaskId(e.target.value)}>
                  {steps.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.productionStage.name} — {fmtQty(s.wipQty, 0)} in hand
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )
          ) : null}

          <div className="grid gap-2 sm:grid-cols-5">
            <Field label="Inspected" required>
              <QtyInput value={inspected} onChange={(e) => setInspected(e.target.value)} />
            </Field>
            <Field label="Passed"><QtyInput value={passed} onChange={(e) => setPassed(e.target.value)} /></Field>
            <Field label="Failed"><QtyInput value={failed} onChange={(e) => setFailed(e.target.value)} /></Field>
            <Field label="Rework"><QtyInput value={rework} onChange={(e) => setRework(e.target.value)} /></Field>
            <Field label="Hold"><QtyInput value={hold} onChange={(e) => setHold(e.target.value)} /></Field>
          </div>

          {total > 0 && !balances ? (
            <p className="text-[12.5px] text-danger">
              Passed, failed, rework and hold add up to {split}, not {total}. Every garment you looked at
              needs an outcome.
            </p>
          ) : null}

          {notAccepted > 0 ? (
            <div className="space-y-1.5 rounded border border-line bg-surface-muted p-2">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium text-ink">
                  Defects — {notAccepted} garment(s) were not accepted
                </span>
                <Button
                  onClick={() =>
                    setDefects((d) => [
                      ...d,
                      {
                        key: Math.random().toString(36).slice(2),
                        category: 'STITCHING', qty: String(notAccepted),
                        severity: 'MINOR', description: '',
                      },
                    ])
                  }
                >
                  <Plus />
                  Defect
                </Button>
              </div>
              {needsDefect ? (
                <p className="text-[12px] text-danger">
                  A failure or rework needs at least one recorded defect — that record is what makes the
                  cause traceable later.
                </p>
              ) : null}
              {defects.map((d, i) => (
                <div key={d.key} className="grid gap-1.5 sm:grid-cols-[1fr_80px_100px_1fr]">
                  <NativeSelect
                    value={d.category}
                    onChange={(e) =>
                      setDefects((x) => x.map((y, j) => (j === i ? { ...y, category: e.target.value } : y)))
                    }
                    aria-label="Defect category"
                  >
                    {DEFECT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{humanise(c)}</option>
                    ))}
                  </NativeSelect>
                  <QtyInput
                    value={d.qty}
                    onChange={(e) => setDefects((x) => x.map((y, j) => (j === i ? { ...y, qty: e.target.value } : y)))}
                    aria-label="Defect quantity"
                  />
                  <NativeSelect
                    value={d.severity}
                    onChange={(e) =>
                      setDefects((x) => x.map((y, j) => (j === i ? { ...y, severity: e.target.value } : y)))
                    }
                    aria-label="Severity"
                  >
                    {DEFECT_SEVERITIES.map((sv) => (
                      <option key={sv} value={sv}>{humanise(sv)}</option>
                    ))}
                  </NativeSelect>
                  <input
                    value={d.description}
                    onChange={(e) =>
                      setDefects((x) => x.map((y, j) => (j === i ? { ...y, description: e.target.value } : y)))
                    }
                    placeholder="What was wrong"
                    aria-label="Defect description"
                    className="h-8 rounded border border-line bg-surface px-2 text-[12.5px] text-ink outline-none focus:border-brand"
                  />
                </div>
              ))}
            </div>
          ) : null}

          <Field label="Remarks">
            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} />
          </Field>

          <p className="flex items-start gap-1.5 rounded border border-line bg-surface-muted px-2.5 py-2 text-[12px] text-ink-muted">
            <ClipboardCheck className="mt-0.5 size-3.5 shrink-0" />
            Passed garments complete the step. Failed ones are rejected there. Rework leaves work in
            progress until a ticket brings it back. Held garments stay exactly where they are.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
