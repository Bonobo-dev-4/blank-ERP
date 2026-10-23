'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ClipboardCheck, Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtQty, uomShort } from '@/lib/utils';
import {
  Badge, Button, Card, CardBody, CardHeader, DescList, ErrorPanel, LoadingBlock,
  PageHeader, StatusBadge,
} from '@/components/ui/primitives';
import { CodeCell } from '@/components/ui/data-table';
import { useAuth } from '@/components/app/auth-context';
import { InspectDialog } from './inspect-dialog';

export interface ReceiptLine {
  id: string; lineNo: number; receivedQty: string; uom: string; receivedBaseQty: string;
  acceptedBaseQty: string; rejectedBaseQty: string; inspectionResult: string | null;
  rejectionReason: string | null; rate: string | null; landedUnitCost: string | null;
  supplierLotRef: string | null; shade: string | null; width: string | null; gsm: number | null;
  remarks: string | null;
  rawMaterial: { id: string; materialCode: string; name: string; baseUom: string; category: string };
  purchaseItem: { id: string; lineNo: number; orderedBaseQty: string; receivedBaseQty: string } | null;
  lots: {
    id: string; lotCode: string; shade: string | null; unitCost: string;
    fabricRolls: { id: string; rollNo: string; currentLength: string; status: string }[];
  }[];
}

export interface ReceiptDetail {
  id: string; grnNo: string; status: string; receiptDate: string;
  supplierInvoiceNo: string | null; supplierDcNo: string | null; vehicleNo: string | null;
  freightAmount: string; remarks: string | null; inspectedAt: string | null; postedAt: string | null;
  supplier: { id: string; supplierCode: string; name: string };
  purchaseOrder: { id: string; poNo: string; overReceiptTolerancePct: string; underReceiptTolerancePct: string } | null;
  targetLocation: { id: string; code: string; name: string };
  barcode: { code: string } | null;
  lines: ReceiptLine[];
}

export default function ReceiptDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const [inspecting, setInspecting] = React.useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['receipt', id],
    queryFn: () => api.get<ReceiptDetail>(`/purchasing/receipts/${id}`),
  });

  const printLabels = async () => {
    const codes = [
      ...(data?.barcode ? [data.barcode.code] : []),
    ];
    if (codes.length === 0) return;
    const blob = await api.postForBlob('/barcodes/labels', { codes, symbology: 'code128', copies: 1 });
    window.open(URL.createObjectURL(blob), '_blank');
  };

  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorPanel error={error} onRetry={() => void refetch()} />;
  if (!data) return null;

  const awaitingInspection = data.status === 'PENDING_INSPECTION';
  const totalReceived = data.lines.reduce((a, l) => a + Number(l.receivedBaseQty), 0);
  const totalAccepted = data.lines.reduce((a, l) => a + Number(l.acceptedBaseQty), 0);
  const totalRejected = data.lines.reduce((a, l) => a + Number(l.rejectedBaseQty), 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title={data.grnNo}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={data.status} />
            <span>{data.supplier.name}</span>
            {data.purchaseOrder ? (
              <>
                <span className="text-ink-subtle">·</span>
                <Link href={`/purchasing/orders/${data.purchaseOrder.id}`} className="font-mono text-[12px] text-brand hover:underline">
                  {data.purchaseOrder.poNo}
                </Link>
              </>
            ) : null}
          </span>
        }
        actions={
          <>
            <Button variant="default" onClick={() => router.push('/purchasing/receipts')}>
              <ArrowLeft />
              All receipts
            </Button>
            {data.barcode ? (
              <Button variant="default" onClick={() => void printLabels()}>
                <Printer />
                Print GRN label
              </Button>
            ) : null}
            {awaitingInspection && can('purchasing.inspect') ? (
              <Button variant="primary" onClick={() => setInspecting(true)}>
                <ClipboardCheck />
                Inspect
              </Button>
            ) : null}
          </>
        }
      />

      {awaitingInspection ? (
        <Card className="border-warn/30 bg-warn-soft">
          <CardBody className="py-2.5 text-[12.5px] text-ink">
            <strong className="font-semibold">Awaiting inspection.</strong> All{' '}
            <span className="num">{fmtQty(String(totalReceived))}</span> units are sitting in the QC hold
            location. They are owned but cannot be issued to production until this receipt is inspected.
          </CardBody>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Lines"
            description={
              data.status === 'POSTED'
                ? `${fmtQty(String(totalAccepted))} accepted, ${fmtQty(String(totalRejected))} rejected`
                : 'Quantities as delivered by the supplier'
            }
          />
          <div className="scroll-x">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-surface-muted text-[11px] uppercase tracking-wide text-ink-muted">
                  <th className="px-3 py-1.5 text-left font-semibold">#</th>
                  <th className="px-3 py-1.5 text-left font-semibold">Material</th>
                  <th className="px-3 py-1.5 text-left font-semibold">Lot</th>
                  <th className="px-3 py-1.5 text-left font-semibold">Shade</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Received</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Accepted</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Rejected</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Landed cost</th>
                  <th className="px-3 py-1.5 text-left font-semibold">Result</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l) => (
                  <tr key={l.id} className="border-b border-line last:border-0 align-top">
                    <td className="num px-3 py-1.5 text-ink-muted">{l.lineNo}</td>
                    <td className="px-3 py-1.5">
                      <Link href={`/materials/${l.rawMaterial.id}`} className="hover:underline">
                        <CodeCell>{l.rawMaterial.materialCode}</CodeCell>
                        <div className="text-[11.5px] text-ink-muted">{l.rawMaterial.name}</div>
                      </Link>
                    </td>
                    <td className="px-3 py-1.5">
                      {l.lots.map((lot) => (
                        <div key={lot.id}>
                          <CodeCell>{lot.lotCode}</CodeCell>
                          {lot.fabricRolls.length > 0 ? (
                            <div className="mt-0.5 flex flex-wrap gap-1">
                              {lot.fabricRolls.map((r) => (
                                <Badge
                                  key={r.id}
                                  tone={r.status === 'BLOCKED' ? 'danger' : r.status === 'QC_PENDING' ? 'warn' : 'ok'}
                                >
                                  {r.rollNo.split('-').slice(-2).join('-')} · {fmtQty(r.currentLength, 0)}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </td>
                    <td className="px-3 py-1.5 text-ink-muted">{l.shade ?? '-'}</td>
                    <td className="num px-3 py-1.5 text-right font-medium">
                      {fmtQty(l.receivedBaseQty)} {uomShort(l.rawMaterial.baseUom)}
                    </td>
                    <td className="num px-3 py-1.5 text-right text-ok">
                      {Number(l.acceptedBaseQty) > 0 ? fmtQty(l.acceptedBaseQty) : <span className="text-ink-subtle">-</span>}
                    </td>
                    <td className="num px-3 py-1.5 text-right">
                      {Number(l.rejectedBaseQty) > 0 ? (
                        <span className="text-danger" title={l.rejectionReason ?? ''}>{fmtQty(l.rejectedBaseQty)}</span>
                      ) : (
                        <span className="text-ink-subtle">-</span>
                      )}
                    </td>
                    <td className="num px-3 py-1.5 text-right text-ink-muted">{fmtMoney(l.landedUnitCost)}</td>
                    <td className="px-3 py-1.5">
                      {l.inspectionResult ? <StatusBadge status={l.inspectionResult} /> : <span className="text-ink-subtle">-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Receipt details" />
          <CardBody>
            <DescList
              columns={1}
              items={[
                { label: 'Supplier', value: `${data.supplier.name} (${data.supplier.supplierCode})` },
                { label: 'Received on', value: fmtDate(data.receiptDate) },
                { label: 'Release accepted stock to', value: `${data.targetLocation.code} · ${data.targetLocation.name}` },
                { label: 'Supplier invoice', value: data.supplierInvoiceNo ?? '-' },
                { label: 'Delivery challan', value: data.supplierDcNo ?? '-' },
                { label: 'Vehicle', value: data.vehicleNo ?? '-' },
                { label: 'Freight', value: fmtMoney(data.freightAmount) },
                { label: 'Inspected', value: data.inspectedAt ? fmtDate(data.inspectedAt) : 'Not yet' },
                { label: 'GRN barcode', value: data.barcode ? <CodeCell>{data.barcode.code}</CodeCell> : '-' },
                { label: 'Remarks', value: data.remarks ?? '-' },
              ]}
            />
          </CardBody>
        </Card>
      </div>

      {inspecting ? (
        <InspectDialog
          open={inspecting}
          onOpenChange={setInspecting}
          receipt={data}
          onSaved={() => void refetch()}
        />
      ) : null}
    </div>
  );
}
