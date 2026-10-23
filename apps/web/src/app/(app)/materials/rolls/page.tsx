'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import { FABRIC_ROLL_STATUSES } from '@dnd/contracts';
import { api } from '@/lib/api';
import { useListQuery, useListState, paginationProps } from '@/lib/hooks';
import { fmtDate, fmtQty, humanise, uomShort } from '@/lib/utils';
import { Badge, Card, CardBody, CardHeader, ErrorPanel, NativeSelect, PageHeader, StatusBadge } from '@/components/ui/primitives';
import { CodeCell, DataTable, StackedCell } from '@/components/ui/data-table';

interface RollRow {
  id: string; rollNo: string; shade: string | null; color: string | null;
  width: string | null; gsm: number | null; originalLength: string; currentLength: string;
  reservedLength: string; availableLength: string; lengthUom: string; status: string;
  qcStatus: string | null; receivedAt: string | null;
  rawMaterial: { id: string; materialCode: string; name: string };
  materialLot: { id: string; lotCode: string; shade: string | null };
  location: { id: string; code: string; name: string; kind: string };
  barcode: { code: string } | null;
}

interface Reconciliation {
  checkedKeys: number;
  isReconciled: boolean;
  variances: { rawMaterialId: string; rollLength: string; ledgerQty: string; varianceQty: string }[];
}

export default function FabricRollsPage() {
  const state = useListState({ sortBy: 'rollNo', sortDir: 'asc' });
  const { data, isLoading, isFetching, error, refetch } = useListQuery<RollRow>(
    'fabric-rolls', '/fabric-rolls', state,
  );

  const { data: recon } = useQuery({
    queryKey: ['fabric-rolls', 'reconciliation'],
    queryFn: () => api.get<Reconciliation>('/fabric-rolls/reconciliation'),
  });

  const columns = React.useMemo<ColumnDef<RollRow, unknown>[]>(
    () => [
      { id: 'rollNo', header: 'Roll', accessorKey: 'rollNo', cell: ({ row }) => <CodeCell>{row.original.rollNo}</CodeCell> },
      {
        id: 'material', header: 'Fabric',
        accessorFn: (r) => r.rawMaterial.materialCode,
        cell: ({ row }) => (
          <StackedCell primary={row.original.rawMaterial.materialCode} secondary={row.original.rawMaterial.name} />
        ),
      },
      { id: 'lot', header: 'Lot', accessorFn: (r) => r.materialLot.lotCode, cell: ({ row }) => <CodeCell>{row.original.materialLot.lotCode}</CodeCell> },
      { id: 'shade', header: 'Shade', accessorKey: 'shade', cell: ({ row }) => row.original.shade ?? '-' },
      {
        id: 'width', header: 'Width', accessorKey: 'width', meta: { align: 'right', numeric: true },
        cell: ({ row }) => (row.original.width ? `${fmtQty(row.original.width, 1)}"` : '-'),
      },
      {
        id: 'originalLength', header: 'Original', accessorKey: 'originalLength',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => <span className="text-ink-muted">{fmtQty(row.original.originalLength)}</span>,
      },
      {
        id: 'currentLength', header: 'Remaining', accessorKey: 'currentLength',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => (
          <span className="font-medium">
            {fmtQty(row.original.currentLength)} {uomShort(row.original.lengthUom)}
          </span>
        ),
      },
      {
        id: 'reservedLength', header: 'Reserved', accessorKey: 'reservedLength',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => <span className="text-ink-muted">{fmtQty(row.original.reservedLength)}</span>,
      },
      {
        id: 'location', header: 'Location', accessorFn: (r) => r.location.code,
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <CodeCell>{row.original.location.code}</CodeCell>
            <StatusBadge status={row.original.location.kind} />
          </div>
        ),
      },
      { id: 'status', header: 'Status', accessorKey: 'status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      {
        id: 'receivedAt', header: 'Received', accessorKey: 'receivedAt',
        cell: ({ row }) => <span className="text-ink-muted">{fmtDate(row.original.receivedAt)}</span>,
      },
      {
        id: 'barcode', header: 'Barcode',
        accessorFn: (r) => r.barcode?.code ?? '',
        cell: ({ row }) => (row.original.barcode ? <CodeCell>{row.original.barcode.code}</CodeCell> : '-'),
      },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="Fabric Rolls"
        description="Every roll is individually identified and barcoded. Roll lengths and the stock ledger are two projections of the same movements, so they can be reconciled against each other."
      />

      {recon ? (
        <Card className="mb-3">
          <CardBody className="flex flex-wrap items-center gap-3 py-2.5">
            <Badge tone={recon.isReconciled ? 'ok' : 'danger'}>
              {recon.isReconciled ? 'Reconciled' : `${recon.variances.length} variances`}
            </Badge>
            <span className="text-[12.5px] text-ink-muted">
              {recon.isReconciled
                ? `Roll lengths match the stock ledger across all ${recon.checkedKeys} material, lot and location combinations.`
                : 'Roll lengths disagree with the stock ledger. A roll length was changed without a matching movement.'}
            </span>
          </CardBody>
        </Card>
      ) : null}

      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} className="mb-3" /> : null}

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        isFetching={isFetching}
        pagination={paginationProps(data, state)}
        search={{ value: state.search, onChange: state.setSearch, placeholder: 'Roll number, shade, colour' }}
        exportFileName="fabric-rolls"
        emptyTitle="No fabric rolls"
        emptyDescription="Rolls are created when a fabric delivery is received roll by roll."
        toolbar={
          <NativeSelect
            value={String(state.filters.status ?? '')}
            onChange={(e) => state.setFilter('status', e.target.value || undefined)}
            className="w-auto"
            aria-label="Roll status"
          >
            <option value="">Any status</option>
            {FABRIC_ROLL_STATUSES.map((s) => (
              <option key={s} value={s}>{humanise(s)}</option>
            ))}
          </NativeSelect>
        }
      />
    </div>
  );
}
