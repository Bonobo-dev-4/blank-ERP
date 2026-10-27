'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { MATERIAL_CATEGORIES, RECORD_STATUSES } from '@dnd/contracts';
import { useListQuery, useListState, paginationProps } from '@/lib/hooks';
import { fmtMoney, fmtQty, humanise, uomShort } from '@/lib/utils';
import { Button, ErrorPanel, NativeSelect, PageHeader, StatusBadge } from '@/components/ui/primitives';
import { CsvImportButton } from '@/components/app/csv-import';
import { CodeCell, DataTable, StackedCell } from '@/components/ui/data-table';
import { useAuth } from '@/components/app/auth-context';
import { MaterialFormDialog } from './material-form';

interface MaterialRow {
  id: string;
  materialCode: string;
  name: string;
  category: string;
  color: string | null;
  baseUom: string;
  minimumStock: string;
  reorderLevel: string;
  averageCost: string;
  leadTimeDays: number;
  status: string;
  lotTracked: boolean;
  defaultSupplier: { id: string; name: string } | null;
  defaultLocation: { id: string; code: string; name: string } | null;
  stock: {
    onHandQty: string; availableQty: string; reservedQty: string;
    qualityHoldQty: string; issuedToProductionQty: string; blockedQty: string;
    alertLevel: string;
  };
}

export default function MaterialsPage() {
  const router = useRouter();
  const { can } = useAuth();
  const state = useListState({ sortBy: 'materialCode', sortDir: 'asc' });
  const { data, isLoading, isFetching, error, refetch } = useListQuery<MaterialRow>(
    'materials', '/materials', state,
  );
  const [creating, setCreating] = React.useState(false);

  const columns = React.useMemo<ColumnDef<MaterialRow, unknown>[]>(
    () => [
      {
        id: 'materialCode',
        header: 'Code',
        accessorKey: 'materialCode',
        cell: ({ row }) => <CodeCell>{row.original.materialCode}</CodeCell>,
      },
      {
        id: 'name',
        header: 'Material',
        accessorKey: 'name',
        cell: ({ row }) => (
          <StackedCell
            primary={row.original.name}
            secondary={[humanise(row.original.category), row.original.color].filter(Boolean).join(' · ')}
          />
        ),
      },
      {
        id: 'availableQty',
        header: 'Available',
        accessorFn: (r) => r.stock.availableQty,
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => (
          <span className="font-medium">
            {fmtQty(row.original.stock.availableQty)} {uomShort(row.original.baseUom)}
          </span>
        ),
      },
      {
        id: 'reservedQty',
        header: 'Reserved',
        accessorFn: (r) => r.stock.reservedQty,
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => <Muted>{fmtQty(row.original.stock.reservedQty)}</Muted>,
      },
      {
        id: 'issuedToProductionQty',
        header: 'At production',
        accessorFn: (r) => r.stock.issuedToProductionQty,
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => <Muted>{fmtQty(row.original.stock.issuedToProductionQty)}</Muted>,
      },
      {
        id: 'qualityHoldQty',
        header: 'QC hold',
        accessorFn: (r) => r.stock.qualityHoldQty,
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => <Muted>{fmtQty(row.original.stock.qualityHoldQty)}</Muted>,
      },
      {
        id: 'onHandQty',
        header: 'On hand',
        accessorFn: (r) => r.stock.onHandQty,
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => <Muted>{fmtQty(row.original.stock.onHandQty)}</Muted>,
      },
      {
        id: 'reorderLevel',
        header: 'Reorder at',
        accessorKey: 'reorderLevel',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => <Muted>{fmtQty(row.original.reorderLevel, 0)}</Muted>,
      },
      {
        id: 'averageCost',
        header: 'Avg cost',
        accessorKey: 'averageCost',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => <Muted>{fmtMoney(row.original.averageCost)}</Muted>,
      },
      {
        id: 'alertLevel',
        header: 'Level',
        accessorFn: (r) => r.stock.alertLevel,
        cell: ({ row }) => <StatusBadge status={row.original.stock.alertLevel} />,
      },
      {
        id: 'status',
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="Raw Material Master"
        description="Every material, with the live stock position from the ledger. Available excludes stock reserved, in QC hold, or already issued to production."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <CsvImportButton type="raw-materials" invalidate={['materials']} />
            {can('materials.write') ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus />
              New material
            </Button>
            ) : null}
          </div>
        }
      />

      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} className="mb-3" /> : null}

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        isFetching={isFetching}
        pagination={paginationProps(data, state)}
        search={{ value: state.search, onChange: state.setSearch, placeholder: 'Code, name, colour, composition' }}
        onRowClick={(row) => router.push(`/materials/${row.id}`)}
        exportFileName="raw-materials"
        emptyTitle="No materials match"
        emptyDescription="Adjust the filters, or create the first raw material."
        toolbar={
          <>
            <NativeSelect
              value={String(state.filters.category ?? '')}
              onChange={(e) => state.setFilter('category', e.target.value || undefined)}
              className="w-auto"
              aria-label="Category"
            >
              <option value="">All categories</option>
              {MATERIAL_CATEGORIES.map((c) => (
                <option key={c} value={c}>{humanise(c)}</option>
              ))}
            </NativeSelect>
            <NativeSelect
              value={String(state.filters.status ?? '')}
              onChange={(e) => state.setFilter('status', e.target.value || undefined)}
              className="w-auto"
              aria-label="Status"
            >
              <option value="">Any status</option>
              {RECORD_STATUSES.map((s) => (
                <option key={s} value={s}>{humanise(s)}</option>
              ))}
            </NativeSelect>
            <label className="flex items-center gap-1.5 whitespace-nowrap text-[12px] text-ink-muted">
              <input
                type="checkbox"
                checked={Boolean(state.filters.belowReorderLevel)}
                onChange={(e) => state.setFilter('belowReorderLevel', e.target.checked || undefined)}
              />
              Needs reordering
            </label>
          </>
        }
      />

      {creating ? (
        <MaterialFormDialog
          open={creating}
          onOpenChange={setCreating}
          onSaved={() => void refetch()}
        />
      ) : null}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-ink-muted">{children}</span>;
}
