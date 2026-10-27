'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BadgeCheck, Check, X } from 'lucide-react';
import { useListQuery, useListState } from '@/lib/hooks';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtQty, uomShort } from '@/lib/utils';
import {
  Button, Card, CardBody, CardHeader, EmptyState, ErrorPanel, LoadingBlock, PageHeader,
} from '@/components/ui/primitives';
import { CodeCell } from '@/components/ui/data-table';
import { useAuth } from '@/components/app/auth-context';

interface PendingPo {
  id: string; poNo: string; orderDate: string; expectedDate: string | null;
  totalAmount: string; subtotalAmount: string; taxAmount: string; freightAmount: string;
  remarks: string | null;
  supplier: { id: string; name: string; supplierCode: string };
  items: {
    id: string; lineNo: number; orderedQty: string; uom: string; rate: string; lineAmount: string;
    rawMaterial: { id: string; materialCode: string; name: string; baseUom: string };
  }[];
}

/**
 * The approval queue.
 *
 * Deliberately shows the full line detail rather than a one-line summary: an
 * approver who cannot see what they are committing to will approve everything,
 * which makes the control worthless.
 */
export default function PurchaseApprovalsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const state = useListState({ pageSize: 50, filters: { status: 'PENDING_APPROVAL' } });

  const { data, isLoading, error, refetch } = useListQuery<PendingPo>(
    'pending-pos', '/purchasing/orders', state,
  );

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'APPROVE' | 'REJECT' }) =>
      api.post(`/purchasing/orders/${id}/decision`, { decision }),
    onSuccess: (_r, v) => {
      toast.success(v.decision === 'APPROVE' ? 'Purchase order approved' : 'Purchase order rejected');
      void queryClient.invalidateQueries();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorPanel error={error} onRetry={() => void refetch()} />;

  const orders = data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Purchase Approvals"
        description="Purchase orders waiting on a decision. Nothing can be delivered against an order until it is approved."
      />

      {orders.length === 0 ? (
        <Card>
          <EmptyState
            icon={BadgeCheck}
            title="Nothing waiting for approval"
            description="Approved orders appear under Purchase Orders."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {orders.map((po) => (
            <Card key={po.id}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    <Link href={`/purchasing/orders/${po.id}`} className="font-mono hover:underline">
                      {po.poNo}
                    </Link>
                    <span className="font-normal text-ink-muted">{po.supplier.name}</span>
                  </span>
                }
                description={
                  <>
                    Raised {fmtDate(po.orderDate)}
                    {po.expectedDate ? ` · expected ${fmtDate(po.expectedDate)}` : ''} ·{' '}
                    {po.items.length} line{po.items.length === 1 ? '' : 's'}
                  </>
                }
                actions={
                  can('purchasing.approve_po') ? (
                    <>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => decide.mutate({ id: po.id, decision: 'REJECT' })}
                      >
                        <X />
                        Reject
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        loading={decide.isPending}
                        onClick={() => decide.mutate({ id: po.id, decision: 'APPROVE' })}
                      >
                        <Check />
                        Approve {fmtMoney(po.totalAmount)}
                      </Button>
                    </>
                  ) : null
                }
              />
              <div className="scroll-x">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface-muted text-[12px] font-medium text-ink-muted">
                      <th className="px-3 py-1.5 text-left font-semibold">Material</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Quantity</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Rate</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {po.items.map((i) => (
                      <tr key={i.id} className="border-b border-line last:border-0">
                        <td className="px-3 py-1.5">
                          <CodeCell>{i.rawMaterial.materialCode}</CodeCell>
                          <span className="ml-2 text-ink-muted">{i.rawMaterial.name}</span>
                        </td>
                        <td className="num px-3 py-1.5 text-right">
                          {fmtQty(i.orderedQty)} {uomShort(i.uom)}
                        </td>
                        <td className="num px-3 py-1.5 text-right">{fmtMoney(i.rate)}</td>
                        <td className="num px-3 py-1.5 text-right font-medium">{fmtMoney(i.lineAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-surface-muted text-[12px] font-medium">
                      <td colSpan={3} className="px-3 py-1.5 text-right text-ink-muted">
                        Subtotal {fmtMoney(po.subtotalAmount)} · tax {fmtMoney(po.taxAmount)} · freight{' '}
                        {fmtMoney(po.freightAmount)}
                      </td>
                      <td className="num px-3 py-1.5 text-right text-[13px] font-semibold">
                        {fmtMoney(po.totalAmount)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {po.remarks ? (
                <CardBody className="border-t border-line py-2 text-[12px] text-ink-muted">{po.remarks}</CardBody>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
