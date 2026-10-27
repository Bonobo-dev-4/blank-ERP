'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Bell } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDateTime, fmtQty, humanise, uomShort } from '@/lib/utils';
import { ErrorPanel, LoadingBlock, PageHeader, Stat, StatusBadge } from '@/components/ui/primitives';
import { DataTable, StackedCell } from '@/components/ui/data-table';
import { FilterBar, useTableControls } from '@/components/ui/table-controls';

interface Alert {
  rawMaterialId: string; materialCode: string; materialName: string; category: string; baseUom: string;
  availableQty: string; onHandQty: string; reservedQty: string; qualityHoldQty: string;
  issuedToProductionQty: string; minimumStock: string; reorderLevel: string;
  suggestedOrderQty: string; leadTimeDays: number;
  defaultSupplier: { id: string; name: string } | null;
  alertLevel: string; severity: string;
}

interface AlertsResponse {
  generatedAt: string;
  counts: { outOfStock: number; belowMinimum: number; atReorderLevel: number };
  alerts: Alert[];
}

export default function AlertsPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['inventory-alerts'],
    queryFn: () => api.get<AlertsResponse>('/inventory/alerts'),
    refetchInterval: 60_000,
  });

  const columns = React.useMemo<ColumnDef<Alert, unknown>[]>(
    () => [
      { id: 'alertLevel', header: 'Level', accessorKey: 'alertLevel',
        cell: ({ row }) => <StatusBadge status={row.original.alertLevel} /> },
      { id: 'material', header: 'Material', accessorKey: 'materialCode',
        cell: ({ row }) => (
          <Link href={`/materials/${row.original.rawMaterialId}`} className="hover:underline">
            <StackedCell primary={row.original.materialCode} secondary={row.original.materialName} />
          </Link>
        ),
      },
      { id: 'category', header: 'Category', accessorKey: 'category',
        cell: ({ row }) => <span className="text-ink-muted">{humanise(row.original.category)}</span> },
      { id: 'availableQty', header: 'Available', accessorKey: 'availableQty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => (
          <span className="font-medium">
            {fmtQty(row.original.availableQty)} {uomShort(row.original.baseUom)}
          </span>
        ),
      },
      { id: 'minimumStock', header: 'Minimum', accessorKey: 'minimumStock',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => <span className="text-ink-muted">{fmtQty(row.original.minimumStock, 0)}</span> },
      { id: 'reorderLevel', header: 'Reorder at', accessorKey: 'reorderLevel',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => <span className="text-ink-muted">{fmtQty(row.original.reorderLevel, 0)}</span> },
      { id: 'qualityHoldQty', header: 'In QC hold', accessorKey: 'qualityHoldQty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) =>
          Number(row.original.qualityHoldQty) > 0 ? (
            <span className="text-warn" title="Received but not yet inspected, so not available">
              {fmtQty(row.original.qualityHoldQty)}
            </span>
          ) : (
            <span className="text-ink-subtle">-</span>
          ),
      },
      { id: 'suggestedOrderQty', header: 'Suggest buying', accessorKey: 'suggestedOrderQty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => <span className="font-medium">{fmtQty(row.original.suggestedOrderQty, 0)}</span> },
      { id: 'leadTimeDays', header: 'Lead time', accessorKey: 'leadTimeDays',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => <span className="text-ink-muted">{row.original.leadTimeDays}d</span> },
      { id: 'supplier', header: 'Supplier', accessorFn: (r) => r.defaultSupplier?.name ?? '',
        cell: ({ row }) => <span className="text-ink-muted">{row.original.defaultSupplier?.name ?? '-'}</span> },
    ],
    [],
  );

  // Filtering happens here; the table's own headers handle sorting.
  const controls = useTableControls(data?.alerts, {
    search: (a) => `${a.materialCode} ${a.materialName} ${a.defaultSupplier?.name ?? ''}`,
    filters: [
      { key: 'level', label: 'Level', get: (a) => a.alertLevel, format: humanise },
      { key: 'category', label: 'Category', get: (a) => a.category, format: humanise },
      { key: 'supplier', label: 'Supplier', get: (a) => a.defaultSupplier?.name ?? null },
    ],
    toggles: [{ key: 'hold', label: 'Stock in QC hold', test: (a) => Number(a.qualityHoldQty) > 0 }],
  });

  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorPanel error={error} onRetry={() => void refetch()} />;
  if (!data) return null;

  return (
    <div>
      <PageHeader
        title="Inventory Alerts"
        description={
          <>
            Computed live from the stock ledger as of {fmtDateTime(data.generatedAt)} - not from a cached
            flag, so an alert clears the moment stock is received. Availability excludes stock in QC hold,
            reserved, or already issued to production.
          </>
        }
      />

      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="Out of stock" value={data.counts.outOfStock} tone={data.counts.outOfStock > 0 ? 'danger' : 'ok'} hint="nothing available" icon={Bell} />
        <Stat label="Below minimum" value={data.counts.belowMinimum} tone={data.counts.belowMinimum > 0 ? 'warn' : 'ok'} hint="under the configured floor" />
        <Stat label="At reorder level" value={data.counts.atReorderLevel} tone={data.counts.atReorderLevel > 0 ? 'info' : 'ok'} hint="time to raise a requisition" />
      </div>

      {data.alerts.length > 0 ? (
        <div className="glass-subtle mb-3 rounded-2xl px-4 py-3">
          <FilterBar {...controls.barProps} search={controls.barProps.search && { ...controls.barProps.search, placeholder: 'Material code, name or supplier' }} />
        </div>
      ) : null}

      <DataTable
        columns={columns}
        data={controls.rows}
        exportFileName="inventory-alerts"
        emptyTitle={data.alerts.length ? 'No alerts match' : 'No alerts'}
        emptyDescription={data.alerts.length ? 'Clear a filter or change the search.' : 'Every active material is above its reorder level.'}
      />
    </div>
  );
}
