'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, BadgeCheck, Ban, PackagePlus } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtQty, humanise, uomShort } from '@/lib/utils';
import {
  Badge, Button, Card, CardBody, CardHeader, DescList, ErrorPanel, LoadingBlock,
  PageHeader, Stat, StatusBadge, Textarea,
} from '@/components/ui/primitives';
import { CodeCell } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/dialog';
import { useAuth } from '@/components/app/auth-context';
import { ReceiveDialog } from '../../receipts/receive-dialog';

interface PoItem {
  id: string; lineNo: number; orderedQty: string; uom: string; orderedBaseQty: string;
  rate: string; discountPct: string; taxPct: string; lineAmount: string;
  receivedBaseQty: string; acceptedBaseQty: string; rejectedBaseQty: string;
  pendingBaseQty: string; expectedDate: string | null; remarks: string | null;
  rawMaterial: { id: string; materialCode: string; name: string; baseUom: string; category: string };
}

interface PoDetail {
  id: string; poNo: string; status: string; orderDate: string; expectedDate: string | null;
  overReceiptTolerancePct: string; underReceiptTolerancePct: string;
  subtotalAmount: string; taxAmount: string; freightAmount: string; totalAmount: string;
  currency: string; paymentTerms: string | null; remarks: string | null;
  approvedAt: string | null; closedAt: string | null; closeReason: string | null;
  supplier: { id: string; supplierCode: string; name: string; leadTimeDays: number };
  items: PoItem[];
  receipts: {
    id: string; grnNo: string; status: string; receiptDate: string; supplierInvoiceNo: string | null;
    lines: { id: string; lineNo: number; receivedBaseQty: string; acceptedBaseQty: string; rejectedBaseQty: string }[];
  }[];
  closure: {
    status: string; canAutoClose: boolean; reason: string;
    fullyReceivedLineCount: number; openLineCount: number;
  };
}

export default function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [approving, setApproving] = React.useState(false);
  const [closing, setClosing] = React.useState(false);
  const [closeReason, setCloseReason] = React.useState('');
  const [receiving, setReceiving] = React.useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: () => api.get<PoDetail>(`/purchasing/orders/${id}`),
  });

  const decide = useMutation({
    mutationFn: (decision: 'APPROVE' | 'REJECT') =>
      api.post(`/purchasing/orders/${id}/decision`, { decision }),
    onSuccess: (_r, decision) => {
      toast.success(decision === 'APPROVE' ? 'Purchase order approved' : 'Purchase order rejected');
      setApproving(false);
      void queryClient.invalidateQueries();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const close = useMutation({
    mutationFn: () => api.post(`/purchasing/orders/${id}/close`, { reason: closeReason }),
    onSuccess: () => {
      toast.success('Purchase order closed');
      setClosing(false);
      void queryClient.invalidateQueries();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorPanel error={error} onRetry={() => void refetch()} />;
  if (!data) return null;

  const canReceive = ['APPROVED', 'PARTIALLY_RECEIVED'].includes(data.status);
  const canApprove = ['DRAFT', 'PENDING_APPROVAL'].includes(data.status);
  const canClose = !['CLOSED', 'CANCELLED'].includes(data.status);

  const totalOrdered = data.items.reduce((a, i) => a + Number(i.orderedBaseQty), 0);
  const totalReceived = data.items.reduce((a, i) => a + Number(i.receivedBaseQty), 0);
  const totalAccepted = data.items.reduce((a, i) => a + Number(i.acceptedBaseQty), 0);
  const totalRejected = data.items.reduce((a, i) => a + Number(i.rejectedBaseQty), 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title={data.poNo}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={data.status} />
            <span>{data.supplier.name}</span>
            <span className="text-ink-subtle">·</span>
            <span>{fmtMoney(data.totalAmount)}</span>
          </span>
        }
        actions={
          <>
            <Button variant="default" onClick={() => router.push('/purchasing/orders')}>
              <ArrowLeft />
              All orders
            </Button>
            {canApprove && can('purchasing.approve_po') ? (
              <Button variant="primary" onClick={() => setApproving(true)}>
                <BadgeCheck />
                Approve
              </Button>
            ) : null}
            {canReceive && can('purchasing.receive') ? (
              <Button variant="primary" onClick={() => setReceiving(true)}>
                <PackagePlus />
                Record delivery
              </Button>
            ) : null}
            {canClose && can('purchasing.close_po') ? (
              <Button variant="elevated" onClick={() => setClosing(true)}>
                <Ban />
                Close short
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Ordered" value={fmtQty(String(totalOrdered), 0)} hint="base units across all lines" />
        <Stat label="Received" value={fmtQty(String(totalReceived), 0)} hint="delivered so far" />
        <Stat label="Accepted" value={fmtQty(String(totalAccepted), 0)} hint="passed inspection" tone="ok" />
        <Stat
          label="Rejected"
          value={fmtQty(String(totalRejected), 0)}
          hint="failed inspection"
          tone={totalRejected > 0 ? 'danger' : undefined}
        />
      </div>

      {/* The closure assessment, in words. A buyer should not have to do this
          arithmetic in their head to know whether the PO is finished. */}
      <Card className={data.closure.canAutoClose ? 'border-ok/30 bg-ok-soft' : undefined}>
        <CardBody className="flex flex-wrap items-center gap-3 py-2.5">
          <Badge tone={data.closure.canAutoClose ? 'ok' : 'warn'}>{humanise(data.closure.status)}</Badge>
          <span className="text-[12.5px] text-ink">{data.closure.reason}</span>
          <span className="text-[11.5px] text-ink-subtle">
            Tolerance: {fmtQty(data.overReceiptTolerancePct, 1)}% over, {fmtQty(data.underReceiptTolerancePct, 1)}% under
          </span>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Lines" description="Outstanding quantity is what a buyer chases" />
        <div className="scroll-x">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-surface-muted text-[11px] uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-1.5 text-left font-semibold">#</th>
                <th className="px-3 py-1.5 text-left font-semibold">Material</th>
                <th className="px-3 py-1.5 text-right font-semibold">Ordered</th>
                <th className="px-3 py-1.5 text-right font-semibold">Rate</th>
                <th className="px-3 py-1.5 text-right font-semibold">Tax</th>
                <th className="px-3 py-1.5 text-right font-semibold">Amount</th>
                <th className="px-3 py-1.5 text-right font-semibold">Received</th>
                <th className="px-3 py-1.5 text-right font-semibold">Accepted</th>
                <th className="px-3 py-1.5 text-right font-semibold">Rejected</th>
                <th className="px-3 py-1.5 text-right font-semibold">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.id} className="border-b border-line last:border-0">
                  <td className="num px-3 py-1.5 text-ink-muted">{i.lineNo}</td>
                  <td className="px-3 py-1.5">
                    <Link href={`/materials/${i.rawMaterial.id}`} className="hover:underline">
                      <CodeCell>{i.rawMaterial.materialCode}</CodeCell>
                      <div className="text-[11.5px] text-ink-muted">{i.rawMaterial.name}</div>
                    </Link>
                  </td>
                  <td className="num px-3 py-1.5 text-right font-medium">
                    {fmtQty(i.orderedQty)} {uomShort(i.uom)}
                    {i.uom !== i.rawMaterial.baseUom ? (
                      <div className="text-[11px] text-ink-muted">
                        = {fmtQty(i.orderedBaseQty)} {uomShort(i.rawMaterial.baseUom)}
                      </div>
                    ) : null}
                  </td>
                  <td className="num px-3 py-1.5 text-right">{fmtMoney(i.rate)}</td>
                  <td className="num px-3 py-1.5 text-right text-ink-muted">{fmtQty(i.taxPct, 1)}%</td>
                  <td className="num px-3 py-1.5 text-right">{fmtMoney(i.lineAmount)}</td>
                  <td className="num px-3 py-1.5 text-right">{fmtQty(i.receivedBaseQty)}</td>
                  <td className="num px-3 py-1.5 text-right text-ok">{fmtQty(i.acceptedBaseQty)}</td>
                  <td className="num px-3 py-1.5 text-right">
                    {Number(i.rejectedBaseQty) > 0 ? (
                      <span className="text-danger">{fmtQty(i.rejectedBaseQty)}</span>
                    ) : (
                      <span className="text-ink-subtle">-</span>
                    )}
                  </td>
                  <td className="num px-3 py-1.5 text-right font-medium">
                    {Number(i.pendingBaseQty) > 0 ? fmtQty(i.pendingBaseQty) : <span className="text-ink-subtle">-</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line-strong bg-surface-muted text-[12px] font-medium">
                <td colSpan={5} className="px-3 py-1.5 text-right text-ink-muted">Subtotal</td>
                <td className="num px-3 py-1.5 text-right">{fmtMoney(data.subtotalAmount)}</td>
                <td colSpan={4} />
              </tr>
              <tr className="bg-surface-muted text-[12px]">
                <td colSpan={5} className="px-3 py-1 text-right text-ink-muted">Tax</td>
                <td className="num px-3 py-1 text-right">{fmtMoney(data.taxAmount)}</td>
                <td colSpan={4} />
              </tr>
              <tr className="bg-surface-muted text-[12px]">
                <td colSpan={5} className="px-3 py-1 text-right text-ink-muted">Freight</td>
                <td className="num px-3 py-1 text-right">{fmtMoney(data.freightAmount)}</td>
                <td colSpan={4} />
              </tr>
              <tr className="border-t border-line bg-surface-muted text-[13px] font-semibold">
                <td colSpan={5} className="px-3 py-1.5 text-right">Total</td>
                <td className="num px-3 py-1.5 text-right">{fmtMoney(data.totalAmount)}</td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Deliveries"
            description="Each delivery lands in QC hold; stock becomes issuable only after inspection"
          />
          {data.receipts.length === 0 ? (
            <CardBody className="text-[12.5px] text-ink-muted">Nothing delivered yet.</CardBody>
          ) : (
            <ul className="divide-y divide-line">
              {data.receipts.map((r) => {
                const received = r.lines.reduce((a, l) => a + Number(l.receivedBaseQty), 0);
                const accepted = r.lines.reduce((a, l) => a + Number(l.acceptedBaseQty), 0);
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                    <Link href={`/purchasing/receipts/${r.id}`} className="font-mono text-[12px] hover:underline">
                      {r.grnNo}
                    </Link>
                    <StatusBadge status={r.status} />
                    <span className="text-[12px] text-ink-muted">{fmtDate(r.receiptDate)}</span>
                    {r.supplierInvoiceNo ? (
                      <span className="text-[11.5px] text-ink-subtle">inv {r.supplierInvoiceNo}</span>
                    ) : null}
                    <span className="num ml-auto text-[12px]">
                      received {fmtQty(String(received))}
                      {r.status === 'POSTED' ? ` · accepted ${fmtQty(String(accepted))}` : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Order details" />
          <CardBody>
            <DescList
              columns={1}
              items={[
                { label: 'Supplier', value: `${data.supplier.name} (${data.supplier.supplierCode})` },
                { label: 'Order date', value: fmtDate(data.orderDate) },
                { label: 'Expected', value: fmtDate(data.expectedDate) },
                { label: 'Supplier lead time', value: `${data.supplier.leadTimeDays} days` },
                { label: 'Payment terms', value: data.paymentTerms ?? '-' },
                { label: 'Approved', value: data.approvedAt ? fmtDate(data.approvedAt) : 'Not yet' },
                ...(data.closedAt
                  ? [
                      { label: 'Closed', value: fmtDate(data.closedAt) },
                      { label: 'Close reason', value: data.closeReason ?? '-' },
                    ]
                  : []),
                { label: 'Remarks', value: data.remarks ?? '-' },
              ]}
            />
          </CardBody>
        </Card>
      </div>

      <ConfirmDialog
        open={approving}
        onOpenChange={setApproving}
        title={`Approve ${data.poNo}?`}
        consequence={
          <>
            Approving commits {fmtMoney(data.totalAmount)} to {data.supplier.name} and allows deliveries to
            be recorded against this order. The approval is recorded against your name in the audit log.
          </>
        }
        confirmLabel="Approve order"
        loading={decide.isPending}
        onConfirm={() => decide.mutate('APPROVE')}
      />

      <ConfirmDialog
        open={closing}
        onOpenChange={setClosing}
        title={`Close ${data.poNo} short?`}
        tone="elevated"
        consequence={
          <>
            This abandons{' '}
            <strong className="num font-semibold">
              {fmtQty(String(data.items.reduce((a, i) => a + Number(i.pendingBaseQty), 0)))}
            </strong>{' '}
            of outstanding quantity across {data.closure.openLineCount} line
            {data.closure.openLineCount === 1 ? '' : 's'}. The order can no longer take deliveries.
          </>
        }
        confirmLabel="Close order"
        loading={close.isPending}
        onConfirm={() => close.mutate()}
      >
        <Textarea
          value={closeReason}
          onChange={(e) => setCloseReason(e.target.value)}
          placeholder="Why is this order being closed short?"
          rows={2}
        />
      </ConfirmDialog>

      {receiving ? (
        <ReceiveDialog
          open={receiving}
          onOpenChange={setReceiving}
          purchaseOrder={data}
          onSaved={() => void refetch()}
        />
      ) : null}
    </div>
  );
}
