'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { BATCH_STATUSES } from '@dnd/contracts';
import { useListQuery, useListState, paginationProps } from '@/lib/hooks';
import { fmtDate, fmtQty, humanise } from '@/lib/utils';
import { Badge, ErrorPanel, NativeSelect, PageHeader, StatusBadge } from '@/components/ui/primitives';
import { CodeCell, DataTable, StackedCell } from '@/components/ui/data-table';

export interface BatchRow {
  id: string; batchNo: string; status: string; trackingMode: string;
  plannedQty: string; releasedQty: string; finishedQty: string; rejectedQty: string;
  route: { id: string; code: string; name: string } | null;
  manufacturingOrder: { id: string; moNo: string; status: string };
  manufacturingOrderItem: { size: string | null; productVariant: { sku: string } };
  progress: {
    plannedQty: string; releasedQty: string; finishedQty: string; rejectedQty: string;
    inProgressQty: string; reworkOutstandingQty: string; completionPct: string;
    currentStageCode: string | null;
  };
}

export default function BatchTrackingPage() {
  const router = useRouter();
  const state = useListState({ sortBy: 'createdAt', sortDir: 'desc' });

  const { data, isLoading, isFetching, error, refetch } = useListQuery<BatchRow>(
    'production-batches', '/production/batches', state,
  );

  const columns = React.useMemo<ColumnDef<BatchRow, unknown>[]>(
    () => [
      {
        id: 'batchNo', header: 'Batch', accessorKey: 'batchNo',
        cell: ({ row }) => <CodeCell>{row.original.batchNo}</CodeCell>,
      },
      {
        id: 'order', header: 'Order', accessorFn: (r) => r.manufacturingOrder.moNo,
        cell: ({ row }) => (
          <StackedCell
            primary={row.original.manufacturingOrder.moNo}
            secondary={`${row.original.manufacturingOrderItem.productVariant.sku} · ${
              row.original.manufacturingOrderItem.size ?? '—'
            }`}
          />
        ),
      },
      {
        id: 'planned', header: 'Planned', accessorFn: (r) => Number(r.progress.plannedQty),
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => <span className="font-medium">{fmtQty(row.original.progress.plannedQty, 0)}</span>,
      },
      {
        id: 'wip', header: 'In progress', accessorFn: (r) => Number(r.progress.inProgressQty),
        meta: { align: 'right', numeric: true },
        cell: ({ row }) =>
          Number(row.original.progress.inProgressQty) > 0
            ? fmtQty(row.original.progress.inProgressQty, 0)
            : <span className="text-ink-subtle">-</span>,
      },
      {
        id: 'finished', header: 'Finished', accessorFn: (r) => Number(r.progress.finishedQty),
        meta: { align: 'right', numeric: true },
        cell: ({ row }) =>
          Number(row.original.progress.finishedQty) > 0
            ? <span className="text-ok">{fmtQty(row.original.progress.finishedQty, 0)}</span>
            : <span className="text-ink-subtle">-</span>,
      },
      {
        id: 'rejected', header: 'Rejected', accessorFn: (r) => Number(r.progress.rejectedQty),
        meta: { align: 'right', numeric: true },
        cell: ({ row }) =>
          Number(row.original.progress.rejectedQty) > 0
            ? <span className="text-danger">{fmtQty(row.original.progress.rejectedQty, 0)}</span>
            : <span className="text-ink-subtle">-</span>,
      },
      {
        id: 'rework', header: 'In rework', accessorFn: (r) => Number(r.progress.reworkOutstandingQty),
        meta: { align: 'right', numeric: true },
        cell: ({ row }) =>
          Number(row.original.progress.reworkOutstandingQty) > 0
            ? <span className="text-warn">{fmtQty(row.original.progress.reworkOutstandingQty, 0)}</span>
            : <span className="text-ink-subtle">-</span>,
      },
      {
        id: 'where', header: 'Where it is', accessorFn: (r) => r.progress.currentStageCode ?? '',
        cell: ({ row }) =>
          row.original.progress.currentStageCode ? (
            <Badge tone="info">{row.original.progress.currentStageCode}</Badge>
          ) : (
            <span className="text-ink-subtle">—</span>
          ),
      },
      {
        id: 'route', header: 'Route', accessorFn: (r) => r.route?.code ?? '',
        cell: ({ row }) => <span className="text-ink-muted">{row.original.route?.name ?? '—'}</span>,
      },
      {
        id: 'status', header: 'Status', accessorKey: 'status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="Batch Tracking"
        description="Every batch and where it actually is. Stage quantities are never added together — cutting 100, stitching 85 and finishing 60 means 60 garments exist and the rest are in progress, not 245."
      />

      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} className="mb-3" /> : null}

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        isFetching={isFetching}
        pagination={paginationProps(data, state)}
        search={{ value: state.search, onChange: state.setSearch, placeholder: 'Batch number' }}
        onRowClick={(row) => router.push(`/barcodes/batches/${row.id}`)}
        exportFileName="production-batches"
        emptyTitle="No production batches"
        emptyDescription="Batches are created from a released manufacturing order, on the order itself."
        toolbar={
          <NativeSelect
            value={String(state.filters.status ?? '')}
            onChange={(e) => state.setFilter('status', e.target.value || undefined)}
            className="w-auto"
            aria-label="Status"
          >
            <option value="">Any status</option>
            {BATCH_STATUSES.map((s) => (
              <option key={s} value={s}>{humanise(s)}</option>
            ))}
          </NativeSelect>
        }
      />
    </div>
  );
}
