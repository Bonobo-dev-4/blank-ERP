'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowRightLeft } from 'lucide-react';
import { JOB_WORK_ORDER_STATUSES } from '@dnd/contracts';
import { api } from '@/lib/api';
import { useListQuery, useListState, paginationProps } from '@/lib/hooks';
import { fmtDate, fmtMoney, fmtQty, humanise, newIdempotencyKey } from '@/lib/utils';
import {
  Badge, Button, ErrorPanel, Field, NativeSelect, PageHeader, QtyInput, StatusBadge, Textarea,
} from '@/components/ui/primitives';
import { CodeCell, DataTable, StackedCell } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useAuth } from '@/components/app/auth-context';

interface JobWorkLine {
  id: string; productionBatchId: string; assignedQty: string; receivedQty: string;
  completedQty: string; rejectedQty: string; reworkQty: string; lineCharge: string;
  productionBatch: { id: string; batchNo: string };
}

interface JobWorkRow {
  id: string; jobWorkOrderNo: string; status: string;
  assignedQty: string; receivedQty: string; completedQty: string; rejectedQty: string;
  ratePerPiece: string; totalCharge: string; pendingQty: string;
  dueDate: string | null; isOverdue: boolean;
  jobWorker: { id: string; code: string; name: string; kind: string };
  productionStage: { id: string; code: string; name: string };
  manufacturingOrder: { id: string; moNo: string };
  lines: JobWorkLine[];
}

/**
 * Work that leaves the building.
 *
 * A job worker holds garments the factory is still responsible for, so the
 * quantities move the same stage counters an in-house step does. The only
 * difference is that a charge comes back with them.
 */
export default function HandoverPage() {
  const { can } = useAuth();
  const [receiving, setReceiving] = React.useState<JobWorkRow | null>(null);
  const state = useListState({});

  const { data, isLoading, isFetching, error, refetch } = useListQuery<JobWorkRow>(
    'job-work-orders', '/job-work/orders', state,
  );

  const columns = React.useMemo<ColumnDef<JobWorkRow, unknown>[]>(
    () => [
      {
        id: 'jobWorkOrderNo', header: 'Order', accessorKey: 'jobWorkOrderNo',
        cell: ({ row }) => <CodeCell>{row.original.jobWorkOrderNo}</CodeCell>,
      },
      {
        id: 'worker', header: 'Job worker', accessorFn: (r) => r.jobWorker.name,
        cell: ({ row }) => (
          <StackedCell primary={row.original.jobWorker.name} secondary={row.original.jobWorker.code} />
        ),
      },
      {
        id: 'stage', header: 'Stage', accessorFn: (r) => r.productionStage.code,
        cell: ({ row }) => <Badge tone="info">{row.original.productionStage.name}</Badge>,
      },
      {
        id: 'order', header: 'Order', accessorFn: (r) => r.manufacturingOrder.moNo,
        cell: ({ row }) => <span className="text-ink-muted">{row.original.manufacturingOrder.moNo}</span>,
      },
      {
        id: 'assigned', header: 'Sent', accessorKey: 'assignedQty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => <span className="font-medium">{fmtQty(row.original.assignedQty, 0)}</span>,
      },
      {
        id: 'pending', header: 'Still out', accessorKey: 'pendingQty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) =>
          Number(row.original.pendingQty) > 0
            ? <span className="text-warn">{fmtQty(row.original.pendingQty, 0)}</span>
            : <span className="text-ink-subtle">—</span>,
      },
      {
        id: 'completed', header: 'Good back', accessorKey: 'completedQty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => fmtQty(row.original.completedQty, 0),
      },
      {
        id: 'rejected', header: 'Rejected', accessorKey: 'rejectedQty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) =>
          Number(row.original.rejectedQty) > 0
            ? <span className="text-danger">{fmtQty(row.original.rejectedQty, 0)}</span>
            : <span className="text-ink-subtle">—</span>,
      },
      {
        id: 'rate', header: 'Rate', accessorKey: 'ratePerPiece',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => fmtMoney(row.original.ratePerPiece),
      },
      {
        id: 'charge', header: 'Charge', accessorKey: 'totalCharge',
        meta: { align: 'right', numeric: true },
        // Charged on good pieces only.
        cell: ({ row }) => <span className="font-medium">{fmtMoney(row.original.totalCharge)}</span>,
      },
      {
        id: 'dueDate', header: 'Due', accessorKey: 'dueDate',
        cell: ({ row }) => (
          <span className={row.original.isOverdue ? 'font-medium text-danger' : 'text-ink-muted'}>
            {fmtDate(row.original.dueDate)}
          </span>
        ),
      },
      { id: 'status', header: 'Status', accessorKey: 'status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      {
        id: 'act', header: '',
        cell: ({ row }) =>
          can('production.record_stage') && ['ISSUED', 'PARTIALLY_RECEIVED'].includes(row.original.status) ? (
            <Button onClick={() => setReceiving(row.original)}>Receive</Button>
          ) : null,
      },
    ],
    [can],
  );

  return (
    <div>
      <PageHeader
        title="Production Handover"
        description="Work out with job workers. The garments are still the factory's responsibility and still counted against their batch, so receiving them moves the stage counters exactly as an in-house step would — and the charge is computed on good pieces only."
      />

      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} className="mb-3" /> : null}

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        isFetching={isFetching}
        pagination={paginationProps(data, state)}
        search={{ value: state.search, onChange: state.setSearch, placeholder: 'Job work order number' }}
        exportFileName="job-work-orders"
        emptyTitle="Nothing is out with a job worker"
        emptyDescription="Send work out from a batch at a stage configured to allow job work."
        toolbar={
          <>
            <NativeSelect
              value={String(state.filters.status ?? '')}
              onChange={(e) => state.setFilter('status', e.target.value || undefined)}
              className="w-auto"
              aria-label="Status"
            >
              <option value="">Any status</option>
              {JOB_WORK_ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>{humanise(s)}</option>
              ))}
            </NativeSelect>
            <label className="flex items-center gap-1.5 whitespace-nowrap text-[12px] text-ink-muted">
              <input
                type="checkbox"
                checked={Boolean(state.filters.overdueOnly)}
                onChange={(e) => state.setFilter('overdueOnly', e.target.checked || undefined)}
              />
              Overdue only
            </label>
          </>
        }
      />

      {receiving ? <ReceiveDialog order={receiving} onClose={() => setReceiving(null)} /> : null}
    </div>
  );
}

function ReceiveDialog({ order, onClose }: { order: JobWorkRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [lines, setLines] = React.useState(() =>
    order.lines.map((l) => ({
      productionBatchId: l.productionBatchId,
      batchNo: l.productionBatch.batchNo,
      outstanding: String(Number(l.assignedQty) - Number(l.receivedQty)),
      completedQty: String(Number(l.assignedQty) - Number(l.receivedQty)),
      rejectedQty: '',
      rejectionReason: '',
    })),
  );

  const receive = useMutation({
    mutationFn: () =>
      api.post(`/job-work/orders/${order.id}/receive`, {
        idempotencyKey: newIdempotencyKey(),
        lines: lines
          .filter((l) => Number(l.completedQty) + Number(l.rejectedQty) > 0)
          .map((l) => ({
            productionBatchId: l.productionBatchId,
            completedQty: l.completedQty || '0',
            rejectedQty: l.rejectedQty || '0',
            rejectionReason: Number(l.rejectedQty) > 0 ? l.rejectionReason : null,
          })),
      }),
    onSuccess: () => {
      toast.success('Work received');
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const patch = (i: number, next: Partial<(typeof lines)[number]>) =>
    setLines((x) => x.map((y, j) => (j === i ? { ...y, ...next } : y)));

  const anyOver = lines.some(
    (l) => Number(l.completedQty || 0) + Number(l.rejectedQty || 0) > Number(l.outstanding),
  );
  const needsReason = lines.some((l) => Number(l.rejectedQty) > 0 && l.rejectionReason.trim().length === 0);
  const anything = lines.some((l) => Number(l.completedQty || 0) + Number(l.rejectedQty || 0) > 0);

  const goodTotal = lines.reduce((a, l) => a + Number(l.completedQty || 0), 0);
  const charge = goodTotal * Number(order.ratePerPiece);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Receive ${order.jobWorkOrderNo} from ${order.jobWorker.name}`}
        footer={
          <>
            <Button onClick={onClose} disabled={receive.isPending}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!anything || anyOver || needsReason}
              loading={receive.isPending}
              onClick={() => receive.mutate()}
            >
              Receive
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {receive.error ? <ErrorPanel error={receive.error} /> : null}

          {lines.map((l, i) => (
            <div key={l.productionBatchId} className="rounded border border-line p-2.5">
              <div className="mb-2 flex items-center justify-between">
                <CodeCell>{l.batchNo}</CodeCell>
                <span className="text-[12px] text-ink-muted">{fmtQty(l.outstanding, 0)} still out</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Good pieces">
                  <QtyInput value={l.completedQty} onChange={(e) => patch(i, { completedQty: e.target.value })} />
                </Field>
                <Field label="Rejected">
                  <QtyInput
                    value={l.rejectedQty}
                    onChange={(e) => patch(i, { rejectedQty: e.target.value })}
                    placeholder="0"
                  />
                </Field>
              </div>
              {Number(l.rejectedQty) > 0 ? (
                <Field label="Why were they rejected?" required className="mt-2">
                  <Textarea
                    value={l.rejectionReason}
                    onChange={(e) => patch(i, { rejectionReason: e.target.value })}
                    rows={2}
                  />
                </Field>
              ) : null}
            </div>
          ))}

          {anyOver ? (
            <p className="text-[12.5px] text-danger">
              One or more lines receive more than was sent out.
            </p>
          ) : null}

          <p className="flex items-start gap-1.5 rounded border border-line bg-surface-muted px-2.5 py-2 text-[12px] text-ink-muted">
            <ArrowRightLeft className="mt-0.5 size-3.5 shrink-0" />
            Charge for this receipt: {fmtMoney(String(charge))} — {goodTotal} good pieces at{' '}
            {fmtMoney(order.ratePerPiece)} each. Rejected pieces are not charged.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
