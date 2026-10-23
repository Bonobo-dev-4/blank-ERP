'use client';

import * as React from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useListQuery, useListState, paginationProps } from '@/lib/hooks';
import { fmtQty, uomShort } from '@/lib/utils';
import { ErrorPanel, NativeSelect, PageHeader, StatusBadge } from '@/components/ui/primitives';
import { CodeCell, DataTable, StackedCell } from '@/components/ui/data-table';

interface BalanceRow {
  id: string; onHandQty: string; reservedQty: string; availableQty: string; updatedAt: string;
  rawMaterial: { id: string; materialCode: string; name: string; baseUom: string; category: string };
  materialLot: { id: string; lotCode: string; shade: string | null; width: string | null; isGeneral: boolean };
  location: { id: string; code: string; name: string; kind: string; blocksIssue: boolean };
}

export default function StockPage() {
  const state = useListState({ sortBy: 'updatedAt', sortDir: 'desc', pageSize: 50 });

  const { data: locations } = useQuery({
    queryKey: ['locations', 'all'],
    queryFn: () => api.get<{ id: string; code: string; name: string; kind: string }[]>('/locations', { includeSystem: true }),
  });

  const { data, isLoading, isFetching, error, refetch } = useListQuery<BalanceRow>(
    'balances', '/inventory/balances', state,
  );

  const columns = React.useMemo<ColumnDef<BalanceRow, unknown>[]>(
    () => [
      {
        id: 'material', header: 'Material', accessorFn: (r) => r.rawMaterial.materialCode,
        cell: ({ row }) => (
          <Link href={`/materials/${row.original.rawMaterial.id}`} className="hover:underline">
            <StackedCell primary={row.original.rawMaterial.materialCode} secondary={row.original.rawMaterial.name} />
          </Link>
        ),
      },
      {
        id: 'lot', header: 'Lot', accessorFn: (r) => r.materialLot.lotCode,
        cell: ({ row }) => (
          <div>
            <CodeCell>{row.original.materialLot.lotCode}</CodeCell>
            {row.original.materialLot.shade ? (
              <div className="text-[11px] text-ink-muted">shade {row.original.materialLot.shade}</div>
            ) : null}
          </div>
        ),
      },
      {
        id: 'location', header: 'Location', accessorFn: (r) => r.location.code,
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <div>
              <CodeCell>{row.original.location.code}</CodeCell>
              <div className="text-[11px] text-ink-muted">{row.original.location.name}</div>
            </div>
            <StatusBadge status={row.original.location.kind} />
          </div>
        ),
      },
      {
        id: 'onHandQty', header: 'On hand', accessorKey: 'onHandQty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => (
          <span className={Number(row.original.onHandQty) < 0 ? 'font-medium text-ink-muted' : 'font-medium'}>
            {fmtQty(row.original.onHandQty)} {uomShort(row.original.rawMaterial.baseUom)}
          </span>
        ),
      },
      {
        id: 'reservedQty', header: 'Reserved', accessorKey: 'reservedQty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => <span className="text-ink-muted">{fmtQty(row.original.reservedQty)}</span>,
      },
      {
        id: 'availableQty', header: 'Available', accessorKey: 'availableQty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) =>
          row.original.location.blocksIssue ? (
            <span className="text-ink-subtle" title="Stock here is not available to production">-</span>
          ) : (
            fmtQty(row.original.availableQty)
          ),
      },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="Raw Material Stock"
        description="The balance projection, one row per material, lot and location. Virtual counter-account rows (supplier, consumed, scrap) carry negative or sink balances and are what make the ledger sum to zero."
      />

      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} className="mb-3" /> : null}

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        isFetching={isFetching}
        pagination={paginationProps(data, state)}
        search={{ value: state.search, onChange: state.setSearch, placeholder: 'Material code or name' }}
        exportFileName="stock-balances"
        emptyTitle="No stock balances"
        emptyDescription="Balances appear as soon as the first goods receipt is posted."
        toolbar={
          <>
            <NativeSelect
              value={String(state.filters.locationId ?? '')}
              onChange={(e) => state.setFilter('locationId', e.target.value || undefined)}
              className="w-auto max-w-[220px]"
              aria-label="Location"
            >
              <option value="">All locations</option>
              {(locations ?? []).map((l) => (
                <option key={l.id} value={l.id}>{l.code} · {l.name}</option>
              ))}
            </NativeSelect>
            <label className="flex items-center gap-1.5 whitespace-nowrap text-[12px] text-ink-muted">
              <input
                type="checkbox"
                checked={state.filters.nonZeroOnly !== false}
                onChange={(e) => state.setFilter('nonZeroOnly', e.target.checked)}
              />
              Hide zero rows
            </label>
          </>
        }
      />
    </div>
  );
}
