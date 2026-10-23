'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { Play } from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { useListQuery, useListState, paginationProps } from '@/lib/hooks';
import { fmtDateTime, fmtInt, fmtMoney } from '@/lib/utils';
import {
  Button, ErrorPanel, Field, NativeSelect, PageHeader, QtyInput, StatusBadge,
} from '@/components/ui/primitives';
import { CodeCell, DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useAuth } from '@/components/app/auth-context';

interface RunRow {
  id: string; runNo: string; status: string; createdAt: string; completedAt: string | null;
  shortageLineCount: number; totalShortageValue: string;
  _count: { requirements: number; requisitions: number };
}

interface MoOption {
  id: string; moNo: string; status: string;
  product: { styleCode: string; name: string } | null;
  rollup: { orderedQty: string };
}

interface ProductOption { id: string; styleCode: string; name: string }

export default function MrpRunsPage() {
  const router = useRouter();
  const { can } = useAuth();
  const [open, setOpen] = React.useState(false);

  const state = useListState({ sortBy: 'createdAt', sortDir: 'desc' });
  const { data, isLoading, isFetching, error, refetch } = useListQuery<RunRow>('mrp-runs', '/mrp/runs', state);

  const columns = React.useMemo<ColumnDef<RunRow, unknown>[]>(
    () => [
      { id: 'runNo', header: 'Run', accessorKey: 'runNo', cell: ({ row }) => <CodeCell>{row.original.runNo}</CodeCell> },
      {
        id: 'createdAt', header: 'Run at', accessorKey: 'createdAt',
        cell: ({ row }) => <span className="text-ink-muted">{fmtDateTime(row.original.createdAt)}</span>,
      },
      {
        id: 'requirements', header: 'Lines', accessorFn: (r) => r._count.requirements,
        meta: { align: 'right', numeric: true },
      },
      {
        id: 'shortageLineCount', header: 'Short', accessorKey: 'shortageLineCount',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) =>
          row.original.shortageLineCount > 0 ? (
            <span className="font-medium text-danger">{fmtInt(row.original.shortageLineCount)}</span>
          ) : (
            <span className="text-ok">0</span>
          ),
      },
      {
        id: 'totalShortageValue', header: 'Shortage value', accessorKey: 'totalShortageValue',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) =>
          Number(row.original.totalShortageValue) > 0
            ? fmtMoney(row.original.totalShortageValue)
            : <span className="text-ink-subtle">-</span>,
      },
      {
        id: 'requisitions', header: 'Requisitions', accessorFn: (r) => r._count.requisitions,
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => (row.original._count.requisitions > 0 ? row.original._count.requisitions : '-'),
      },
      { id: 'status', header: 'Status', accessorKey: 'status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="Material Requirements"
        description="Each run is a snapshot with a timestamp, not a live view — requisitions are raised from it, and those quantities have to still mean something when someone approves them an hour later."
        actions={
          can('mrp.run') ? (
            <Button variant="primary" onClick={() => setOpen(true)}>
              <Play />
              Run MRP
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
        search={{ value: state.search, onChange: state.setSearch, placeholder: 'Run number' }}
        onRowClick={(row) => router.push(`/mrp/${row.id}`)}
        exportFileName="mrp-runs"
        emptyTitle="No MRP runs yet"
        emptyDescription="Run planning against open manufacturing orders, or ad-hoc against a style and a quantity."
      />

      <RunMrpDialog open={open} onOpenChange={setOpen} onDone={(runId) => router.push(`/mrp/${runId}`)} />
    </div>
  );
}

/**
 * Two scopes, deliberately exclusive.
 *
 * Planning open orders is the normal path. The ad-hoc scope answers "what
 * would it take to make 100 of this?" before an order exists — which is how a
 * planner decides whether to raise one at all.
 */
function RunMrpDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (runId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [scope, setScope] = React.useState<'ORDERS' | 'AD_HOC'>('ORDERS');
  const [selected, setSelected] = React.useState<string[]>([]);
  const [productId, setProductId] = React.useState('');
  const [quantity, setQuantity] = React.useState('100');

  const orders = useQuery({
    queryKey: ['mo', 'mrp-picker'],
    queryFn: () => api.get<Paginated<MoOption>>('/manufacturing/orders', { pageSize: 100 }),
    enabled: open,
  });
  const products = useQuery({
    queryKey: ['products', 'mrp-picker'],
    queryFn: () => api.get<Paginated<ProductOption>>('/products', { pageSize: 200 }),
    enabled: open,
  });

  const run = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/mrp/runs', {
        ...(scope === 'ORDERS'
          ? { manufacturingOrderIds: selected }
          : { adHoc: { productId, lines: [{ quantity }] } }),
      }),
    onSuccess: (res) => {
      toast.success('MRP run complete');
      void queryClient.invalidateQueries();
      onOpenChange(false);
      onDone(res.id);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const canRun = scope === 'ORDERS' ? selected.length > 0 : Boolean(productId) && Number(quantity) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Run material requirement planning"
        footer={
          <>
            <Button onClick={() => onOpenChange(false)} disabled={run.isPending}>Cancel</Button>
            <Button variant="primary" disabled={!canRun} loading={run.isPending} onClick={() => run.mutate()}>
              Run
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Plan">
            <NativeSelect value={scope} onChange={(e) => setScope(e.target.value as 'ORDERS' | 'AD_HOC')}>
              <option value="ORDERS">Existing manufacturing orders</option>
              <option value="AD_HOC">An ad-hoc quantity of a style</option>
            </NativeSelect>
          </Field>

          {scope === 'ORDERS' ? (
            <Field
              label="Orders"
              hint="Planning several together is what stops the same metre being promised twice."
            >
              <div className="max-h-56 space-y-0.5 overflow-y-auto rounded border border-line p-1.5">
                {(orders.data?.data ?? []).length === 0 ? (
                  <p className="px-1 py-3 text-center text-[12px] text-ink-muted">
                    No manufacturing orders yet.
                  </p>
                ) : (
                  (orders.data?.data ?? []).map((o) => (
                    <label
                      key={o.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[12.5px] hover:bg-surface-muted"
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(o.id)}
                        onChange={(e) =>
                          setSelected((s) => (e.target.checked ? [...s, o.id] : s.filter((x) => x !== o.id)))
                        }
                      />
                      <span className="font-mono text-[11.5px]">{o.moNo}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-muted">
                        {o.product?.styleCode ?? ''} · {o.rollup.orderedQty} pcs
                      </span>
                      <StatusBadge status={o.status} />
                    </label>
                  ))
                )}
              </div>
            </Field>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Style" required>
                <NativeSelect value={productId} onChange={(e) => setProductId(e.target.value)}>
                  <option value="">Select a style</option>
                  {(products.data?.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>{p.styleCode} — {p.name}</option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Garments" required>
                <QtyInput value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </Field>
            </div>
          )}

          <p className="rounded border border-line bg-surface-muted px-2.5 py-2 text-[12px] text-ink-muted">
            Open purchase orders are reported with their expected arrival date but are{' '}
            <strong className="text-ink">not counted as stock</strong>. Fabric on a lorry cannot be cut.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
