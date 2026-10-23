'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { BOM_STATUSES } from '@dnd/contracts';
import { useListQuery, useListState, paginationProps } from '@/lib/hooks';
import { fmtDateTime, fmtMoney, humanise } from '@/lib/utils';
import { Badge, ErrorPanel, NativeSelect, PageHeader, StatusBadge } from '@/components/ui/primitives';
import { CodeCell, DataTable, StackedCell } from '@/components/ui/data-table';

interface VersionRow {
  id: string; version: number; status: string; plannedUnitCost: string;
  approvedAt: string | null; createdAt: string; changeNote: string | null;
  bom: {
    id: string; bomCode: string; name: string | null;
    product: { id: string; styleCode: string; name: string };
    productVariant: { id: string; sku: string } | null;
  };
  supersededBy: { id: string; version: number } | null;
  _count: { items: number; manufacturingOrders: number };
}

export default function BomVersionsPage() {
  const router = useRouter();
  const state = useListState({});

  const { data, isLoading, isFetching, error, refetch } = useListQuery<VersionRow>(
    'bom-versions', '/bom/versions', state,
  );

  const columns = React.useMemo<ColumnDef<VersionRow, unknown>[]>(
    () => [
      {
        id: 'bom', header: 'BOM', accessorFn: (r) => r.bom.bomCode,
        cell: ({ row }) => <CodeCell>{row.original.bom.bomCode}</CodeCell>,
      },
      {
        id: 'version', header: 'Version', accessorKey: 'version',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => <span className="font-medium">v{row.original.version}</span>,
      },
      {
        id: 'product', header: 'Style', accessorFn: (r) => r.bom.product.styleCode,
        cell: ({ row }) => (
          <StackedCell
            primary={row.original.bom.product.name}
            secondary={row.original.bom.product.styleCode}
          />
        ),
      },
      {
        id: 'items', header: 'Lines', accessorFn: (r) => r._count.items,
        meta: { align: 'right', numeric: true },
      },
      {
        id: 'cost', header: 'Cost / unit', accessorKey: 'plannedUnitCost',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => fmtMoney(row.original.plannedUnitCost),
      },
      {
        id: 'orders', header: 'Orders', accessorFn: (r) => r._count.manufacturingOrders,
        meta: { align: 'right', numeric: true },
        cell: ({ row }) =>
          row.original._count.manufacturingOrders > 0 ? (
            // Orders pinned to this version. They read their own frozen
            // snapshot, so this is lineage, not a live dependency.
            <span title="Orders released against this version">
              {row.original._count.manufacturingOrders}
            </span>
          ) : (
            <span className="text-ink-subtle">-</span>
          ),
      },
      {
        id: 'supersededBy', header: 'Superseded by', accessorFn: (r) => r.supersededBy?.version ?? 0,
        cell: ({ row }) =>
          row.original.supersededBy ? (
            <Badge tone="neutral">v{row.original.supersededBy.version}</Badge>
          ) : (
            <span className="text-ink-subtle">-</span>
          ),
      },
      {
        id: 'createdAt', header: 'Created', accessorKey: 'createdAt',
        cell: ({ row }) => <span className="text-ink-muted">{fmtDateTime(row.original.createdAt)}</span>,
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
        title="BOM Versions"
        description="Every revision ever made. A superseded version is kept rather than deleted, because orders released against it are still costed to those figures."
      />

      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} className="mb-3" /> : null}

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        isFetching={isFetching}
        pagination={paginationProps(data, state)}
        search={{ value: state.search, onChange: state.setSearch, placeholder: 'BOM or style code' }}
        onRowClick={(row) => router.push(`/bom/${row.bom.id}`)}
        exportFileName="bom-versions"
        emptyTitle="No BOM versions"
        toolbar={
          <NativeSelect
            value={String(state.filters.status ?? '')}
            onChange={(e) => state.setFilter('status', e.target.value || undefined)}
            className="w-auto"
            aria-label="Status"
          >
            <option value="">Any status</option>
            {BOM_STATUSES.map((s) => (
              <option key={s} value={s}>{humanise(s)}</option>
            ))}
          </NativeSelect>
        }
      />
    </div>
  );
}
