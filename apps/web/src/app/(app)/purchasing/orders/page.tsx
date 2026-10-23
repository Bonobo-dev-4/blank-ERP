'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { PURCHASE_ORDER_STATUSES } from '@dnd/contracts';
import { useListQuery, useListState, paginationProps } from '@/lib/hooks';
import { fmtDate, fmtMoney, fmtQty, humanise } from '@/lib/utils';
import { Button, ErrorPanel, NativeSelect, PageHeader, StatusBadge } from '@/components/ui/primitives';
import { CodeCell, DataTable, StackedCell } from '@/components/ui/data-table';
import { useAuth } from '@/components/app/auth-context';

interface PoRow {
  id: string; poNo: string; status: string; orderDate: string; expectedDate: string | null;
  totalAmount: string; currency: string; pendingBaseQty: string;
  overReceiptTolerancePct: string; underReceiptTolerancePct: string;
  supplier: { id: string; supplierCode: string; name: string };
  items: { id: string; lineNo: number; orderedBaseQty: string; receivedBaseQty: string;
    rawMaterial: { materialCode: string; name: string; baseUom: string } }[];
  _count: { receipts: number };
}

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useAuth();

  const state = useListState({
    sortBy: 'orderDate',
    sortDir: 'desc',
    filters: {
      status: params.get('status') ?? undefined,
      overdueOnly: params.get('overdueOnly') === 'true' ? true : undefined,
    },
  });

  const { data, isLoading, isFetching, error, refetch } = useListQuery<PoRow>(
    'purchase-orders', '/purchasing/orders', state,
  );

  const columns = React.useMemo<ColumnDef<PoRow, unknown>[]>(
    () => [
      { id: 'poNo', header: 'PO', accessorKey: 'poNo', cell: ({ row }) => <CodeCell>{row.original.poNo}</CodeCell> },
      { id: 'supplier', header: 'Supplier', accessorFn: (r) => r.supplier.name,
        cell: ({ row }) => (
          <StackedCell primary={row.original.supplier.name} secondary={row.original.supplier.supplierCode} />
        ),
      },
      { id: 'items', header: 'Lines', accessorFn: (r) => r.items.length,
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => row.original.items.length },
      { id: 'materials', header: 'Materials',
        accessorFn: (r) => r.items.map((i) => i.rawMaterial.materialCode).join(' '),
        cell: ({ row }) => (
          <span className="block max-w-[240px] truncate font-mono text-[11.5px] text-ink-muted">
            {row.original.items.map((i) => i.rawMaterial.materialCode).join(', ')}
          </span>
        ),
      },
      { id: 'pendingBaseQty', header: 'Outstanding', accessorKey: 'pendingBaseQty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) =>
          Number(row.original.pendingBaseQty) > 0 ? (
            <span className="font-medium">{fmtQty(row.original.pendingBaseQty)}</span>
          ) : (
            <span className="text-ink-subtle">-</span>
          ),
      },
      { id: 'totalAmount', header: 'Value', accessorKey: 'totalAmount',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => fmtMoney(row.original.totalAmount) },
      { id: 'orderDate', header: 'Ordered', accessorKey: 'orderDate',
        cell: ({ row }) => <span className="text-ink-muted">{fmtDate(row.original.orderDate)}</span> },
      { id: 'expectedDate', header: 'Expected', accessorKey: 'expectedDate',
        cell: ({ row }) => {
          const d = row.original.expectedDate;
          const overdue =
            d && new Date(d) < new Date() && ['APPROVED', 'PARTIALLY_RECEIVED'].includes(row.original.status);
          return <span className={overdue ? 'font-medium text-danger' : 'text-ink-muted'}>{fmtDate(d)}</span>;
        },
      },
      { id: 'receipts', header: 'GRNs', accessorFn: (r) => r._count.receipts,
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => (row.original._count.receipts > 0 ? row.original._count.receipts : '-') },
      { id: 'status', header: 'Status', accessorKey: 'status',
        cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="Purchase Orders"
        description="Raw material purchase orders. A short delivery leaves an order PARTIALLY_RECEIVED - it is never closed automatically, because abandoning outstanding quantity is a decision someone has to make."
        actions={
          can('purchasing.write_po') ? (
            <Button variant="primary" onClick={() => router.push('/purchasing/orders/new')}>
              <Plus />
              New purchase order
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
        search={{ value: state.search, onChange: state.setSearch, placeholder: 'PO number or remarks' }}
        onRowClick={(row) => router.push(`/purchasing/orders/${row.id}`)}
        exportFileName="purchase-orders"
        emptyTitle="No purchase orders"
        toolbar={
          <>
            <NativeSelect
              value={String(state.filters.status ?? '')}
              onChange={(e) => state.setFilter('status', e.target.value || undefined)}
              className="w-auto"
              aria-label="Status"
            >
              <option value="">Any status</option>
              {PURCHASE_ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>{humanise(s)}</option>
              ))}
            </NativeSelect>
            <label className="flex items-center gap-1.5 whitespace-nowrap text-[12px] text-ink-muted">
              <input
                type="checkbox"
                checked={Boolean(state.filters.overdueOnly)}
                onChange={(e) => state.setFilter('overdueOnly', e.target.checked || undefined)}
              />
              Overdue only
            </label>
          </>
        }
      />
    </div>
  );
}
