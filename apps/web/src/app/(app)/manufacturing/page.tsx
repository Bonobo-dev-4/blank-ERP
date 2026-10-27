'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { MANUFACTURING_ORDER_STATUSES, PRIORITIES } from '@dnd/contracts';
import { useListQuery, useListState, paginationProps } from '@/lib/hooks';
import { fmtDate, fmtQty, humanise } from '@/lib/utils';
import { Badge, Button, ErrorPanel, NativeSelect, PageHeader, StatusBadge } from '@/components/ui/primitives';
import { CodeCell, DataTable, StackedCell } from '@/components/ui/data-table';
import { useAuth } from '@/components/app/auth-context';

export interface MoRow {
  id: string; moNo: string; status: string; priority: string; productionType: string;
  dueDate: string | null; plannedStartDate: string | null; releasedAt: string | null;
  isOverdue: boolean; isEditable: boolean; hasBomSnapshot: boolean;
  product: { id: string; styleCode: string; name: string; category: string } | null;
  rollup: {
    orderedQty: string; releasedQty: string; inwardedQty: string;
    pendingReleaseQty: string; completionPct: string;
  };
  items: { id: string; productVariantId: string; size: string | null; orderedQty: string;
    productVariant: { sku: string; size: string | null } }[];
}

const PRIORITY_TONE: Record<string, 'neutral' | 'info' | 'warn' | 'danger'> = {
  LOW: 'neutral', NORMAL: 'neutral', HIGH: 'warn', URGENT: 'danger',
};

export default function ManufacturingOrdersPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useAuth();

  const state = useListState({
    sortBy: 'createdAt',
    sortDir: 'desc',
    filters: {
      status: params.get('status') ?? undefined,
      overdueOnly: params.get('overdueOnly') === 'true' ? true : undefined,
    },
  });

  const { data, isLoading, isFetching, error, refetch } = useListQuery<MoRow>(
    'manufacturing-orders', '/manufacturing/orders', state,
  );

  const columns = React.useMemo<ColumnDef<MoRow, unknown>[]>(
    () => [
      { id: 'moNo', header: 'Order', accessorKey: 'moNo', cell: ({ row }) => <CodeCell>{row.original.moNo}</CodeCell> },
      {
        id: 'product', header: 'Style', accessorFn: (r) => r.product?.styleCode ?? '',
        cell: ({ row }) => (
          <StackedCell
            primary={row.original.product?.name ?? '—'}
            secondary={row.original.product?.styleCode ?? ''}
          />
        ),
      },
      {
        id: 'sizes', header: 'Sizes', accessorFn: (r) => r.items.length,
        cell: ({ row }) => (
          <span className="block max-w-[200px] truncate text-[12px] text-ink-muted">
            {row.original.items
              .map((i) => `${i.productVariant.size ?? i.productVariant.sku} ${fmtQty(i.orderedQty, 0)}`)
              .join(', ')}
          </span>
        ),
      },
      {
        id: 'orderedQty', header: 'Ordered', accessorFn: (r) => Number(r.rollup.orderedQty),
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => <span className="font-medium">{fmtQty(row.original.rollup.orderedQty, 0)}</span>,
      },
      {
        id: 'releasedQty', header: 'Released', accessorFn: (r) => Number(r.rollup.releasedQty),
        meta: { align: 'right', numeric: true },
        cell: ({ row }) =>
          Number(row.original.rollup.releasedQty) > 0
            ? fmtQty(row.original.rollup.releasedQty, 0)
            : <span className="text-ink-subtle">-</span>,
      },
      {
        id: 'completion', header: 'Inwarded', accessorFn: (r) => Number(r.rollup.completionPct),
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => (
          // Completion means finished goods exist, not that a stage reported a
          // number. Phase 3 is what will start moving this.
          <span className={Number(row.original.rollup.completionPct) > 0 ? '' : 'text-ink-subtle'}>
            {fmtQty(row.original.rollup.completionPct, 0)}%
          </span>
        ),
      },
      {
        id: 'priority', header: 'Priority', accessorKey: 'priority',
        cell: ({ row }) => (
          <Badge tone={PRIORITY_TONE[row.original.priority] ?? 'neutral'}>
            {humanise(row.original.priority)}
          </Badge>
        ),
      },
      {
        id: 'dueDate', header: 'Due', accessorKey: 'dueDate',
        cell: ({ row }) => (
          <span className={row.original.isOverdue ? 'font-medium text-danger' : 'text-ink-muted'}>
            {fmtDate(row.original.dueDate)}
          </span>
        ),
      },
      { id: 'status', header: 'Status', accessorKey: 'status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="Manufacturing Orders"
        description="Releasing an order freezes the BOM version it was planned against into an immutable snapshot. Everything downstream — costing, issue limits, wastage analysis — reads that snapshot, so a later BOM edit cannot rewrite work already on the floor."
        actions={
          can('manufacturing.write') ? (
            <Button variant="primary" onClick={() => router.push('/manufacturing/new')}>
              <Plus />
              New order
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
        search={{ value: state.search, onChange: state.setSearch, placeholder: 'Order number' }}
        onRowClick={(row) => router.push(`/manufacturing/${row.id}`)}
        exportFileName="manufacturing-orders"
        emptyTitle="No manufacturing orders"
        emptyDescription="An order needs a style with an approved BOM before it can be planned or released."
        toolbar={
          <>
            <NativeSelect
              value={String(state.filters.status ?? '')}
              onChange={(e) => state.setFilter('status', e.target.value || undefined)}
              className="w-auto"
              aria-label="Status"
            >
              <option value="">Any status</option>
              {MANUFACTURING_ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>{humanise(s)}</option>
              ))}
            </NativeSelect>
            <NativeSelect
              value={String(state.filters.priority ?? '')}
              onChange={(e) => state.setFilter('priority', e.target.value || undefined)}
              className="w-auto"
              aria-label="Priority"
            >
              <option value="">Any priority</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{humanise(p)}</option>
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
