'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { Check, X } from 'lucide-react';
import { useListQuery, useListState, paginationProps } from '@/lib/hooks';
import { api } from '@/lib/api';
import { fmtDate, fmtQty, humanise, uomShort } from '@/lib/utils';
import { Button, ErrorPanel, NativeSelect, PageHeader, StatusBadge } from '@/components/ui/primitives';
import { CodeCell, DataTable, StackedCell } from '@/components/ui/data-table';
import { useAuth } from '@/components/app/auth-context';

const STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CONVERTED', 'CANCELLED'] as const;

interface RequisitionRow {
  id: string; requisitionNo: string; status: string; requiredByDate: string | null;
  createdAt: string; remarks: string | null;
  items: {
    id: string; requestedQty: string; approvedQty: string | null; orderedQty: string; uom: string;
    rawMaterial: { id: string; materialCode: string; name: string; baseUom: string };
    suggestedSupplier: { id: string; name: string } | null;
  }[];
}

export default function RequisitionsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const state = useListState({ sortBy: 'createdAt', sortDir: 'desc' });
  const { data, isLoading, isFetching, error, refetch } = useListQuery<RequisitionRow>(
    'requisitions', '/purchasing/requisitions', state,
  );

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'APPROVE' | 'REJECT' }) =>
      api.post(`/purchasing/requisitions/${id}/decision`, { decision }),
    onSuccess: (_r, v) => {
      toast.success(v.decision === 'APPROVE' ? 'Requisition approved' : 'Requisition rejected');
      void queryClient.invalidateQueries({ queryKey: ['requisitions'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const columns = React.useMemo<ColumnDef<RequisitionRow, unknown>[]>(
    () => [
      { id: 'requisitionNo', header: 'Request', accessorKey: 'requisitionNo',
        cell: ({ row }) => (
          <StackedCell primary={<CodeCell>{row.original.requisitionNo}</CodeCell>} secondary={fmtDate(row.original.createdAt)} />
        ),
      },
      { id: 'items', header: 'Materials', accessorFn: (r) => r.items.length,
        cell: ({ row }) => (
          <div className="space-y-0.5">
            {row.original.items.slice(0, 3).map((i) => (
              <div key={i.id} className="text-[12px]">
                <CodeCell>{i.rawMaterial.materialCode}</CodeCell>
                <span className="num ml-1.5 text-ink-muted">
                  {fmtQty(i.requestedQty, 0)} {uomShort(i.uom)}
                </span>
              </div>
            ))}
            {row.original.items.length > 3 ? (
              <div className="text-[12px] text-ink-subtle">+{row.original.items.length - 3} more</div>
            ) : null}
          </div>
        ),
      },
      { id: 'requiredByDate', header: 'Needed by', accessorKey: 'requiredByDate',
        cell: ({ row }) => <span className="text-ink-muted">{fmtDate(row.original.requiredByDate)}</span> },
      { id: 'ordered', header: 'Ordered', meta: { align: 'right', numeric: true },
        accessorFn: (r) => r.items.reduce((a, i) => a + Number(i.orderedQty), 0),
        cell: ({ row }) => {
          const ordered = row.original.items.reduce((a, i) => a + Number(i.orderedQty), 0);
          const requested = row.original.items.reduce((a, i) => a + Number(i.requestedQty), 0);
          return (
            <span className={ordered >= requested ? 'text-ok' : 'text-ink-muted'}>
              {fmtQty(String(ordered), 0)} / {fmtQty(String(requested), 0)}
            </span>
          );
        },
      },
      { id: 'status', header: 'Status', accessorKey: 'status',
        cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      { id: 'actions', header: '',
        cell: ({ row }) =>
          row.original.status === 'PENDING_APPROVAL' && can('purchasing.approve_requisition') ? (
            <div className="flex justify-end gap-1">
              <Button
                size="sm"
                variant="primary"
                loading={decide.isPending}
                onClick={() => decide.mutate({ id: row.original.id, decision: 'APPROVE' })}
              >
                <Check />
                Approve
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={() => decide.mutate({ id: row.original.id, decision: 'REJECT' })}
              >
                <X />
              </Button>
            </div>
          ) : null,
        meta: { align: 'right' },
      },
    ],
    [can, decide],
  );

  return (
    <div>
      <PageHeader
        title="Purchase Requests"
        description="Requisitions raised by planners or generated from an MRP run. Approving one authorises a buyer to raise a purchase order against it."
      />
      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} className="mb-3" /> : null}
      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        isFetching={isFetching}
        pagination={paginationProps(data, state)}
        search={{ value: state.search, onChange: state.setSearch, placeholder: 'Requisition number' }}
        exportFileName="purchase-requisitions"
        emptyTitle="No purchase requests"
        emptyDescription="MRP runs will generate these once phase 2 is in place; they can also be raised by hand."
        toolbar={
          <NativeSelect
            value={String(state.filters.status ?? '')}
            onChange={(e) => state.setFilter('status', e.target.value || undefined)}
            className="w-auto"
            aria-label="Status"
          >
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{humanise(s)}</option>
            ))}
          </NativeSelect>
        }
      />
    </div>
  );
}
