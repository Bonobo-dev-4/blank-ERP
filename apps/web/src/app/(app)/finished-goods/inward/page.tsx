'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PackagePlus } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtQty } from '@/lib/utils';
import {
  Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorPanel, Field,
  LoadingBlock, NativeSelect, PageHeader, QtyInput, StatusBadge, Textarea,
} from '@/components/ui/primitives';

interface Pending {
  id: string; moNo: string; status: string; productName: string | null; sku: string | null;
  productVariantId: string | null; completedQty: string; inwardedQty: string; pendingQty: string;
}
interface Location { id: string; code: string; name: string; kind: string }

const key = () => crypto.randomUUID();

export default function InwardPage() {
  const qc = useQueryClient();
  const [moId, setMoId] = React.useState('');
  const [qty, setQty] = React.useState('');
  const [rejected, setRejected] = React.useState('0');
  const [locationId, setLocationId] = React.useState('');
  const [remarks, setRemarks] = React.useState('');
  const [posted, setPosted] = React.useState<{ inwardNo: string; qty: string } | null>(null);

  const pending = useQuery({
    queryKey: ['fg-awaiting-inward'],
    queryFn: () => api.get<Pending[]>('/finished-goods/awaiting-inward'),
  });
  const locations = useQuery({
    queryKey: ['locations'],
    queryFn: () => api.get<Location[]>('/locations'),
  });

  const selected = pending.data?.find((p) => p.id === moId) ?? null;
  const ceiling = selected ? Number(selected.pendingQty) : 0;
  const entered = Number(qty) || 0;
  const overCeiling = entered > ceiling;

  const submit = useMutation({
    mutationFn: async () => {
      if (!selected?.productVariantId) throw new Error('This order has no single SKU to receive against.');
      const created = await api.post<{ result: { id: string; inwardNo: string } }>('/finished-goods/inwards', {
        idempotencyKey: key(),
        manufacturingOrderId: moId,
        manufacturingLocationId: locationId,
        remarks: remarks || undefined,
        lines: [{ productVariantId: selected.productVariantId, acceptedQty: qty, rejectedQty: rejected || '0' }],
      });
      const id = created.result.id;
      await api.post(`/finished-goods/inwards/${id}/post`, { idempotencyKey: key(), locationId });
      return { inwardNo: created.result.inwardNo, qty };
    },
    onSuccess: (r) => {
      setPosted(r);
      setQty(''); setRejected('0'); setRemarks('');
      void qc.invalidateQueries({ queryKey: ['fg-awaiting-inward'] });
      void qc.invalidateQueries({ queryKey: ['fg-balances'] });
      void qc.invalidateQueries({ queryKey: ['fg-inwards'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const physical = (locations.data ?? []).filter((l) => l.kind === 'PHYSICAL');
  const canSubmit = moId && locationId && entered > 0 && !overCeiling && selected?.productVariantId;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Finished goods inward"
        description="Receive completed garments into finished stock. The ceiling is what the order actually completed and has not already been received — receiving more would create garments nobody made."
      />

      {pending.isLoading ? <LoadingBlock label="Loading orders" /> : null}
      {pending.error ? <ErrorPanel error={pending.error} onRetry={() => void pending.refetch()} /> : null}

      {pending.data && pending.data.length === 0 ? (
        <EmptyState
          title="Nothing is waiting to be received"
          description="An order appears here once production records completed units against it and they have not yet been inwarded."
        />
      ) : null}

      {pending.data && pending.data.length > 0 ? (
        <Card>
          <CardHeader title="Receive from an order" description={`${pending.data.length} ${pending.data.length === 1 ? 'order has' : 'orders have'} finished garments waiting.`} />
          <CardBody className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Manufacturing order" className="min-w-[280px] flex-1">
                <NativeSelect value={moId} onChange={(e) => { setMoId(e.target.value); setQty(''); setPosted(null); }}>
                  <option value="">Choose an order…</option>
                  {pending.data.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.moNo} — {p.productName ?? p.sku ?? 'unnamed'} ({p.pendingQty} waiting)
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Into location" className="min-w-[200px]">
                <NativeSelect value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  <option value="">Choose…</option>
                  {physical.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
                </NativeSelect>
              </Field>
            </div>

            {selected ? (
              <>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-line bg-surface-muted px-3.5 py-2 text-[12.5px]">
                  <span><span className="text-ink-muted">Completed</span> <span className="num font-medium">{fmtQty(selected.completedQty, 0)}</span></span>
                  <span><span className="text-ink-muted">Already received</span> <span className="num">{fmtQty(selected.inwardedQty, 0)}</span></span>
                  <span><span className="text-ink-muted">Can receive now</span> <span className="num font-semibold text-brand">{fmtQty(selected.pendingQty, 0)}</span></span>
                  <StatusBadge status={selected.status} />
                </div>

                {!selected.productVariantId ? (
                  <p className="rounded-lg border border-warn/30 bg-warn-soft px-3.5 py-2.5 text-[12.5px]">
                    This order covers more than one SKU, so the size and colour breakdown has to be
                    received per variant. That multi-variant flow is not built yet — receive it against a
                    single-SKU order, or raise it as a gap.
                  </p>
                ) : null}

                <div className="flex flex-wrap items-end gap-3">
                  <Field label="Accepted" className="w-[140px]" required>
                    <QtyInput value={qty} onChange={(e) => setQty(e.target.value)} placeholder={selected.pendingQty} />
                  </Field>
                  <Field label="Rejected at inward" className="w-[160px]" hint="Counted, not received">
                    <QtyInput value={rejected} onChange={(e) => setRejected(e.target.value)} />
                  </Field>
                  <Field label="Note" className="min-w-[220px] flex-1">
                    <Textarea rows={1} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                  </Field>
                  <Button onClick={() => submit.mutate()} disabled={!canSubmit || submit.isPending}>
                    <PackagePlus /> {submit.isPending ? 'Receiving…' : 'Receive into stock'}
                  </Button>
                </div>

                {overCeiling ? (
                  <p className="text-[12px] text-danger">
                    {fmtQty(String(entered), 0)} is more than the {fmtQty(selected.pendingQty, 0)} this
                    order has finished and not yet handed over. The server refuses this too — the check
                    here only saves you the round trip.
                  </p>
                ) : null}
              </>
            ) : null}

            {submit.error ? <ErrorPanel error={submit.error} /> : null}
            {posted ? (
              <p className="rounded-lg border border-ok/30 bg-ok-soft px-3.5 py-2.5 text-[12.5px]">
                <span className="font-medium">{posted.inwardNo}</span> posted —{' '}
                <span className="num">{fmtQty(posted.qty, 0)}</span> garments are now in finished stock
                and queued for external sync.
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {pending.data && pending.data.length > 0 ? (
        <Card>
          <CardHeader title="Waiting to be received" />
          <div className="scroll-x">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-surface-muted text-[12px] font-medium text-ink-muted">
                  <th className="px-3 py-1.5 text-left font-semibold">Order</th>
                  <th className="px-3 py-1.5 text-left font-semibold">Product</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Completed</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Received</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Waiting</th>
                </tr>
              </thead>
              <tbody>
                {pending.data.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-1.5 font-mono text-[12px]">{p.moNo}</td>
                    <td className="px-3 py-1.5">
                      {p.productName ?? '—'}
                      {p.sku ? <span className="ml-2 font-mono text-[12px] text-ink-subtle">{p.sku}</span> : null}
                      {!p.productVariantId ? <Badge tone="outline" className="ml-2">multi-SKU</Badge> : null}
                    </td>
                    <td className="num px-3 py-1.5 text-right">{fmtQty(p.completedQty, 0)}</td>
                    <td className="num px-3 py-1.5 text-right text-ink-muted">{fmtQty(p.inwardedQty, 0)}</td>
                    <td className="num px-3 py-1.5 text-right font-medium text-brand">{fmtQty(p.pendingQty, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
