'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { useListQuery, useListState, paginationProps } from '@/lib/hooks';
import { fmtDate, fmtMoney, fmtQty, uomShort } from '@/lib/utils';
import { ErrorPanel, PageHeader, StatusBadge } from '@/components/ui/primitives';
import { CodeCell, DataTable, StackedCell } from '@/components/ui/data-table';

interface ShortageRow {
  id: string; createdAt: string; uom: string;
  grossRequiredQty: string; availableQty: string; shortageQty: string;
  uncoveredShortageQty: string; openPurchaseQty: string;
  expectedArrivalDate: string | null; estimatedCost: string;
  rawMaterial: { id: string; materialCode: string; name: string; category: string; baseUom: string };
  manufacturingOrder: { id: string; moNo: string; status: string; dueDate: string | null } | null;
  mrpRun: { id: string; runNo: string; createdAt: string } | null;
}

export default function ShortagesPage() {
  const router = useRouter();
  const state = useListState({ filters: {} });

  const { data, isLoading, isFetching, error, refetch } = useListQuery<ShortageRow>(
    'mrp-shortages', '/mrp/shortages', state,
  );

  const columns = React.useMemo<ColumnDef<ShortageRow, unknown>[]>(
    () => [
      {
        id: 'material', header: 'Material', accessorFn: (r) => r.rawMaterial.materialCode,
        cell: ({ row }) => (
          <StackedCell primary={row.original.rawMaterial.name} secondary={row.original.rawMaterial.materialCode} />
        ),
      },
      {
        id: 'order', header: 'Order', accessorFn: (r) => r.manufacturingOrder?.moNo ?? '',
        cell: ({ row }) =>
          row.original.manufacturingOrder ? (
            <CodeCell>{row.original.manufacturingOrder.moNo}</CodeCell>
          ) : (
            <span className="text-ink-subtle">Ad-hoc plan</span>
          ),
      },
      {
        id: 'required', header: 'Required', accessorKey: 'grossRequiredQty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => `${fmtQty(row.original.grossRequiredQty, 4)} ${uomShort(row.original.uom)}`,
      },
      {
        id: 'available', header: 'Available', accessorKey: 'availableQty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => fmtQty(row.original.availableQty, 4),
      },
      {
        id: 'shortage', header: 'Short', accessorKey: 'shortageQty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => <span className="font-semibold text-danger">{fmtQty(row.original.shortageQty, 4)}</span>,
      },
      {
        id: 'incoming', header: 'Incoming', accessorKey: 'openPurchaseQty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) =>
          Number(row.original.openPurchaseQty) > 0 ? (
            <span>
              {fmtQty(row.original.openPurchaseQty, 4)}
              <span className="ml-1 text-[11px] text-ink-subtle">
                {fmtDate(row.original.expectedArrivalDate)}
              </span>
            </span>
          ) : (
            <span className="text-ink-subtle">-</span>
          ),
      },
      {
        id: 'uncovered', header: 'Still uncovered', accessorKey: 'uncoveredShortageQty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) =>
          Number(row.original.uncoveredShortageQty) > 0 ? (
            <span className="font-medium text-danger">{fmtQty(row.original.uncoveredShortageQty, 4)}</span>
          ) : (
            // Covered by an open purchase order — a date problem, not a buying one.
            <span className="text-warn">On order</span>
          ),
      },
      {
        id: 'run', header: 'Run', accessorFn: (r) => r.mrpRun?.runNo ?? '',
        cell: ({ row }) =>
          row.original.mrpRun ? (
            <StackedCell
              primary={row.original.mrpRun.runNo}
              secondary={fmtDate(row.original.mrpRun.createdAt)}
            />
          ) : (
            <span className="text-ink-subtle">-</span>
          ),
      },
      {
        id: 'moStatus', header: 'Order status', accessorFn: (r) => r.manufacturingOrder?.status ?? '',
        cell: ({ row }) => <StatusBadge status={row.original.manufacturingOrder?.status} />,
      },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="Material Shortages"
        description="Every requirement line short against physical stock, newest first. A shortage already covered by an open purchase order is a date problem; one that is not is a buying decision."
      />

      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} className="mb-3" /> : null}

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        isFetching={isFetching}
        pagination={paginationProps(data, state)}
        onRowClick={(row) => row.mrpRun && router.push(`/mrp/${row.mrpRun.id}`)}
        exportFileName="material-shortages"
        emptyTitle="No shortages"
        emptyDescription="Every planned requirement is covered by stock that is physically available."
        toolbar={
          <label className="flex items-center gap-1.5 whitespace-nowrap text-[12px] text-ink-muted">
            <input
              type="checkbox"
              checked={Boolean(state.filters.uncoveredOnly)}
              onChange={(e) => state.setFilter('uncoveredOnly', e.target.checked || undefined)}
            />
            Not on order
          </label>
        }
      />
    </div>
  );
}
