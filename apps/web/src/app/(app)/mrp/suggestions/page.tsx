'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { useListQuery, useListState, paginationProps } from '@/lib/hooks';
import { fmtDate, fmtMoney, fmtQty, uomShort } from '@/lib/utils';
import { Button, ErrorPanel, PageHeader } from '@/components/ui/primitives';
import { CodeCell, DataTable, StackedCell } from '@/components/ui/data-table';

interface SuggestionRow {
  id: string; uom: string; grossRequiredQty: string; availableQty: string;
  shortageQty: string; uncoveredShortageQty: string; estimatedUnitCost: string | null;
  rawMaterial: { id: string; materialCode: string; name: string; category: string; baseUom: string };
  manufacturingOrder: { id: string; moNo: string; status: string; dueDate: string | null } | null;
  mrpRun: { id: string; runNo: string; createdAt: string } | null;
}

/**
 * What still has to be bought.
 *
 * Only shortages NOT already covered by an open purchase order appear here:
 * a shortage with stock on the way is a date problem for the planner, not a
 * buying decision for purchasing. Raising the requisition itself happens on the
 * run that produced the suggestion, where the quantities can be adjusted
 * against the figures they were computed from.
 */
export default function PurchaseSuggestionsPage() {
  const router = useRouter();
  const state = useListState({ filters: { uncoveredOnly: true } });

  const { data, isLoading, isFetching, error, refetch } = useListQuery<SuggestionRow>(
    'mrp-suggestions', '/mrp/shortages', state,
  );

  const columns = React.useMemo<ColumnDef<SuggestionRow, unknown>[]>(
    () => [
      {
        id: 'material', header: 'Material', accessorFn: (r) => r.rawMaterial.materialCode,
        cell: ({ row }) => (
          <StackedCell primary={row.original.rawMaterial.name} secondary={row.original.rawMaterial.materialCode} />
        ),
      },
      {
        id: 'suggested', header: 'Suggested buy', accessorKey: 'uncoveredShortageQty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => (
          <span className="font-semibold">
            {fmtQty(row.original.uncoveredShortageQty, 4)} {uomShort(row.original.uom)}
          </span>
        ),
      },
      {
        id: 'required', header: 'Required', accessorKey: 'grossRequiredQty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => fmtQty(row.original.grossRequiredQty, 4),
      },
      {
        id: 'available', header: 'Available', accessorKey: 'availableQty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => fmtQty(row.original.availableQty, 4),
      },
      {
        id: 'value', header: 'Estimated value',
        accessorFn: (r) => Number(r.uncoveredShortageQty) * Number(r.estimatedUnitCost ?? 0),
        meta: { align: 'right', numeric: true },
        cell: ({ row }) =>
          fmtMoney(
            String(Number(row.original.uncoveredShortageQty) * Number(row.original.estimatedUnitCost ?? 0)),
          ),
      },
      {
        id: 'order', header: 'For order', accessorFn: (r) => r.manufacturingOrder?.moNo ?? '',
        cell: ({ row }) =>
          row.original.manufacturingOrder ? (
            <StackedCell
              primary={row.original.manufacturingOrder.moNo}
              secondary={fmtDate(row.original.manufacturingOrder.dueDate)}
            />
          ) : (
            <span className="text-ink-subtle">Ad-hoc plan</span>
          ),
      },
      {
        id: 'run', header: 'From run', accessorFn: (r) => r.mrpRun?.runNo ?? '',
        cell: ({ row }) =>
          row.original.mrpRun ? <CodeCell>{row.original.mrpRun.runNo}</CodeCell> : <span className="text-ink-subtle">-</span>,
      },
      {
        id: 'raise', header: '',
        cell: ({ row }) =>
          row.original.mrpRun ? (
            <Button onClick={() => router.push(`/mrp/${row.original.mrpRun!.id}`)}>Raise</Button>
          ) : null,
      },
    ],
    [router],
  );

  return (
    <div>
      <PageHeader
        title="Purchase Suggestions"
        description="Shortages with nothing on order against them. A suggestion already covered by an open purchase order is left out — that is a delivery-date conversation, not a buying one."
      />

      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} className="mb-3" /> : null}

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        isFetching={isFetching}
        pagination={paginationProps(data, state)}
        exportFileName="purchase-suggestions"
        emptyTitle="Nothing to buy"
        emptyDescription="Every planned shortage is already covered by an open purchase order, or there are no shortages."
      />
    </div>
  );
}
