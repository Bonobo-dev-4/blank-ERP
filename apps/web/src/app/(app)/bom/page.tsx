'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { BOM_STATUSES } from '@dnd/contracts';
import { useListQuery, useListState, paginationProps } from '@/lib/hooks';
import { fmtMoney, humanise } from '@/lib/utils';
import { Badge, Button, ErrorPanel, NativeSelect, PageHeader, StatusBadge } from '@/components/ui/primitives';
import { CodeCell, DataTable, StackedCell } from '@/components/ui/data-table';
import { useAuth } from '@/components/app/auth-context';

interface BomVersionSummary {
  id: string; version: number; status: string; baseQuantity: string;
  plannedUnitCost: string; approvedAt: string | null; _count: { items: number };
}

interface BomRow {
  id: string; bomCode: string; name: string | null;
  product: { id: string; styleCode: string; name: string; category: string };
  productVariant: { id: string; sku: string; size: string | null; color: string | null } | null;
  approvedVersion: BomVersionSummary | null;
  latestVersion: BomVersionSummary | null;
  versionCount: number;
}

export default function BomListPage() {
  const router = useRouter();
  const { can } = useAuth();

  const state = useListState({ sortBy: 'bomCode', sortDir: 'asc' });
  const { data, isLoading, isFetching, error, refetch } = useListQuery<BomRow>('boms', '/bom', state);

  const columns = React.useMemo<ColumnDef<BomRow, unknown>[]>(
    () => [
      {
        id: 'bomCode', header: 'BOM', accessorKey: 'bomCode',
        cell: ({ row }) => <CodeCell>{row.original.bomCode}</CodeCell>,
      },
      {
        id: 'product', header: 'Style', accessorFn: (r) => r.product.styleCode,
        cell: ({ row }) => (
          <StackedCell primary={row.original.product.name} secondary={row.original.product.styleCode} />
        ),
      },
      {
        id: 'scope', header: 'Scope',
        accessorFn: (r) => (r.productVariant ? r.productVariant.sku : 'Style level'),
        cell: ({ row }) =>
          row.original.productVariant ? (
            // A SKU-scoped BOM overrides the style default for that one SKU.
            <Badge tone="info">{row.original.productVariant.sku}</Badge>
          ) : (
            <span className="text-ink-muted">Every SKU</span>
          ),
      },
      {
        id: 'lines', header: 'Lines',
        accessorFn: (r) => r.approvedVersion?._count.items ?? r.latestVersion?._count.items ?? 0,
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => {
          const v = row.original.approvedVersion ?? row.original.latestVersion;
          return v ? v._count.items : <span className="text-ink-subtle">-</span>;
        },
      },
      {
        id: 'cost', header: 'Material / unit',
        accessorFn: (r) => Number(r.approvedVersion?.plannedUnitCost ?? 0),
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => {
          const v = row.original.approvedVersion;
          // Only an approved version has a cost worth quoting: a draft's figure
          // can change before anyone commits to it.
          return v ? fmtMoney(v.plannedUnitCost) : <span className="text-ink-subtle">-</span>;
        },
      },
      {
        id: 'approved', header: 'Approved version',
        accessorFn: (r) => r.approvedVersion?.version ?? 0,
        meta: { align: 'right', numeric: true },
        cell: ({ row }) =>
          row.original.approvedVersion ? (
            <span className="font-medium">v{row.original.approvedVersion.version}</span>
          ) : (
            <span className="text-ink-subtle">None</span>
          ),
      },
      {
        id: 'versions', header: 'Versions', accessorKey: 'versionCount',
        meta: { align: 'right', numeric: true },
      },
      {
        id: 'status', header: 'Latest',
        accessorFn: (r) => r.latestVersion?.status ?? '',
        cell: ({ row }) => <StatusBadge status={row.original.latestVersion?.status} />,
      },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="BOM Master"
        description="The recipe for each style. An approved version is immutable — a change is always a new version, so an order already costed against the old one keeps the recipe it was built to."
        actions={
          can('bom.write') ? (
            <Button variant="primary" onClick={() => router.push('/bom/new')}>
              <Plus />
              New BOM
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
        search={{ value: state.search, onChange: state.setSearch, placeholder: 'BOM code or name' }}
        onRowClick={(row) => router.push(`/bom/${row.id}`)}
        exportFileName="boms"
        emptyTitle="No bills of material"
        emptyDescription="A style needs an approved BOM before a manufacturing order for it can be planned or released."
        toolbar={
          <NativeSelect
            value={String(state.filters.status ?? '')}
            onChange={(e) => state.setFilter('status', e.target.value || undefined)}
            className="w-auto"
            aria-label="Version status"
          >
            <option value="">Any version status</option>
            {BOM_STATUSES.map((s) => (
              <option key={s} value={s}>{humanise(s)}</option>
            ))}
          </NativeSelect>
        }
      />
    </div>
  );
}
