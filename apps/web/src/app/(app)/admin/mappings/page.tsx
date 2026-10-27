'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { Link2, TriangleAlert } from 'lucide-react';
import { EXTERNAL_PROVIDERS } from '@dnd/contracts';
import { api } from '@/lib/api';
import { useListQuery, useListState, paginationProps } from '@/lib/hooks';
import { humanise } from '@/lib/utils';
import {
  Badge, Button, Card, CardBody, CardHeader, ErrorPanel, Field, Input, NativeSelect,
  PageHeader, Stat, StatusBadge,
} from '@/components/ui/primitives';
import { CsvImportButton } from '@/components/app/csv-import';
import { CodeCell, DataTable, StackedCell } from '@/components/ui/data-table';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { useAuth } from '@/components/app/auth-context';

/** Identifier kinds each provider actually uses. Not free text, so a mapping
 *  cannot be created against a kind the connectors will never look up. */
const IDENTIFIER_KINDS: Record<string, string[]> = {
  SHOPIFY: ['VARIANT_GID', 'PRODUCT_GID', 'VARIANT_SKU', 'INVENTORY_ITEM_GID'],
  UNICOMMERCE: ['ITEM_SKU_CODE', 'ITEM_TYPE_ID'],
};

interface VariantRow {
  id: string; sku: string; barcode: string | null; color: string | null; size: string | null;
  isBundle: boolean; status: string;
  product: { id: string; styleCode: string; name: string; collection: string | null };
  externalMappings: {
    provider: string; identifierKind: string; externalId: string;
    externalSku: string | null; isPrimary: boolean;
  }[];
}

interface MappingIssues {
  generatedAt: string;
  counts: { unmappedShopify: number; unmappedUnicommerce: number; duplicateExternalSkus: number; openSyncIssues: number };
}

export default function MappingsPage() {
  const { can } = useAuth();
  const state = useListState({ sortBy: 'sku', sortDir: 'asc', pageSize: 50 });
  const { data, isLoading, isFetching, error, refetch } = useListQuery<VariantRow>(
    'variants', '/products/variants', state,
  );
  const { data: issues } = useQuery({
    queryKey: ['mapping-issues'],
    queryFn: () => api.get<MappingIssues>('/products/mapping-issues'),
  });
  const [mapping, setMapping] = React.useState<VariantRow | null>(null);

  const columns = React.useMemo<ColumnDef<VariantRow, unknown>[]>(
    () => [
      { id: 'sku', header: 'SKU', accessorKey: 'sku',
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <CodeCell>{row.original.sku}</CodeCell>
            {row.original.isBundle ? <Badge tone="info">bundle</Badge> : null}
          </div>
        ),
      },
      { id: 'product', header: 'Style', accessorFn: (r) => r.product.styleCode,
        cell: ({ row }) => (
          <StackedCell primary={row.original.product.styleCode} secondary={row.original.product.name} />
        ),
      },
      { id: 'variant', header: 'Variant',
        accessorFn: (r) => `${r.color ?? ''} ${r.size ?? ''}`,
        cell: ({ row }) => (
          <span className="text-ink-muted">
            {[row.original.color, row.original.size].filter(Boolean).join(' / ') || '-'}
          </span>
        ),
      },
      ...EXTERNAL_PROVIDERS.map<ColumnDef<VariantRow, unknown>>((provider) => ({
        id: `map-${provider}`,
        header: humanise(provider),
        accessorFn: (r) => r.externalMappings.filter((m) => m.provider === provider).length,
        cell: ({ row }) => {
          const maps = row.original.externalMappings.filter((m) => m.provider === provider);
          if (maps.length === 0) {
            return (
              <Badge tone="danger" className="whitespace-nowrap">
                <TriangleAlert className="size-3" />
                unmapped
              </Badge>
            );
          }
          return (
            <div className="space-y-0.5">
              {maps.map((m) => (
                <div key={`${m.identifierKind}-${m.externalId}`} className="text-[12px]">
                  <span className="font-medium text-ink-muted">{m.identifierKind}</span>{' '}
                  <span className="font-mono text-ink">{truncate(m.externalId)}</span>
                  {m.isPrimary ? <Badge tone="brand" className="ml-1">primary</Badge> : null}
                </div>
              ))}
            </div>
          );
        },
      })),
      { id: 'status', header: 'Status', accessorKey: 'status',
        cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      { id: 'actions', header: '', meta: { align: 'right' },
        cell: ({ row }) =>
          can('products.manage_mappings') ? (
            <Button size="sm" variant="default" onClick={() => setMapping(row.original)}>
              <Link2 />
              Map
            </Button>
          ) : null,
      },
    ],
    [can],
  );

  return (
    <div>
      <PageHeader
        title="SKU Mappings"
        description="External identifiers for each canonical SKU. An unmapped SKU cannot take part in an order import or an inventory push, so these gaps are blockers rather than cosmetic."
        actions={<CsvImportButton type="product-mappings" invalidate={['mapping-issues', 'shopify-orders', 'demand']} label="Import mappings" />}
      />

      {issues ? (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat
            label="Unmapped in Shopify"
            value={issues.counts.unmappedShopify}
            tone={issues.counts.unmappedShopify > 0 ? 'danger' : 'ok'}
            hint="active SKUs with no Shopify identifier"
          />
          <Stat
            label="Unmapped in Unicommerce"
            value={issues.counts.unmappedUnicommerce}
            tone={issues.counts.unmappedUnicommerce > 0 ? 'danger' : 'ok'}
            hint="would block an inventory push"
          />
          <Stat
            label="Duplicate external SKUs"
            value={issues.counts.duplicateExternalSkus}
            tone={issues.counts.duplicateExternalSkus > 0 ? 'warn' : 'ok'}
            hint="one external SKU on two variants"
          />
          <Stat
            label="Open sync issues"
            value={issues.counts.openSyncIssues}
            tone={issues.counts.openSyncIssues > 0 ? 'warn' : 'ok'}
            hint="unresolved import problems"
          />
        </div>
      ) : null}

      {error ? <ErrorPanel error={error} onRetry={() => void refetch()} className="mb-3" /> : null}

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        isFetching={isFetching}
        pagination={paginationProps(data, state)}
        search={{ value: state.search, onChange: state.setSearch, placeholder: 'SKU, colour, size, barcode' }}
        exportFileName="sku-mappings"
        emptyTitle="No SKUs"
        toolbar={
          <NativeSelect
            value={String(state.filters.unmappedProvider ?? '')}
            onChange={(e) => state.setFilter('unmappedProvider', e.target.value || undefined)}
            className="w-auto"
            aria-label="Show unmapped"
          >
            <option value="">All SKUs</option>
            {EXTERNAL_PROVIDERS.map((p) => (
              <option key={p} value={p}>Unmapped in {humanise(p)}</option>
            ))}
          </NativeSelect>
        }
      />

      {mapping ? (
        <MappingDialog
          open
          onOpenChange={(v) => !v && setMapping(null)}
          variant={mapping}
          onSaved={() => void refetch()}
        />
      ) : null}
    </div>
  );
}

function MappingDialog({
  open, onOpenChange, variant, onSaved,
}: { open: boolean; onOpenChange: (v: boolean) => void; variant: VariantRow; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const [provider, setProvider] = React.useState<'SHOPIFY' | 'UNICOMMERCE'>('UNICOMMERCE');
  const [identifierKind, setIdentifierKind] = React.useState('ITEM_SKU_CODE');
  const [externalId, setExternalId] = React.useState(variant.sku);
  const [externalSku, setExternalSku] = React.useState(variant.sku);
  const [isPrimary, setIsPrimary] = React.useState(true);
  const [error, setError] = React.useState<unknown>(null);

  const save = useMutation({
    mutationFn: () =>
      api.post('/products/mappings', {
        productVariantId: variant.id,
        provider,
        identifierKind,
        externalId,
        externalSku: externalSku || null,
        isPrimary,
      }),
    onSuccess: () => {
      toast.success(`${humanise(provider)} identifier mapped to ${variant.sku}`);
      void queryClient.invalidateQueries();
      onSaved();
      onOpenChange(false);
    },
    onError: setError,
  });

  const existing = variant.externalMappings.filter((m) => m.provider === provider);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Map ${variant.sku}`}
        description="External identifiers are stored verbatim. The internal SKU stays the single canonical identity."
        footer={
          <>
            <DialogClose asChild><Button variant="default">Cancel</Button></DialogClose>
            <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!externalId}>
              Save mapping
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error ? <ErrorPanel error={error} /> : null}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Provider" required>
              <NativeSelect
                value={provider}
                onChange={(e) => {
                  const p = e.target.value as 'SHOPIFY' | 'UNICOMMERCE';
                  setProvider(p);
                  setIdentifierKind(IDENTIFIER_KINDS[p]![0]!);
                }}
              >
                {EXTERNAL_PROVIDERS.map((p) => <option key={p} value={p}>{humanise(p)}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Identifier kind" required>
              <NativeSelect value={identifierKind} onChange={(e) => setIdentifierKind(e.target.value)}>
                {(IDENTIFIER_KINDS[provider] ?? []).map((k) => <option key={k} value={k}>{k}</option>)}
              </NativeSelect>
            </Field>
          </div>

          <Field
            label="External identifier"
            required
            hint={provider === 'SHOPIFY' ? 'e.g. gid://shopify/ProductVariant/123' : 'the Uniware item SKU code'}
          >
            <Input value={externalId} onChange={(e) => setExternalId(e.target.value)} className="font-mono" />
          </Field>
          <Field label="External SKU" hint="as the other system spells it">
            <Input value={externalSku} onChange={(e) => setExternalSku(e.target.value)} className="font-mono" />
          </Field>

          <label className="flex items-start gap-2 rounded border border-line bg-surface-muted px-3 py-2 text-[12.5px]">
            <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} className="mt-0.5" />
            <span>
              <span className="font-medium text-ink">Primary identifier for this provider</span>
              <span className="block text-[12px] text-ink-muted">
                Used by order imports and inventory pushes. Only one per provider.
              </span>
            </span>
          </label>

          {existing.length > 0 ? (
            <Card>
              <CardHeader title={`Existing ${humanise(provider)} identifiers`} />
              <CardBody className="space-y-1">
                {existing.map((m) => (
                  <div key={`${m.identifierKind}-${m.externalId}`} className="flex items-center gap-2 text-[12px]">
                    <Badge tone="outline">{m.identifierKind}</Badge>
                    <CodeCell>{m.externalId}</CodeCell>
                    {m.isPrimary ? <Badge tone="brand">primary</Badge> : null}
                  </div>
                ))}
              </CardBody>
            </Card>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const truncate = (s: string, n = 28) => (s.length > n ? `${s.slice(0, n)}…` : s);
