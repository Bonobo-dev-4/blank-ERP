'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, Scroll, X } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtQty, newIdempotencyKey, uomShort } from '@/lib/utils';
import {
  Badge, Button, ErrorPanel, Field, Input, NativeSelect, QtyInput, Textarea,
} from '@/components/ui/primitives';
import { CodeCell } from '@/components/ui/data-table';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';

interface PoForReceive {
  id: string;
  poNo: string;
  supplier: { id: string; name: string };
  items: {
    id: string; lineNo: number; pendingBaseQty: string; uom: string;
    rate: string; orderedBaseQty: string; receivedBaseQty: string;
    rawMaterial: { id: string; materialCode: string; name: string; baseUom: string; category: string };
  }[];
}

interface LineDraft {
  purchaseItemId: string;
  rawMaterialId: string;
  materialCode: string;
  materialName: string;
  category: string;
  baseUom: string;
  uom: string;
  receivedQty: string;
  rate: string;
  supplierLotRef: string;
  shade: string;
  width: string;
  gsm: string;
  /** Individual roll lengths, when the fabric is counted roll by roll. */
  rolls: { length: string }[];
  include: boolean;
}

/**
 * Record a supplier delivery.
 *
 * Two things this screen takes seriously:
 *
 *  - Fabric is counted roll by roll. The roll lengths must add up to exactly
 *    the received quantity, and the dialog says so live rather than letting
 *    the server reject the submission after the storekeeper has typed twenty
 *    lengths.
 *  - The received quantity lands in QC HOLD, not in the warehouse. The dialog
 *    states that, because a storekeeper who believes the stock is usable will
 *    promise it to a cutting supervisor who then cannot have it.
 */
export function ReceiveDialog({
  open,
  onOpenChange,
  purchaseOrder,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  purchaseOrder: PoForReceive;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const idempotencyKey = React.useMemo(() => newIdempotencyKey(), []);

  const { data: locations } = useQuery({
    queryKey: ['locations', 'physical'],
    queryFn: () => api.get<{ id: string; code: string; name: string; kind: string }[]>('/locations'),
  });

  const [targetLocationId, setTargetLocationId] = React.useState('');
  const [supplierInvoiceNo, setSupplierInvoiceNo] = React.useState('');
  const [supplierDcNo, setSupplierDcNo] = React.useState('');
  const [vehicleNo, setVehicleNo] = React.useState('');
  const [freightAmount, setFreightAmount] = React.useState('0');
  const [remarks, setRemarks] = React.useState('');
  const [error, setError] = React.useState<unknown>(null);

  const [lines, setLines] = React.useState<LineDraft[]>(() =>
    purchaseOrder.items
      .filter((i) => Number(i.pendingBaseQty) > 0)
      .map((i) => ({
        purchaseItemId: i.id,
        rawMaterialId: i.rawMaterial.id,
        materialCode: i.rawMaterial.materialCode,
        materialName: i.rawMaterial.name,
        category: i.rawMaterial.category,
        baseUom: i.rawMaterial.baseUom,
        uom: i.uom,
        // Defaults to the full outstanding quantity, which is the common case.
        receivedQty: i.pendingBaseQty,
        rate: i.rate,
        supplierLotRef: '',
        shade: '',
        width: '',
        gsm: '',
        rolls: [],
        include: true,
      })),
  );

  React.useEffect(() => {
    if (!targetLocationId && locations) {
      const warehouse = locations.find((l) => l.kind === 'PHYSICAL' && l.code.startsWith('RM-WH'));
      if (warehouse) setTargetLocationId(warehouse.id);
    }
  }, [locations, targetLocationId]);

  const setLine = (idx: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const addRoll = (idx: number) =>
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, rolls: [...l.rolls, { length: '' }] } : l)));

  const removeRoll = (idx: number, rollIdx: number) =>
    setLines((ls) =>
      ls.map((l, i) => (i === idx ? { ...l, rolls: l.rolls.filter((_, ri) => ri !== rollIdx) } : l)),
    );

  const setRoll = (idx: number, rollIdx: number, length: string) =>
    setLines((ls) =>
      ls.map((l, i) =>
        i === idx ? { ...l, rolls: l.rolls.map((r, ri) => (ri === rollIdx ? { length } : r)) } : l,
      ),
    );

  const included = lines.filter((l) => l.include && Number(l.receivedQty) > 0);

  const rollMismatch = included.filter(
    (l) =>
      l.rolls.length > 0 &&
      Math.abs(l.rolls.reduce((a, r) => a + Number(r.length || 0), 0) - Number(l.receivedQty)) > 0.0001,
  );

  const submit = useMutation({
    mutationFn: () =>
      api.post('/purchasing/receipts', {
        idempotencyKey,
        purchaseOrderId: purchaseOrder.id,
        supplierId: purchaseOrder.supplier.id,
        targetLocationId,
        supplierInvoiceNo: supplierInvoiceNo || null,
        supplierDcNo: supplierDcNo || null,
        vehicleNo: vehicleNo || null,
        freightAmount: freightAmount || '0',
        remarks: remarks || null,
        lines: included.map((l) => ({
          purchaseItemId: l.purchaseItemId,
          rawMaterialId: l.rawMaterialId,
          receivedQty: l.receivedQty,
          uom: l.uom,
          rate: l.rate || null,
          supplierLotRef: l.supplierLotRef || null,
          shade: l.shade || null,
          width: l.width || null,
          gsm: l.gsm ? Number(l.gsm) : null,
          ...(l.rolls.length > 0 ? { rolls: l.rolls.map((r) => ({ length: r.length })) } : {}),
        })),
      }),
    onSuccess: (res: unknown) => {
      const r = res as { result: { id: string; grnNo: string }; replayed: boolean };
      toast.success(
        r.replayed ? `Delivery ${r.result.grnNo} was already recorded` : `Delivery ${r.result.grnNo} recorded`,
      );
      void queryClient.invalidateQueries();
      onSaved?.();
      onOpenChange(false);
      router.push(`/purchasing/receipts/${r.result.id}`);
    },
    onError: setError,
  });

  const ready = targetLocationId && included.length > 0 && rollMismatch.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        wide
        title={`Record delivery against ${purchaseOrder.poNo}`}
        description={`${purchaseOrder.supplier.name} · received quantity enters QC hold and is not issuable until inspected`}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="default">Cancel</Button>
            </DialogClose>
            <Button variant="primary" onClick={() => submit.mutate()} loading={submit.isPending} disabled={!ready}>
              Record delivery
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error ? <ErrorPanel error={error} /> : null}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Field label="Release accepted stock to" required className="sm:col-span-2">
              <NativeSelect value={targetLocationId} onChange={(e) => setTargetLocationId(e.target.value)}>
                <option value="">Select a location</option>
                {(locations ?? []).filter((l) => l.kind === 'PHYSICAL').map((l) => (
                  <option key={l.id} value={l.id}>{l.code} · {l.name}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Supplier invoice">
              <Input value={supplierInvoiceNo} onChange={(e) => setSupplierInvoiceNo(e.target.value)} />
            </Field>
            <Field label="Delivery challan">
              <Input value={supplierDcNo} onChange={(e) => setSupplierDcNo(e.target.value)} />
            </Field>
            <Field label="Freight" hint="apportioned by line value">
              <QtyInput value={freightAmount} onChange={(e) => setFreightAmount(e.target.value)} />
            </Field>
          </div>

          <div className="space-y-2.5">
            {lines.map((line, idx) => {
              const rollTotal = line.rolls.reduce((a, r) => a + Number(r.length || 0), 0);
              const mismatch =
                line.rolls.length > 0 && Math.abs(rollTotal - Number(line.receivedQty || 0)) > 0.0001;
              const isFabric = line.category === 'FABRIC' || line.category === 'LINING';

              return (
                <div
                  key={line.purchaseItemId}
                  className={
                    'rounded border px-3 py-2.5 ' +
                    (line.include ? 'border-line bg-surface' : 'border-line bg-surface-muted opacity-60')
                  }
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={line.include}
                        onChange={(e) => setLine(idx, { include: e.target.checked })}
                      />
                      <span>
                        <CodeCell>{line.materialCode}</CodeCell>
                        <span className="ml-1.5 text-[12px] text-ink-muted">{line.materialName}</span>
                      </span>
                    </label>

                    <div className="ml-auto flex flex-wrap items-end gap-2">
                      <Field label="Received" className="w-28">
                        <QtyInput
                          value={line.receivedQty}
                          onChange={(e) => setLine(idx, { receivedQty: e.target.value })}
                          disabled={!line.include}
                        />
                      </Field>
                      <span className="pb-1.5 text-[12px] text-ink-muted">{uomShort(line.uom)}</span>
                      <Field label="Rate" className="w-24">
                        <QtyInput
                          value={line.rate}
                          onChange={(e) => setLine(idx, { rate: e.target.value })}
                          disabled={!line.include}
                        />
                      </Field>
                      {isFabric ? (
                        <>
                          <Field label="Shade" className="w-28">
                            <Input
                              value={line.shade}
                              onChange={(e) => setLine(idx, { shade: e.target.value })}
                              disabled={!line.include}
                              placeholder="IND-BLUE-A"
                            />
                          </Field>
                          <Field label="Width" className="w-20">
                            <QtyInput
                              value={line.width}
                              onChange={(e) => setLine(idx, { width: e.target.value })}
                              disabled={!line.include}
                            />
                          </Field>
                        </>
                      ) : null}
                      <Field label="Supplier lot" className="w-28">
                        <Input
                          value={line.supplierLotRef}
                          onChange={(e) => setLine(idx, { supplierLotRef: e.target.value })}
                          disabled={!line.include}
                        />
                      </Field>
                    </div>
                  </div>

                  {isFabric && line.include ? (
                    <div className="mt-2 rounded border border-dashed border-line-strong bg-surface-muted px-2.5 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Scroll className="size-3.5 text-ink-subtle" />
                        <span className="text-[12px] font-medium text-ink">
                          Individual rolls {line.rolls.length > 0 ? `(${line.rolls.length})` : ''}
                        </span>
                        <Button variant="ghost" size="sm" onClick={() => addRoll(idx)}>
                          <Plus />
                          Add roll
                        </Button>
                        {line.rolls.length > 0 ? (
                          <Badge tone={mismatch ? 'danger' : 'ok'} className="ml-auto">
                            {fmtQty(String(rollTotal))} of {fmtQty(line.receivedQty)} {uomShort(line.uom)}
                          </Badge>
                        ) : (
                          <span className="ml-auto text-[12px] text-ink-subtle">
                            Optional. Add rolls to get one barcode per roll.
                          </span>
                        )}
                      </div>

                      {line.rolls.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {line.rolls.map((roll, ri) => (
                            <div key={ri} className="flex items-center gap-1">
                              <QtyInput
                                value={roll.length}
                                onChange={(e) => setRoll(idx, ri, e.target.value)}
                                placeholder={`#${ri + 1}`}
                                className="h-7 w-20"
                              />
                              <button
                                type="button"
                                onClick={() => removeRoll(idx, ri)}
                                className="rounded p-0.5 text-ink-subtle hover:bg-danger-soft hover:text-danger"
                                aria-label={`Remove roll ${ri + 1}`}
                              >
                                <X className="size-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {mismatch ? (
                        <p className="mt-1.5 text-[12px] text-danger">
                          Roll lengths must add up to exactly the received quantity. Off by{' '}
                          {fmtQty(String(Math.abs(rollTotal - Number(line.receivedQty || 0))))}{' '}
                          {uomShort(line.uom)}.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {lines.length === 0 ? (
            <p className="rounded border border-line bg-surface-muted px-3 py-2 text-[12.5px] text-ink-muted">
              Every line on this purchase order has already been fully received.
            </p>
          ) : null}

          <Field label="Remarks">
            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} />
          </Field>

          <p className="rounded border border-info/30 bg-info-soft px-3 py-2 text-[12px] text-ink">
            This records what the supplier delivered. The quantity enters the QC hold location and cannot
            be issued to production until it is inspected on the goods receipt.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
