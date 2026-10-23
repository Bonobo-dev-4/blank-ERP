'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import {
  Button, Card, CardBody, CardHeader, ErrorPanel, Field, Input, NativeSelect, PageHeader, Textarea,
} from '@/components/ui/primitives';
import { BomLineEditor, emptyLine, isLineComplete, toApiLines, type BomLineDraft } from '../bom-line-editor';

interface ProductOption {
  id: string; styleCode: string; name: string;
  variants?: { id: string; sku: string; size: string | null; color: string | null }[];
}

export default function NewBomPage() {
  const router = useRouter();

  const [productId, setProductId] = React.useState('');
  const [productVariantId, setProductVariantId] = React.useState('');
  const [name, setName] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [lines, setLines] = React.useState<BomLineDraft[]>([emptyLine()]);

  const { data: products } = useQuery({
    queryKey: ['products', 'bom-picker'],
    queryFn: () => api.get<Paginated<ProductOption>>('/products', { pageSize: 200 }),
  });
  const product = (products?.data ?? []).find((p) => p.id === productId);

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string; bomId: string }>('/bom', {
        productId,
        productVariantId: productVariantId || null,
        name: name || null,
        notes: notes || null,
        baseQuantity: '1',
        items: toApiLines(lines),
      }),
    onSuccess: (res) => {
      toast.success('BOM created as a draft');
      router.push(`/bom/${res.bomId}`);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const complete = lines.filter(isLineComplete);
  const canSubmit = Boolean(productId) && complete.length === lines.length && lines.length > 0;

  return (
    <div className="mx-auto max-w-5xl">
      <Button onClick={() => router.push('/bom')} className="mb-3">
        <ArrowLeft />
        All BOMs
      </Button>

      <PageHeader
        title="New BOM"
        description="Created as a DRAFT. It has to be submitted and approved before a manufacturing order can be planned or released against it."
      />

      {create.error ? <ErrorPanel error={create.error} className="mb-3" /> : null}

      <Card className="mb-3">
        <CardHeader title="Scope" />
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Style" required>
              <NativeSelect
                value={productId}
                onChange={(e) => {
                  setProductId(e.target.value);
                  setProductVariantId('');
                }}
              >
                <option value="">Select a style</option>
                {(products?.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.styleCode} — {p.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field
              label="Applies to"
              hint="A style-level BOM covers every SKU that does not have its own. A SKU-specific BOM wins for that one SKU."
            >
              <NativeSelect
                value={productVariantId}
                onChange={(e) => setProductVariantId(e.target.value)}
                disabled={!product}
              >
                <option value="">Every SKU of this style</option>
                {(product?.variants ?? []).map((v) => (
                  <option key={v.id} value={v.id}>{v.sku}</option>
                ))}
              </NativeSelect>
            </Field>

            <Field label="Name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Defaults to the style code"
              />
            </Field>

            <Field label="Notes">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card className="mb-3">
        <CardHeader
          title="Material lines"
          description="Consumption is what ends up in the garment; wastage is what the cutting table loses. They are separate so a BOM error can be told apart from a process problem."
        />
        <CardBody>
          <BomLineEditor lines={lines} onChange={setLines} />
        </CardBody>
      </Card>

      <div className="flex items-center justify-end gap-2">
        {!canSubmit ? (
          <span className="text-[12px] text-ink-muted">
            {!productId
              ? 'Choose a style to continue'
              : `${lines.length - complete.length} line(s) still need a material, a quantity and a unit`}
          </span>
        ) : null}
        <Button
          variant="primary"
          disabled={!canSubmit}
          loading={create.isPending}
          onClick={() => create.mutate()}
        >
          Create draft
        </Button>
      </div>
    </div>
  );
}
