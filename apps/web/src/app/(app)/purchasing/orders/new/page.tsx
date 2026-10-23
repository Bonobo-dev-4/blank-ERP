'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Plus, X } from 'lucide-react';
import { UOM_CODES } from '@dnd/contracts';
import { api } from '@/lib/api';
import { fmtMoney, humanise, uomShort } from '@/lib/utils';
import {
  Button, Card, CardBody, CardHeader, ErrorPanel, Field, Input, NativeSelect,
  PageHeader, QtyInput, Textarea,
} from '@/components/ui/primitives';

interface MaterialOption {
  id: string; materialCode: string; name: string; baseUom: string;
  purchaseUom: string | null; purchaseRate: string | null; reorderQty: string;
  defaultSupplier: { id: string; name: string } | null;
  stock: { availableQty: string; alertLevel: string };
}

interface ItemDraft {
  key: string;
  rawMaterialId: string;
  orderedQty: string;
  uom: string;
  rate: string;
  taxPct: string;
  discountPct: string;
}

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const [supplierId, setSupplierId] = React.useState('');
  const [expectedDate, setExpectedDate] = React.useState('');
  const [overTol, setOverTol] = React.useState('2');
  const [underTol, setUnderTol] = React.useState('1');
  const [freight, setFreight] = React.useState('0');
  const [paymentTerms, setPaymentTerms] = React.useState('');
  const [remarks, setRemarks] = React.useState('');
  const [error, setError] = React.useState<unknown>(null);
  const [items, setItems] = React.useState<ItemDraft[]>([
    { key: 'i0', rawMaterialId: '', orderedQty: '', uom: 'METER', rate: '', taxPct: '5', discountPct: '0' },
  ]);

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers', 'options'],
    queryFn: () => api.get<{ data: { id: string; name: string; supplierCode: string; paymentTerms: string | null; leadTimeDays: number }[] }>(
      '/suppliers', { pageSize: 200, status: 'ACTIVE' },
    ),
  });
  const { data: materials } = useQuery({
    queryKey: ['materials', 'po-options'],
    queryFn: () => api.get<{ data: MaterialOption[] }>('/materials', { pageSize: 300, status: 'ACTIVE' }),
  });

  const materialById = React.useMemo(
    () => new Map((materials?.data ?? []).map((m) => [m.id, m])),
    [materials],
  );

  const setItem = (idx: number, patch: Partial<ItemDraft>) =>
    setItems((is) => is.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  /** Choosing a material pre-fills its purchase unit, rate and reorder quantity. */
  const chooseMaterial = (idx: number, id: string) => {
    const m = materialById.get(id);
    setItem(idx, {
      rawMaterialId: id,
      uom: m?.purchaseUom ?? m?.baseUom ?? 'PIECE',
      rate: m?.purchaseRate ?? '',
      orderedQty: items[idx]?.orderedQty || (m && Number(m.reorderQty) > 0 ? m.reorderQty : ''),
    });
    if (m?.defaultSupplier && !supplierId) setSupplierId(m.defaultSupplier.id);
  };

  const addItem = () =>
    setItems((is) => [
      ...is,
      { key: `i${Date.now()}`, rawMaterialId: '', orderedQty: '', uom: 'METER', rate: '', taxPct: '5', discountPct: '0' },
    ]);

  const removeItem = (idx: number) => setItems((is) => is.filter((_, i) => i !== idx));

  const valid = items.filter((i) => i.rawMaterialId && Number(i.orderedQty) > 0 && i.rate !== '');

  const totals = React.useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    for (const i of valid) {
      const gross = Number(i.orderedQty) * Number(i.rate);
      const net = gross - (gross * Number(i.discountPct || 0)) / 100;
      subtotal += net;
      tax += (net * Number(i.taxPct || 0)) / 100;
    }
    return { subtotal, tax, total: subtotal + tax + Number(freight || 0) };
  }, [valid, freight]);

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string; poNo: string }>('/purchasing/orders', {
        supplierId,
        expectedDate: expectedDate ? new Date(`${expectedDate}T00:00:00.000Z`).toISOString() : null,
        overReceiptTolerancePct: overTol || '0',
        underReceiptTolerancePct: underTol || '0',
        freightAmount: freight || '0',
        currency: 'INR',
        paymentTerms: paymentTerms || null,
        remarks: remarks || null,
        items: valid.map((i) => ({
          rawMaterialId: i.rawMaterialId,
          orderedQty: i.orderedQty,
          uom: i.uom,
          rate: i.rate,
          discountPct: i.discountPct || '0',
          taxPct: i.taxPct || '0',
        })),
      }),
    onSuccess: (po) => {
      toast.success(`Purchase order ${po.poNo} created and sent for approval`);
      router.push(`/purchasing/orders/${po.id}`);
    },
    onError: setError,
  });

  const ready = supplierId && valid.length > 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="New Purchase Order"
        description="Quantities are converted to each material's stocking unit when the order is saved, so receipts and MRP never have to interpret the purchase unit."
        actions={
          <Button variant="default" onClick={() => router.push('/purchasing/orders')}>
            <ArrowLeft />
            Cancel
          </Button>
        }
      />

      {error ? <ErrorPanel error={error} /> : null}

      <Card>
        <CardHeader title="Order" />
        <CardBody>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Field label="Supplier" required className="sm:col-span-2">
              <NativeSelect
                value={supplierId}
                onChange={(e) => {
                  setSupplierId(e.target.value);
                  const s = suppliers?.data.find((x) => x.id === e.target.value);
                  if (s?.paymentTerms && !paymentTerms) setPaymentTerms(s.paymentTerms);
                }}
              >
                <option value="">Select a supplier</option>
                {(suppliers?.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.supplierCode})</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Expected delivery">
              <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
            </Field>
            <Field label="Over-receipt" hint="%">
              <QtyInput value={overTol} onChange={(e) => setOverTol(e.target.value)} />
            </Field>
            <Field label="Under-receipt" hint="%">
              <QtyInput value={underTol} onChange={(e) => setUnderTol(e.target.value)} />
            </Field>
            <Field label="Freight">
              <QtyInput value={freight} onChange={(e) => setFreight(e.target.value)} />
            </Field>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Payment terms">
              <Input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="30 days" />
            </Field>
            <Field label="Remarks">
              <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </Field>
          </div>
          <p className="mt-2 text-[11.5px] text-ink-muted">
            Tolerances decide how much over the ordered quantity a delivery may be, and how much under
            still counts as fully delivered. An order short by more than the under tolerance stays open
            until someone closes it explicitly.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Lines"
          actions={
            <Button variant="default" size="sm" onClick={addItem}>
              <Plus />
              Add line
            </Button>
          }
        />
        <CardBody className="space-y-2.5">
          {items.map((item, idx) => {
            const m = materialById.get(item.rawMaterialId);
            return (
              <div key={item.key} className="flex flex-wrap items-end gap-2 rounded border border-line px-2.5 py-2">
                <Field label="Material" required className="min-w-[220px] flex-1">
                  <NativeSelect value={item.rawMaterialId} onChange={(e) => chooseMaterial(idx, e.target.value)}>
                    <option value="">Select a material</option>
                    {(materials?.data ?? []).map((mo) => (
                      <option key={mo.id} value={mo.id}>{mo.materialCode} · {mo.name}</option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Quantity" required className="w-28">
                  <QtyInput value={item.orderedQty} onChange={(e) => setItem(idx, { orderedQty: e.target.value })} />
                </Field>
                <Field label="Unit" className="w-28">
                  <NativeSelect value={item.uom} onChange={(e) => setItem(idx, { uom: e.target.value })}>
                    {UOM_CODES.map((u) => (
                      <option key={u} value={u}>{humanise(u)}</option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Rate" required className="w-28">
                  <QtyInput value={item.rate} onChange={(e) => setItem(idx, { rate: e.target.value })} />
                </Field>
                <Field label="Tax %" className="w-20">
                  <QtyInput value={item.taxPct} onChange={(e) => setItem(idx, { taxPct: e.target.value })} />
                </Field>
                <div className="pb-1.5 text-[12px]">
                  <div className="num font-medium">
                    {fmtMoney(String(Number(item.orderedQty || 0) * Number(item.rate || 0)))}
                  </div>
                  {m ? (
                    <div className="text-[11px] text-ink-muted">
                      have {m.stock.availableQty} {uomShort(m.baseUom)}
                    </div>
                  ) : null}
                </div>
                {items.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => removeItem(idx)}
                    className="mb-1.5 rounded p-1 text-ink-subtle hover:bg-danger-soft hover:text-danger"
                    aria-label="Remove line"
                  >
                    <X className="size-4" />
                  </button>
                ) : null}
              </div>
            );
          })}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-wrap items-center justify-end gap-6 text-[13px]">
          <span className="text-ink-muted">
            Subtotal <strong className="num ml-1 font-semibold text-ink">{fmtMoney(String(totals.subtotal))}</strong>
          </span>
          <span className="text-ink-muted">
            Tax <strong className="num ml-1 font-semibold text-ink">{fmtMoney(String(totals.tax))}</strong>
          </span>
          <span className="text-ink-muted">
            Freight <strong className="num ml-1 font-semibold text-ink">{fmtMoney(freight || '0')}</strong>
          </span>
          <span className="text-[14px]">
            Total <strong className="num ml-1 font-semibold text-ink">{fmtMoney(String(totals.total))}</strong>
          </span>
          <Button variant="primary" onClick={() => create.mutate()} loading={create.isPending} disabled={!ready}>
            Create and send for approval
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
