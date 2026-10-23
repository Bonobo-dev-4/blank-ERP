'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useListQuery, useListState, paginationProps } from '@/lib/hooks';
import { fmtDate, fmtMoney, fmtQty, uomShort } from '@/lib/utils';
import { Badge, ErrorPanel, PageHeader } from '@/components/ui/primitives';
import { CodeCell, DataTable, StackedCell } from '@/components/ui/data-table';

interface LotRow {
  id: string; lotCode: string; supplierLotRef: string | null; shade: string | null;
  width: string | null; gsm: number | null; unitCost: string; receivedAt: string | null;
  isGeneral: boolean; status: string;
  rawMaterial: { id: string; materialCode: string; name: string; baseUom: string; category: string };
  supplier: { id: string; name: string } | null;
  balances: { onHandQty: string; reservedQty: string; location: { code: string; name: string; kind: string } }[];
  _count: { fabricRolls: number };
}

export default function MaterialLotsPage() {
  const state = useListState({ sortBy: 'receivedAt', sortDir: 'desc' });
  const { data, isLoading, isFetching, error, refetch } = useListQuery<LotRow>(
    'material-lots', '/materials/lots', state,
  );

  const columns = React.useMemo<ColumnDef<LotRow, unknown>[]>(
    () => [
      { id: 'lotCode', header: 'Lot', accessorKey: 'lotCode',
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <CodeCell>{row.original.lotCode}</CodeCell>
            {row.original.isGeneral ? <Badge tone="neutral">implicit</Badge> : null}
          </div>
        ),
      },
      { id: 'material', header: 'Material', accessorFn: (r) => r.rawMaterial.materialCode,
        cell: ({ row }) => (
          <StackedCell primary={row.original.rawMaterial.materialCode} secondary={row.original.rawMaterial.name} />
        ),
      },
      { id: 'shade', header: 'Shade', accessorKey: 'shade', cell: ({ row }) => row.original.shade ?? '-' },
      { id: 'width', header: 'Width', accessorKey: 'width', meta: { align: 'right', numeric: true },
        cell: ({ row }) => (row.original.width ? `${fmtQty(row.original.width, 1)}"` : '-') },
      { id: 'onHand', header: 'On hand', meta: { align: 'right', numeric: true },
        accessorFn: (r) => r.balances.reduce((a, b) => a + Number(b.onHandQty), 0),
        cell: ({ row }) => {
          const total = row.original.balances.reduce((a, b) => a + Number(b.onHandQty), 0);
          return (
            <span className="font-medium">
              {fmtQty(String(total))} {uomShort(row.original.rawMaterial.baseUom)}
            </span>
          );
        },
      },
      { id: 'locations', header: 'Held at',
        accessorFn: (r) => r.balances.length,
        cell: ({ row }) => {
          const held = row.original.balances.filter((b) => Number(b.onHandQty) !== 0);
          if (held.length === 0) return <span className="text-ink-subtle">-</span>;
          return (
            <span className="text-[11.5px] text-ink-muted">
              {held.map((b) => `${b.location.code} ${fmtQty(b.onHandQty, 1)}`).join(' · ')}
            </span>
          );
        },
      },
      { id: 'rolls', header: 'Rolls', accessorFn: (r) => r._count.fabricRolls,
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => (row.original._count.fabricRolls > 0 ? row.original._count.fabricRolls : '-') },
      { id: 'unitCost', header: 'Unit cost', accessorKey: 'unitCost', meta: { align: 'right', numeric: true },
        cell: ({ row }) => fmtMoney(row.original.unitCost) },
      { id: 'supplier', header: 'Supplier', accessorFn: (r) => r.supplier?.name ?? '',
        cell: ({ row }) => <span className="text-ink-muted">{row.original.supplier?.name ?? '-'}</span> },
      { id: 'receivedAt', header: 'Received', accessorKey: 'receivedAt',
        cell: ({ row }) => <span className="text-ink-muted">{fmtDate(row.original.receivedAt)}</span> },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="Material Lots"
        description="One lot per delivery. Lots carry the shade, width and cost that make a quantity traceable back to what the supplier actually sent."
      />
      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} className="mb-3" /> : null}
      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        isFetching={isFetching}
        pagination={paginationProps(data, state)}
        search={{ value: state.search, onChange: state.setSearch, placeholder: 'Lot code, supplier reference, shade' }}
        exportFileName="material-lots"
        emptyTitle="No lots yet"
      />
    </div>
  );
}
