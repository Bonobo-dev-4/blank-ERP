'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, TriangleAlert } from 'lucide-react';
import { PRIORITIES, PRODUCTION_TYPES } from '@dnd/contracts';
import { api, type Paginated } from '@/lib/api';
import { humanise, newIdempotencyKey } from '@/lib/utils';
import {
  Badge, Button, Card, CardBody, CardHeader, ErrorPanel, Field, Input, NativeSelect,
  PageHeader, QtyInput, Textarea,
} from '@/components/ui/primitives';

interface Variant { id: string; sku: string; size: string | null; color: string | null; sizeSortOrder: number }
interface ProductOption { id: string; styleCode: string; name: string }
interface BomRow {
  id: string; product: { id: string }; productVariant: { id: string } | null;
  approvedVersion: { id: string; version: number } | null;
}

export default function NewManufacturingOrderPage() {
  const router = useRouter();

  const [productId, setProductId] = React.useState('');
  const [priority, setPriority] = React.useState('NORMAL');
  const [productionType, setProductionType] = React.useState('IN_HOUSE');
  const [dueDate, setDueDate] = React.useState('');
  const [plannedStartDate, setPlannedStartDate] = React.useState('');
  const [remarks, setRemarks] = React.useState('');
  const [qtyBySku, setQtyBySku] = React.useState<Record<string, string>>({});

  const { data: products } = useQuery({
    queryKey: ['products', 'mo-picker'],
    queryFn: () => api.get<Paginated<ProductOption>>('/products', { pageSize: 200 }),
  });
  const { data: boms } = useQuery({
    queryKey: ['boms', 'mo-picker'],
    queryFn: () => api.get<Paginated<BomRow>>('/bom', { pageSize: 200 }),
  });

  // The SKU matrix is its own paginated resource rather than an array hanging
  // off the style: a size x colour range runs to dozens of rows.
  const { data: variantPage, isLoading: variantsLoading } = useQuery({
    queryKey: ['variants', productId],
    queryFn: () => api.get<Paginated<Variant>>('/products/variants', { productId, pageSize: 200 }),
    enabled: Boolean(productId),
  });

  const product = (products?.data ?? []).find((p) => p.id === productId);
  const variants = React.useMemo(
    () => [...(variantPage?.data ?? [])].sort((a, b) => a.sizeSortOrder - b.sizeSortOrder),
    [variantPage],
  );

  // An order can be created without an approved BOM, but it cannot be planned
  // or released, so say so now rather than at the point of release.
  const hasApprovedBom = (boms?.data ?? []).some(
    (b) => b.product.id === productId && b.approvedVersion !== null,
  );

  const items = Object.entries(qtyBySku)
    .filter(([, q]) => Number(q) > 0)
    .map(([productVariantId, orderedQty]) => ({ productVariantId, orderedQty }));

  const total = items.reduce((acc, i) => acc + Number(i.orderedQty), 0);

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string; moNo: string }>('/manufacturing/orders', {
        productId,
        priority,
        productionType,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        plannedStartDate: plannedStartDate ? new Date(plannedStartDate).toISOString() : null,
        remarks: remarks || null,
        idempotencyKey: newIdempotencyKey(),
        items,
      }),
    onSuccess: (res) => {
      toast.success(`${res.moNo} created`);
      router.push(`/manufacturing/${res.id}`);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="mx-auto max-w-4xl">
      <Button onClick={() => router.push('/manufacturing')} className="mb-3">
        <ArrowLeft />
        All orders
      </Button>

      <PageHeader
        title="New manufacturing order"
        description="Created as a DRAFT. Reserve material and release it from the order page — releasing is what freezes the BOM."
      />

      {create.error ? <ErrorPanel error={create.error} className="mb-3" /> : null}

      <Card className="mb-3">
        <CardHeader title="Order" />
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Style" required>
              <NativeSelect
                value={productId}
                onChange={(e) => {
                  setProductId(e.target.value);
                  setQtyBySku({});
                }}
              >
                <option value="">Select a style</option>
                {(products?.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.styleCode} — {p.name}</option>
                ))}
              </NativeSelect>
            </Field>

            <Field label="Priority">
              <NativeSelect value={priority} onChange={(e) => setPriority(e.target.value)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{humanise(p)}</option>
                ))}
              </NativeSelect>
            </Field>

            <Field label="Production type">
              <NativeSelect value={productionType} onChange={(e) => setProductionType(e.target.value)}>
                {PRODUCTION_TYPES.map((t) => (
                  <option key={t} value={t}>{humanise(t)}</option>
                ))}
              </NativeSelect>
            </Field>

            <Field label="Planned start">
              <Input type="date" value={plannedStartDate} onChange={(e) => setPlannedStartDate(e.target.value)} />
            </Field>

            <Field label="Due date">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>

            <Field label="Remarks">
              <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} />
            </Field>
          </div>

          {productId && !hasApprovedBom ? (
            <div className="mt-3 flex items-start gap-2 rounded border border-warn/40 bg-warn-soft px-3 py-2 text-[12.5px]">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
              <div>
                <p className="font-medium text-ink">This style has no approved BOM.</p>
                <p className="text-ink-muted">
                  The order can be created, but it cannot be planned or released until a BOM version for it
                  is approved.
                </p>
              </div>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card className="mb-3">
        <CardHeader
          title="Size breakdown"
          description="An order is always a set of SKU lines. A single total cannot tell the cutting table how many smalls to cut."
        />
        <CardBody>
          {!product ? (
            <p className="py-6 text-center text-[12.5px] text-ink-muted">Choose a style first.</p>
          ) : variantsLoading ? (
            <p className="py-6 text-center text-[12.5px] text-ink-muted">Loading SKUs…</p>
          ) : variants.length === 0 ? (
            <p className="py-6 text-center text-[12.5px] text-ink-muted">This style has no SKUs.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {variants.map((v) => (
                <Field
                  key={v.id}
                  label={v.size ?? v.sku}
                  hint={v.color ?? undefined}
                >
                  <QtyInput
                    value={qtyBySku[v.id] ?? ''}
                    onChange={(e) => setQtyBySku((q) => ({ ...q, [v.id]: e.target.value }))}
                    placeholder="0"
                  />
                </Field>
              ))}
            </div>
          )}

          {total > 0 ? (
            <p className="mt-3 text-right text-[13px]">
              <span className="text-ink-muted">Total </span>
              <span className="num font-semibold">{total}</span>
              <span className="text-ink-muted"> garments across {items.length} SKU(s)</span>
            </p>
          ) : null}
        </CardBody>
      </Card>

      <div className="flex items-center justify-end gap-2">
        {items.length === 0 ? (
          <span className="text-[12px] text-ink-muted">Enter a quantity against at least one size</span>
        ) : null}
        <Button
          variant="primary"
          disabled={!productId || items.length === 0}
          loading={create.isPending}
          onClick={() => create.mutate()}
        >
          Create order
        </Button>
      </div>
    </div>
  );
}
