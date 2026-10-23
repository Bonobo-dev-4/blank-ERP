'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { RECEIPT_STATUSES } from '@dnd/contracts';
import { useListQuery, useListState, paginationProps } from '@/lib/hooks';
import { fmtDate, fmtQty, humanise } from '@/lib/utils';
import { ErrorPanel, NativeSelect, PageHeader, StatusBadge } from '@/components/ui/primitives';
import { CodeCell, DataTable, StackedCell } from '@/components/ui/data-table';

interface ReceiptRow {
  id: string; grnNo: string; status: string; receiptDate: string;
  supplierInvoiceNo: string | null; supplierDcNo: string | null;
  supplier: { id: string; name: string };
  purchaseOrder: { id: string; poNo: string } | null;
  targetLocation: { id: string; code: string; name: string };
  barcode: { code: string } | null;
  lines: {
    id: string; lineNo: number; receivedBaseQty: string; acceptedBaseQty: string;
    rejectedBaseQty: string; inspectionResult: string | null;
    rawMaterial: { materialCode: string; name: string; baseUom: string };
  }[];
}

export default function ReceiptsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const state = useListState({
    sortBy: 'receiptDate',
    sortDir: 'desc',
    filters: { status: params.get('status') ?? undefined },
  });

  const { data, isLoading, isFetching, error, refetch } = useListQuery<ReceiptRow>(
    'receipts', '/purchasing/receipts', state,
  );

  const columns = React.useMemo<ColumnDef<ReceiptRow, unknown>[]>(
    () => [
      { id: 'grnNo', header: 'GRN', accessorKey: 'grnNo',
        cell: ({ row }) => <CodeCell>{row.original.grnNo}</CodeCell> },
      { id: 'supplier', header: 'Supplier', accessorFn: (r) => r.supplier.name,
        cell: ({ row }) => (
          <StackedCell
            primary={row.original.supplier.name}
            secondary={row.original.purchaseOrder ? `against ${row.original.purchaseOrder.poNo}` : 'no purchase order'}
          />
        ),
      },
      { id: 'lines', header: 'Lines', accessorFn: (r) => r.lines.length,
        meta: { align: 'right', numeric: true } },
      { id: 'received', header: 'Received', meta: { align: 'right', numeric: true },
        accessorFn: (r) => r.lines.reduce((a, l) => a + Number(l.receivedBaseQty), 0),
        cell: ({ row }) => (
          <span className="font-medium">
            {fmtQty(String(row.original.lines.reduce((a, l) => a + Number(l.receivedBaseQty), 0)))}
          </span>
        ),
      },
      { id: 'accepted', header: 'Accepted', meta: { align: 'right', numeric: true },
        accessorFn: (r) => r.lines.reduce((a, l) => a + Number(l.acceptedBaseQty), 0),
        cell: ({ row }) => {
          const total = row.original.lines.reduce((a, l) => a + Number(l.acceptedBaseQty), 0);
          return row.original.status === 'POSTED' ? (
            <span className="text-ok">{fmtQty(String(total))}</span>
          ) : (
            <span className="text-ink-subtle">pending</span>
          );
        },
      },
      { id: 'rejected', header: 'Rejected', meta: { align: 'right', numeric: true },
        accessorFn: (r) => r.lines.reduce((a, l) => a + Number(l.rejectedBaseQty), 0),
        cell: ({ row }) => {
          const total = row.original.lines.reduce((a, l) => a + Number(l.rejectedBaseQty), 0);
          return total > 0 ? <span className="text-danger">{fmtQty(String(total))}</span> : <span className="text-ink-subtle">-</span>;
        },
      },
      { id: 'targetLocation', header: 'Release to', accessorFn: (r) => r.targetLocation.code,
        cell: ({ row }) => <CodeCell>{row.original.targetLocation.code}</CodeCell> },
      { id: 'supplierInvoiceNo', header: 'Invoice', accessorKey: 'supplierInvoiceNo',
        cell: ({ row }) => <span className="text-ink-muted">{row.original.supplierInvoiceNo ?? '-'}</span> },
      { id: 'receiptDate', header: 'Received on', accessorKey: 'receiptDate',
        cell: ({ row }) => <span className="text-ink-muted">{fmtDate(row.original.receiptDate)}</span> },
      { id: 'status', header: 'Status', accessorKey: 'status',
        cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="Goods Receipts"
        description="Supplier deliveries. A receipt puts stock into QC hold; inspection is the separate step that releases it to a location production can draw on."
      />
      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} className="mb-3" /> : null}
      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        isFetching={isFetching}
        pagination={paginationProps(data, state)}
        search={{ value: state.search, onChange: state.setSearch, placeholder: 'GRN number, invoice, challan' }}
        onRowClick={(row) => router.push(`/purchasing/receipts/${row.id}`)}
        exportFileName="goods-receipts"
        emptyTitle="No goods receipts"
        emptyDescription="Record a delivery from an approved purchase order."
        toolbar={
          <NativeSelect
            value={String(state.filters.status ?? '')}
            onChange={(e) => state.setFilter('status', e.target.value || undefined)}
            className="w-auto"
            aria-label="Status"
          >
            <option value="">Any status</option>
            {RECEIPT_STATUSES.map((s) => (
              <option key={s} value={s}>{humanise(s)}</option>
            ))}
          </NativeSelect>
        }
      />
    </div>
  );
}
