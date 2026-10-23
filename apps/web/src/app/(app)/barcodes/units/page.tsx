'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { PRODUCTION_UNIT_STATUSES } from '@dnd/contracts';
import { useListQuery, useListState, paginationProps } from '@/lib/hooks';
import { fmtDateTime, humanise } from '@/lib/utils';
import { ErrorPanel, NativeSelect, PageHeader, StatusBadge } from '@/components/ui/primitives';
import { CodeCell, DataTable, StackedCell } from '@/components/ui/data-table';

interface UnitRow {
  id: string; serialNo: string; status: string; qcResult: string | null;
  rejectReason: string | null; createdAt: string;
  productionBatch: {
    id: string; batchNo: string;
    manufacturingOrder: { id: string; moNo: string };
    manufacturingOrderItem: { size: string | null; productVariant: { sku: string } };
  };
  barcode: { code: string } | null;
}

/**
 * Per-garment tracking.
 *
 * Only batches that were explicitly serialised appear here. For everything
 * else the batch is the tracked unit, which is the right default — minting
 * 500 barcodes nobody scans is work the floor routes around.
 */
export default function UnitTrackingPage() {
  const router = useRouter();
  const state = useListState({});

  const { data, isLoading, isFetching, error, refetch } = useListQuery<UnitRow>(
    'production-units', '/production/units', state,
  );

  const columns = React.useMemo<ColumnDef<UnitRow, unknown>[]>(
    () => [
      {
        id: 'serialNo', header: 'Serial', accessorKey: 'serialNo',
        cell: ({ row }) => <CodeCell>{row.original.serialNo}</CodeCell>,
      },
      {
        id: 'batch', header: 'Batch', accessorFn: (r) => r.productionBatch.batchNo,
        cell: ({ row }) => (
          <StackedCell
            primary={row.original.productionBatch.batchNo}
            secondary={row.original.productionBatch.manufacturingOrder.moNo}
          />
        ),
      },
      {
        id: 'sku', header: 'SKU',
        accessorFn: (r) => r.productionBatch.manufacturingOrderItem.productVariant.sku,
        cell: ({ row }) => (
          <StackedCell
            primary={row.original.productionBatch.manufacturingOrderItem.productVariant.sku}
            secondary={row.original.productionBatch.manufacturingOrderItem.size ?? ''}
          />
        ),
      },
      {
        id: 'qcResult', header: 'QC', accessorKey: 'qcResult',
        cell: ({ row }) =>
          row.original.qcResult ? <StatusBadge status={row.original.qcResult} /> : <span className="text-ink-subtle">—</span>,
      },
      {
        id: 'createdAt', header: 'Created', accessorKey: 'createdAt',
        cell: ({ row }) => <span className="text-ink-muted">{fmtDateTime(row.original.createdAt)}</span>,
      },
      { id: 'status', header: 'Status', accessorKey: 'status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="Unit Tracking"
        description="Garments given their own barcode. Serialising is worth it only where a single garment has to be traceable on its own — for everything else the batch is the unit."
      />

      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} className="mb-3" /> : null}

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        isFetching={isFetching}
        pagination={paginationProps(data, state)}
        search={{ value: state.search, onChange: state.setSearch, placeholder: 'Serial number' }}
        onRowClick={(row) => router.push(`/barcodes/batches/${row.productionBatch.id}`)}
        exportFileName="production-units"
        emptyTitle="No serialised garments"
        emptyDescription="Serialise a batch from its detail page to give each garment its own barcode."
        toolbar={
          <NativeSelect
            value={String(state.filters.status ?? '')}
            onChange={(e) => state.setFilter('status', e.target.value || undefined)}
            className="w-auto"
            aria-label="Status"
          >
            <option value="">Any status</option>
            {PRODUCTION_UNIT_STATUSES.map((s) => (
              <option key={s} value={s}>{humanise(s)}</option>
            ))}
          </NativeSelect>
        }
      />
    </div>
  );
}
