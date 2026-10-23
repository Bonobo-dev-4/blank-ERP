'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { SCAN_EVENT_TYPES } from '@dnd/contracts';
import { useListQuery, useListState, paginationProps } from '@/lib/hooks';
import { fmtDateTime, fmtQty, humanise } from '@/lib/utils';
import { Badge, ErrorPanel, NativeSelect, PageHeader } from '@/components/ui/primitives';
import { CodeCell, DataTable, StackedCell } from '@/components/ui/data-table';

interface ScanRow {
  id: string; scannedCode: string; eventType: string; status: string;
  completedQty: string | null; rejectedQty: string | null; reworkQty: string | null;
  validationMessage: string | null; deviceId: string | null; scannedAt: string;
  productionBatch: { id: string; batchNo: string; manufacturingOrder: { moNo: string } } | null;
  operator: { id: string; fullName: string; employeeCode: string | null } | null;
}

const STATUS_TONE: Record<string, 'ok' | 'danger' | 'neutral'> = {
  ACCEPTED: 'ok',
  REJECTED_VALIDATION: 'danger',
  DUPLICATE_IGNORED: 'neutral',
};

export default function ScanHistoryPage() {
  const state = useListState({});

  const { data, isLoading, isFetching, error, refetch } = useListQuery<ScanRow>(
    'scan-history', '/production/scans', state,
  );

  const columns = React.useMemo<ColumnDef<ScanRow, unknown>[]>(
    () => [
      {
        id: 'scannedAt', header: 'When', accessorKey: 'scannedAt',
        cell: ({ row }) => <span className="text-ink-muted">{fmtDateTime(row.original.scannedAt)}</span>,
      },
      {
        id: 'code', header: 'Code', accessorKey: 'scannedCode',
        cell: ({ row }) => <CodeCell>{row.original.scannedCode}</CodeCell>,
      },
      {
        id: 'batch', header: 'Batch', accessorFn: (r) => r.productionBatch?.batchNo ?? '',
        cell: ({ row }) =>
          row.original.productionBatch ? (
            <StackedCell
              primary={row.original.productionBatch.batchNo}
              secondary={row.original.productionBatch.manufacturingOrder.moNo}
            />
          ) : (
            <span className="text-ink-subtle">—</span>
          ),
      },
      {
        id: 'eventType', header: 'Event', accessorKey: 'eventType',
        cell: ({ row }) => <span className="text-ink-muted">{humanise(row.original.eventType)}</span>,
      },
      {
        id: 'qty', header: 'Quantities',
        accessorFn: (r) => Number(r.completedQty ?? 0),
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => {
          const parts: string[] = [];
          if (Number(row.original.completedQty) > 0) parts.push(`${fmtQty(row.original.completedQty, 0)} good`);
          if (Number(row.original.rejectedQty) > 0) parts.push(`${fmtQty(row.original.rejectedQty, 0)} rejected`);
          if (Number(row.original.reworkQty) > 0) parts.push(`${fmtQty(row.original.reworkQty, 0)} rework`);
          return parts.length > 0 ? parts.join(', ') : <span className="text-ink-subtle">—</span>;
        },
      },
      {
        id: 'operator', header: 'Operator', accessorFn: (r) => r.operator?.fullName ?? '',
        cell: ({ row }) =>
          row.original.operator ? (
            <StackedCell
              primary={row.original.operator.fullName}
              secondary={row.original.operator.employeeCode ?? ''}
            />
          ) : (
            <span className="text-ink-subtle">—</span>
          ),
      },
      {
        id: 'device', header: 'Device', accessorKey: 'deviceId',
        cell: ({ row }) => (
          <span className="font-mono text-[11.5px] text-ink-muted">{row.original.deviceId ?? '—'}</span>
        ),
      },
      {
        id: 'status', header: 'Outcome', accessorKey: 'status',
        cell: ({ row }) => (
          <div>
            <Badge tone={STATUS_TONE[row.original.status] ?? 'neutral'}>
              {humanise(row.original.status)}
            </Badge>
            {row.original.validationMessage ? (
              <p className="mt-0.5 max-w-[260px] truncate text-[11px] text-ink-muted">
                {row.original.validationMessage}
              </p>
            ) : null}
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="Scan History"
        description="Every scan, accepted and refused. A refused scan is kept deliberately: five refusals at one station is a label problem or a training problem, and it is invisible if only successes are stored."
      />

      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} className="mb-3" /> : null}

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        isFetching={isFetching}
        pagination={paginationProps(data, state)}
        search={{ value: state.search, onChange: state.setSearch, placeholder: 'Scanned code' }}
        exportFileName="scan-history"
        emptyTitle="No scans yet"
        toolbar={
          <>
            <NativeSelect
              value={String(state.filters.status ?? '')}
              onChange={(e) => state.setFilter('status', e.target.value || undefined)}
              className="w-auto"
              aria-label="Outcome"
            >
              <option value="">Any outcome</option>
              <option value="ACCEPTED">Accepted</option>
              <option value="REJECTED_VALIDATION">Refused</option>
              <option value="DUPLICATE_IGNORED">Duplicate</option>
            </NativeSelect>
            <NativeSelect
              value={String(state.filters.eventType ?? '')}
              onChange={(e) => state.setFilter('eventType', e.target.value || undefined)}
              className="w-auto"
              aria-label="Event type"
            >
              <option value="">Any event</option>
              {SCAN_EVENT_TYPES.map((t) => (
                <option key={t} value={t}>{humanise(t)}</option>
              ))}
            </NativeSelect>
          </>
        }
      />
    </div>
  );
}
