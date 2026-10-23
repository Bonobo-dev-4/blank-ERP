'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowRight } from 'lucide-react';
import { MOVEMENT_TYPES } from '@dnd/contracts';
import { useListQuery, useListState, paginationProps } from '@/lib/hooks';
import { fmtDateTime, fmtMoney, fmtQty, humanise, uomShort } from '@/lib/utils';
import { Badge, ErrorPanel, Input, NativeSelect, PageHeader } from '@/components/ui/primitives';
import { CodeCell, DataTable, StackedCell } from '@/components/ui/data-table';

interface MovementRow {
  id: string; movementNo: string; movementType: string; enteredQty: string; enteredUom: string;
  baseQty: string; baseUom: string; unitCost: string | null; totalCost: string | null;
  referenceType: string | null; referenceNo: string | null; reason: string | null;
  occurredAt: string;
  rawMaterial: { id: string; materialCode: string; name: string; baseUom: string };
  materialLot: { id: string; lotCode: string; shade: string | null };
  fabricRoll: { id: string; rollNo: string } | null;
  sourceLocation: { id: string; code: string; name: string; kind: string };
  destinationLocation: { id: string; code: string; name: string; kind: string };
}

export default function MovementsPage() {
  const params = useSearchParams();
  const state = useListState({
    pageSize: 50,
    filters: {
      rawMaterialId: params.get('rawMaterialId') ?? undefined,
      fabricRollId: params.get('fabricRollId') ?? undefined,
    },
  });

  const { data, isLoading, isFetching, error, refetch } = useListQuery<MovementRow>(
    'movements', '/inventory/movements', state,
  );

  const columns = React.useMemo<ColumnDef<MovementRow, unknown>[]>(
    () => [
      {
        id: 'occurredAt', header: 'When', accessorKey: 'occurredAt',
        cell: ({ row }) => (
          <StackedCell primary={fmtDateTime(row.original.occurredAt)} secondary={row.original.movementNo} />
        ),
      },
      {
        id: 'movementType', header: 'Type', accessorKey: 'movementType',
        cell: ({ row }) => <Badge tone="outline">{humanise(row.original.movementType)}</Badge>,
      },
      {
        id: 'material', header: 'Material', accessorFn: (r) => r.rawMaterial.materialCode,
        cell: ({ row }) => (
          <Link href={`/materials/${row.original.rawMaterial.id}`} className="hover:underline">
            <StackedCell
              primary={row.original.rawMaterial.materialCode}
              secondary={[row.original.materialLot.lotCode, row.original.fabricRoll?.rollNo]
                .filter(Boolean)
                .join(' · ')}
            />
          </Link>
        ),
      },
      {
        id: 'route', header: 'From → To',
        accessorFn: (r) => `${r.sourceLocation.code} ${r.destinationLocation.code}`,
        cell: ({ row }) => (
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <CodeCell>{row.original.sourceLocation.code}</CodeCell>
            <ArrowRight className="size-3 text-ink-subtle" />
            <CodeCell>{row.original.destinationLocation.code}</CodeCell>
          </span>
        ),
      },
      {
        id: 'baseQty', header: 'Quantity', accessorKey: 'baseQty',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => (
          <div>
            <span className="font-medium">
              {fmtQty(row.original.baseQty)} {uomShort(row.original.baseUom)}
            </span>
            {row.original.enteredUom !== row.original.baseUom ? (
              <div className="text-[11px] text-ink-muted">
                entered {fmtQty(row.original.enteredQty)} {uomShort(row.original.enteredUom)}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        id: 'totalCost', header: 'Value', accessorKey: 'totalCost',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => <span className="text-ink-muted">{fmtMoney(row.original.totalCost)}</span>,
      },
      {
        id: 'reference', header: 'Reference',
        accessorFn: (r) => r.referenceNo ?? r.referenceType ?? '',
        cell: ({ row }) => (
          <StackedCell
            primary={row.original.referenceNo ?? '-'}
            secondary={row.original.referenceType ? humanise(row.original.referenceType) : undefined}
          />
        ),
      },
      {
        id: 'reason', header: 'Reason', accessorKey: 'reason',
        cell: ({ row }) => (
          <span className="block max-w-[260px] truncate text-[11.5px] text-ink-muted" title={row.original.reason ?? ''}>
            {row.original.reason ?? '-'}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="Material Movements"
        description="The append-only stock ledger. Rows are never edited or deleted: a correction is a new reversing movement, so the history stays intact."
      />

      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} className="mb-3" /> : null}

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        isFetching={isFetching}
        pagination={paginationProps(data, state)}
        search={{ value: state.search, onChange: state.setSearch, placeholder: 'Movement number, reference, reason' }}
        exportFileName="material-movements"
        emptyTitle="No movements recorded"
        emptyDescription="Every stock change creates a row here, so this stays empty until the first receipt is posted."
        toolbar={
          <>
            <NativeSelect
              value={String(state.filters.movementType ?? '')}
              onChange={(e) => state.setFilter('movementType', e.target.value || undefined)}
              className="w-auto"
              aria-label="Movement type"
            >
              <option value="">All types</option>
              {MOVEMENT_TYPES.map((t) => (
                <option key={t} value={t}>{humanise(t)}</option>
              ))}
            </NativeSelect>
            <Input
              type="date"
              value={String(state.filters.fromDate ?? '')}
              onChange={(e) => {
                const v = e.target.value;
                state.setFilter('fromDate', v || undefined);
                state.setFilter('from', v ? new Date(`${v}T00:00:00.000Z`).toISOString() : undefined);
              }}
              className="w-auto"
              aria-label="From date"
            />
          </>
        }
      />
    </div>
  );
}
