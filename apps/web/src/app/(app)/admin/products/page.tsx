'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { Grid3x3, Plus } from 'lucide-react';
import { PRODUCT_STATUSES, PRODUCTION_TYPES, createProductRequest } from '@dnd/contracts';
import { api } from '@/lib/api';
import { useListQuery, useListState, paginationProps } from '@/lib/hooks';
import { humanise } from '@/lib/utils';
import {
  Badge, Button, ErrorPanel, Field, Input, NativeSelect, PageHeader, StatusBadge, Textarea,
} from '@/components/ui/primitives';
import { CsvImportButton } from '@/components/app/csv-import';
import { CodeCell, DataTable, StackedCell } from '@/components/ui/data-table';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/app/auth-context';

interface ProductRow {
  id: string; styleCode: string; name: string; collection: string | null; category: string | null;
  sizeSet: string | null; productionType: string; standardManufacturingDays: number | null;
  status: string;
  defaultRoute: { id: string; code: string; name: string } | null;
  _count: { variants: number; boms: number };
}

export default function ProductsPage() {
  const { can } = useAuth();
  const state = useListState({ sortBy: 'styleCode', sortDir: 'asc' });
  const router = useRouter();
  const { data, isLoading, isFetching, error, refetch } = useListQuery<ProductRow>(
    'products', '/products', state,
  );
  const [creating, setCreating] = React.useState(false);
  const [matrixFor, setMatrixFor] = React.useState<ProductRow | null>(null);

  const columns = React.useMemo<ColumnDef<ProductRow, unknown>[]>(
    () => [
      { id: 'styleCode', header: 'Style', accessorKey: 'styleCode',
        cell: ({ row }) => <CodeCell>{row.original.styleCode}</CodeCell> },
      { id: 'name', header: 'Product', accessorKey: 'name',
        cell: ({ row }) => (
          <StackedCell
            primary={row.original.name}
            secondary={[row.original.collection, row.original.category].filter(Boolean).join(' · ')}
          />
        ),
      },
      { id: 'variants', header: 'SKUs', accessorFn: (r) => r._count.variants,
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => (
          <span className={row.original._count.variants === 0 ? 'text-warn' : undefined}>
            {row.original._count.variants}
          </span>
        ),
      },
      { id: 'boms', header: 'BOMs', accessorFn: (r) => r._count.boms,
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => (row.original._count.boms > 0 ? row.original._count.boms : <span className="text-ink-subtle">-</span>) },
      { id: 'sizeSet', header: 'Size set', accessorKey: 'sizeSet',
        cell: ({ row }) => <span className="text-[12px] text-ink-muted">{row.original.sizeSet ?? '-'}</span> },
      { id: 'productionType', header: 'Production', accessorKey: 'productionType',
        cell: ({ row }) => <Badge tone="outline">{humanise(row.original.productionType)}</Badge> },
      { id: 'route', header: 'Route', accessorFn: (r) => r.defaultRoute?.code ?? '',
        cell: ({ row }) => (row.original.defaultRoute ? <CodeCell>{row.original.defaultRoute.code}</CodeCell> : <span className="text-ink-subtle">-</span>) },
      { id: 'days', header: 'Lead', accessorKey: 'standardManufacturingDays',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => (row.original.standardManufacturingDays ? `${row.original.standardManufacturingDays}d` : '-') },
      { id: 'status', header: 'Status', accessorKey: 'status',
        cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      { id: 'actions', header: '', meta: { align: 'right' },
        cell: ({ row }) =>
          can('products.write') ? (
            <Button size="sm" variant="default" onClick={() => setMatrixFor(row.original)}>
              <Grid3x3 />
              SKU matrix
            </Button>
          ) : null,
      },
    ],
    [can],
  );

  return (
    <div>
      <PageHeader
        title="Product Master"
        description="Styles and their SKUs. One canonical SKU per variant, with Shopify and Unicommerce identifiers held as mappings - which is what stops the same SKU arriving from two systems creating two products."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <CsvImportButton type="products" invalidate={['products']} />
            {can('products.write') ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus />
              New style
            </Button>
            ) : null}
          </div>
        }
      />
      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} className="mb-3" /> : null}
      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        isFetching={isFetching}
        pagination={paginationProps(data, state)}
        search={{ value: state.search, onChange: state.setSearch, placeholder: 'Style code, name, collection' }}
        exportFileName="products"
        onRowClick={(row) => router.push(`/admin/products/${row.id}`)}
        emptyTitle="No products"
        toolbar={
          <NativeSelect
            value={String(state.filters.status ?? '')}
            onChange={(e) => state.setFilter('status', e.target.value || undefined)}
            className="w-auto"
            aria-label="Status"
          >
            <option value="">Any status</option>
            {PRODUCT_STATUSES.map((s) => (
              <option key={s} value={s}>{humanise(s)}</option>
            ))}
          </NativeSelect>
        }
      />
      {creating ? <ProductDialog open={creating} onOpenChange={setCreating} onSaved={() => void refetch()} /> : null}
      {matrixFor ? (
        <MatrixDialog
          open
          onOpenChange={(v) => !v && setMatrixFor(null)}
          product={matrixFor}
          onSaved={() => void refetch()}
        />
      ) : null}
    </div>
  );
}

function ProductDialog({
  open, onOpenChange, onSaved,
}: { open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState({
    styleCode: '', name: '', collection: '', category: '', sizeSet: 'XS,S,M,L,XL,XXL',
    fabricDescription: '', productionType: 'IN_HOUSE', standardManufacturingDays: '12',
    status: 'DRAFT', notes: '',
  });
  const [error, setError] = React.useState<unknown>(null);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const parsed = createProductRequest.parse({
        ...form,
        collection: form.collection || null,
        category: form.category || null,
        sizeSet: form.sizeSet || null,
        fabricDescription: form.fabricDescription || null,
        standardManufacturingDays: form.standardManufacturingDays ? Number(form.standardManufacturingDays) : null,
        notes: form.notes || null,
      });
      return api.post('/products', parsed);
    },
    onSuccess: () => {
      toast.success(`Style ${form.styleCode} created`);
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      onSaved();
      onOpenChange(false);
    },
    onError: setError,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        wide
        title="New style"
        description="A style is the garment design. Its SKUs are the colour and size combinations you actually make and sell."
        footer={
          <>
            <DialogClose asChild><Button variant="default">Cancel</Button></DialogClose>
            <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>Create style</Button>
          </>
        }
      >
        <div className="space-y-3">
          {error ? <ErrorPanel error={error} /> : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Style code" required>
              <Input value={form.styleCode} onChange={(e) => set('styleCode', e.target.value.toUpperCase())}
                className="font-mono uppercase" placeholder="DD-KRT-002" />
            </Field>
            <Field label="Name" required className="sm:col-span-2">
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Dash and Dot Kurta" />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Field label="Collection"><Input value={form.collection} onChange={(e) => set('collection', e.target.value)} /></Field>
            <Field label="Category"><Input value={form.category} onChange={(e) => set('category', e.target.value)} /></Field>
            <Field label="Size set" hint="comma separated">
              <Input value={form.sizeSet} onChange={(e) => set('sizeSet', e.target.value.toUpperCase())} className="font-mono" />
            </Field>
            <Field label="Manufacturing days">
              <Input value={form.standardManufacturingDays}
                onChange={(e) => set('standardManufacturingDays', e.target.value.replace(/\D/g, ''))} className="num" />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Production type">
              <NativeSelect value={form.productionType} onChange={(e) => set('productionType', e.target.value)}>
                {PRODUCTION_TYPES.map((t) => <option key={t} value={t}>{humanise(t)}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Status">
              <NativeSelect value={form.status} onChange={(e) => set('status', e.target.value)}>
                {PRODUCT_STATUSES.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Fabric">
              <Input value={form.fabricDescription} onChange={(e) => set('fabricDescription', e.target.value)} />
            </Field>
          </div>
          <Field label="Notes"><Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} /></Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Generate the colour x size SKU matrix in one pass.
 *
 * A six-size, four-colour style is 24 SKUs. Typing them individually is how
 * typos get into SKUs that then silently fail to map to Shopify, so this
 * generates them from a pattern and skips any that already exist.
 */
function MatrixDialog({
  open, onOpenChange, product, onSaved,
}: { open: boolean; onOpenChange: (v: boolean) => void; product: ProductRow; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const [colors, setColors] = React.useState('Indigo, Ivory');
  const [sizes, setSizes] = React.useState(product.sizeSet ?? 'XS,S,M,L,XL,XXL');
  const [pattern, setPattern] = React.useState('{STYLE}-{COLOR}-{SIZE}');
  const [result, setResult] = React.useState<{ createdCount: number; skippedCount: number } | null>(null);
  const [error, setError] = React.useState<unknown>(null);

  const colorList = colors.split(',').map((s) => s.trim()).filter(Boolean);
  const sizeList = sizes.split(',').map((s) => s.trim()).filter(Boolean);

  const preview = colorList.slice(0, 2).flatMap((c) =>
    sizeList.slice(0, 3).map((s) =>
      pattern
        .replace('{STYLE}', product.styleCode)
        .replace('{COLOR}', c.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase())
        .replace('{SIZE}', s.replace(/[^A-Za-z0-9]/g, '').toUpperCase())
        .toUpperCase(),
    ),
  );

  const generate = useMutation({
    mutationFn: () =>
      api.post<{ createdCount: number; skippedCount: number }>('/products/variants/matrix', {
        productId: product.id,
        colors: colorList,
        sizes: sizeList,
        skuPattern: pattern,
        status: 'ACTIVE',
      }),
    onSuccess: (r) => {
      setResult(r);
      toast.success(`${r.createdCount} SKUs created, ${r.skippedCount} already existed`);
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      onSaved();
    },
    onError: setError,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`SKU matrix for ${product.styleCode}`}
        description={`${colorList.length} colours x ${sizeList.length} sizes = ${colorList.length * sizeList.length} SKUs`}
        footer={
          <>
            <DialogClose asChild><Button variant="default">Close</Button></DialogClose>
            <Button
              variant="primary"
              onClick={() => generate.mutate()}
              loading={generate.isPending}
              disabled={colorList.length === 0 || sizeList.length === 0}
            >
              Generate {colorList.length * sizeList.length} SKUs
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error ? <ErrorPanel error={error} /> : null}
          <Field label="Colours" required hint="comma separated">
            <Input value={colors} onChange={(e) => setColors(e.target.value)} />
          </Field>
          <Field label="Sizes" required hint="comma separated, in order">
            <Input value={sizes} onChange={(e) => setSizes(e.target.value.toUpperCase())} className="font-mono" />
          </Field>
          <Field label="SKU pattern" hint="{STYLE}, {COLOR}, {SIZE}">
            <Input value={pattern} onChange={(e) => setPattern(e.target.value)} className="font-mono" />
          </Field>
          <div className="rounded border border-line bg-surface-muted px-3 py-2">
            <p className="t-micro text-ink-subtle">Preview</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {preview.map((sku) => <CodeCell key={sku}>{sku}</CodeCell>)}
              {colorList.length * sizeList.length > preview.length ? (
                <span className="text-[12px] text-ink-subtle">
                  +{colorList.length * sizeList.length - preview.length} more
                </span>
              ) : null}
            </div>
          </div>
          {result ? (
            <p className="rounded border border-ok/30 bg-ok-soft px-3 py-2 text-[12.5px] text-ink">
              Created {result.createdCount} SKUs. {result.skippedCount} already existed and were left alone.
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
