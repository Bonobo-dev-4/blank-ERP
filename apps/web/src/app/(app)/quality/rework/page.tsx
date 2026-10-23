'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, RotateCcw } from 'lucide-react';
import { REWORK_ORDER_STATUSES } from '@dnd/contracts';
import { api, type Paginated } from '@/lib/api';
import { useListQuery, useListState, paginationProps } from '@/lib/hooks';
import { fmtDate, fmtQty, humanise, newIdempotencyKey } from '@/lib/utils';
import {
  Badge, Button, ErrorPanel, Field, NativeSelect, PageHeader, QtyInput, StatusBadge, Textarea,
} from '@/components/ui/primitives';
import { CodeCell, DataTable, StackedCell } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useAuth } from '@/components/app/auth-context';

interface ReworkRow {
  id: string; reworkOrderNo: string; status: string; qty: string;
  completedQty: string; scrappedQty: string; openQty: string;
  reason: string | null; dueDate: string | null; isOverdue: boolean;
  productionBatch: {
    id: string; batchNo: string;
    manufacturingOrder: { id: string; moNo: string };
    manufacturingOrderItem: { size: string | null; productVariant: { sku: string } };
  };
  qualityInspection: { id: string; inspectionNo: string; result: string } | null;
  assignedJobWorker: { id: string; code: string; name: string } | null;
}

interface BatchOption {
  id: string; batchNo: string;
  manufacturingOrder: { moNo: string };
  progress: { reworkOutstandingQty: string };
}

export default function ReworkPage() {
  const { can } = useAuth();
  const [raising, setRaising] = React.useState(false);
  const [closing, setClosing] = React.useState<ReworkRow | null>(null);
  const state = useListState({});

  const { data, isLoading, isFetching, error, refetch } = useListQuery<ReworkRow>(
    'rework-orders', '/quality/rework', state,
  );

  const columns = React.useMemo<ColumnDef<ReworkRow, unknown>[]>(
    () => [
      {
        id: 'reworkOrderNo', header: 'Ticket', accessorKey: 'reworkOrderNo',
        cell: ({ row }) => <CodeCell>{row.original.reworkOrderNo}</CodeCell>,
      },
      {
        id: 'batch', header: 'Batch', accessorFn: (r) => r.productionBatch.batchNo,
        cell: ({ row }) => (
          <StackedCell
            primary={row.original.productionBatch.batchNo}
            secondary={`${row.original.productionBatch.manufacturingOrder.moNo} · ${
              row.original.productionBatch.manufacturingOrderItem.productVariant.sku
            }`}
          />
        ),
      },
      {
        id: 'qty', header: 'Raised for', accessorKey: 'qty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => <span className="font-medium">{fmtQty(row.original.qty, 0)}</span>,
      },
      {
        id: 'open', header: 'Still open', accessorKey: 'openQty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) =>
          Number(row.original.openQty) > 0
            ? <span className="text-warn">{fmtQty(row.original.openQty, 0)}</span>
            : <span className="text-ink-subtle">—</span>,
      },
      {
        id: 'fixed', header: 'Fixed', accessorKey: 'completedQty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) =>
          Number(row.original.completedQty) > 0
            ? <span className="text-ok">{fmtQty(row.original.completedQty, 0)}</span>
            : <span className="text-ink-subtle">—</span>,
      },
      {
        id: 'scrapped', header: 'Scrapped', accessorKey: 'scrappedQty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) =>
          Number(row.original.scrappedQty) > 0
            ? <span className="text-danger">{fmtQty(row.original.scrappedQty, 0)}</span>
            : <span className="text-ink-subtle">—</span>,
      },
      {
        id: 'reason', header: 'Reason', accessorKey: 'reason',
        cell: ({ row }) => (
          <span className="block max-w-[240px] truncate text-[12px] text-ink-muted">
            {row.original.reason ?? '—'}
          </span>
        ),
      },
      {
        id: 'from', header: 'From', accessorFn: (r) => r.qualityInspection?.inspectionNo ?? '',
        cell: ({ row }) =>
          row.original.qualityInspection ? (
            <CodeCell>{row.original.qualityInspection.inspectionNo}</CodeCell>
          ) : (
            <span className="text-ink-subtle">—</span>
          ),
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
          can('quality.manage_rework') && ['OPEN', 'IN_PROGRESS'].includes(row.original.status) ? (
            <Button onClick={() => setClosing(row.original)}>Close</Button>
          ) : null,
      },
    ],
    [can],
  );

  return (
    <div>
      <PageHeader
        title="Rework"
        description="Garments pulled out of work in progress to be fixed. They are still counted against their batch throughout — a garment reworked twice is still one garment."
        actions={
          can('quality.manage_rework') ? (
            <Button variant="primary" onClick={() => setRaising(true)}>
              <Plus />
              Raise ticket
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
        search={{ value: state.search, onChange: state.setSearch, placeholder: 'Ticket number' }}
        exportFileName="rework-orders"
        emptyTitle="No rework tickets"
        emptyDescription="A ticket covers garments already recorded as rework at a stage."
        toolbar={
          <NativeSelect
            value={String(state.filters.status ?? '')}
            onChange={(e) => state.setFilter('status', e.target.value || undefined)}
            className="w-auto"
            aria-label="Status"
          >
            <option value="">Any status</option>
            {REWORK_ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>{humanise(s)}</option>
            ))}
          </NativeSelect>
        }
      />

      <RaiseTicketDialog open={raising} onOpenChange={setRaising} />
      {closing ? <CloseTicketDialog ticket={closing} onClose={() => setClosing(null)} /> : null}
    </div>
  );
}

function RaiseTicketDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const queryClient = useQueryClient();
  const [batchId, setBatchId] = React.useState('');
  const [quantity, setQuantity] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [dueDate, setDueDate] = React.useState('');

  const batches = useQuery({
    queryKey: ['batches', 'rework-picker'],
    queryFn: () => api.get<Paginated<BatchOption>>('/production/batches', { pageSize: 100 }),
    enabled: open,
  });

  const withRework = (batches.data?.data ?? []).filter((b) => Number(b.progress.reworkOutstandingQty) > 0);
  const batch = withRework.find((b) => b.id === batchId);

  React.useEffect(() => {
    if (!open) { setBatchId(''); setQuantity(''); setReason(''); setDueDate(''); }
  }, [open]);
  React.useEffect(() => {
    if (batch) setQuantity(batch.progress.reworkOutstandingQty);
  }, [batch]);

  const raise = useMutation({
    mutationFn: () =>
      api.post('/quality/rework', {
        idempotencyKey: newIdempotencyKey(),
        productionBatchId: batchId,
        qty: quantity,
        reason,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      }),
    onSuccess: () => {
      toast.success('Rework ticket raised');
      void queryClient.invalidateQueries();
      onOpenChange(false);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Raise a rework ticket"
        footer={
          <>
            <Button onClick={() => onOpenChange(false)} disabled={raise.isPending}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!batchId || Number(quantity) <= 0 || reason.trim().length === 0}
              loading={raise.isPending}
              onClick={() => raise.mutate()}
            >
              Raise
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {raise.error ? <ErrorPanel error={raise.error} /> : null}

          {withRework.length === 0 ? (
            <p className="rounded border border-line bg-surface-muted px-2.5 py-2 text-[12.5px] text-ink-muted">
              No batch has garments out in rework. Record the rework at the stage first — a ticket is the
              instruction to fix work that has already been pulled aside.
            </p>
          ) : (
            <>
              <Field label="Batch" required>
                <NativeSelect value={batchId} onChange={(e) => setBatchId(e.target.value)}>
                  <option value="">Select a batch</option>
                  {withRework.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.batchNo} — {fmtQty(b.progress.reworkOutstandingQty, 0)} out in rework
                    </option>
                  ))}
                </NativeSelect>
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Garments"
                  required
                  hint={batch ? `At most ${fmtQty(batch.progress.reworkOutstandingQty, 0)}` : undefined}
                >
                  <QtyInput value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                </Field>
                <Field label="Due by">
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="h-8 w-full rounded border border-line bg-surface px-2 text-[12.5px] text-ink outline-none focus:border-brand"
                  />
                </Field>
              </div>

              <Field label="What needs fixing" required>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
              </Field>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CloseTicketDialog({ ticket, onClose }: { ticket: ReworkRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [fixed, setFixed] = React.useState(ticket.openQty);
  const [scrapped, setScrapped] = React.useState('');
  const [scrapReason, setScrapReason] = React.useState('');

  const close = useMutation({
    mutationFn: () =>
      api.post(`/quality/rework/${ticket.id}/close`, {
        idempotencyKey: newIdempotencyKey(),
        completedQty: fixed || '0',
        scrappedQty: scrapped || '0',
        scrapReason: Number(scrapped) > 0 ? scrapReason : null,
      }),
    onSuccess: () => {
      toast.success('Rework ticket closed');
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const total = Number(fixed || 0) + Number(scrapped || 0);
  const over = total > Number(ticket.openQty);
  const needsReason = Number(scrapped) > 0 && scrapReason.trim().length === 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Close ${ticket.reworkOrderNo}`}
        footer={
          <>
            <Button onClick={onClose} disabled={close.isPending}>Cancel</Button>
            <Button
              variant="primary"
              disabled={total <= 0 || over || needsReason}
              loading={close.isPending}
              onClick={() => close.mutate()}
            >
              Close ticket
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {close.error ? <ErrorPanel error={close.error} /> : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Fixed" hint={`${fmtQty(ticket.openQty, 0)} still open`}>
              <QtyInput value={fixed} onChange={(e) => setFixed(e.target.value)} className="h-11 text-[16px]" />
            </Field>
            <Field label="Scrapped">
              <QtyInput
                value={scrapped}
                onChange={(e) => setScrapped(e.target.value)}
                placeholder="0"
                className="h-11 text-[16px]"
              />
            </Field>
          </div>

          {Number(scrapped) > 0 ? (
            <Field label="Why were they scrapped?" required>
              <Textarea value={scrapReason} onChange={(e) => setScrapReason(e.target.value)} rows={2} />
            </Field>
          ) : null}

          {over ? (
            <p className="text-[12.5px] text-danger">
              That is more than the {fmtQty(ticket.openQty, 0)} garments this ticket still has open.
            </p>
          ) : null}

          <p className="flex items-start gap-1.5 rounded border border-line bg-surface-muted px-2.5 py-2 text-[12px] text-ink-muted">
            <RotateCcw className="mt-0.5 size-3.5 shrink-0" />
            Fixed garments go back into the stage they left and must be completed again. Scrapped ones are
            rejected there instead — which closes the batch arithmetic rather than leaving a quantity
            permanently out.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
