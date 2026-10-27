'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDateTime, humanise } from '@/lib/utils';
import {
  Badge, Card, CardBody, CardHeader, DescList, EmptyState, ErrorPanel,
  LoadingBlock, PageHeader, StatusBadge,
} from '@/components/ui/primitives';

interface Mapping {
  id: string; provider: string; identifierKind: string;
  externalId: string; externalSku: string | null; syncedAt: string | null;
}
interface Variant {
  id: string; sku: string; barcode: string | null; name: string | null;
  color: string | null; size: string | null; sizeSortOrder: number;
  status: string; activeBomVersionId: string | null;
  externalMappings: Mapping[];
}
interface BomVersion { id: string; version: number; status: string }
interface Bom { id: string; name: string | null; versions: BomVersion[] }
interface Product {
  id: string; styleCode: string; name: string; collection: string | null;
  category: string | null; status: string; imageUrl: string | null;
  productionType: string; createdAt: string; updatedAt: string;
  variants: Variant[]; boms: Bom[];
}

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['product', id],
    queryFn: () => api.get<Product>(`/products/${id}`),
  });

  if (isLoading) return <LoadingBlock label="Loading product" />;
  if (error) return <ErrorPanel error={error} onRetry={() => void refetch()} />;
  if (!data) return null;

  const variants = [...data.variants].sort((a, b) => a.sizeSortOrder - b.sizeSortOrder);
  const mapped = variants.filter((v) => v.externalMappings.length > 0).length;
  const withBom = variants.filter((v) => v.activeBomVersionId).length;

  return (
    <div className="space-y-4">
      <Link
        href="/admin/products"
        className="inline-flex items-center gap-1 text-[12px] font-medium text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="size-3.5" /> Product master
      </Link>

      <PageHeader
        title={data.name}
        description={`Style ${data.styleCode}${data.category ? ` · ${data.category}` : ''}`}
        actions={<StatusBadge status={data.status} />}
      />

      <Card>
        <CardBody>
          <div className="flex flex-wrap gap-4">
            {data.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={data.imageUrl}
                alt=""
                className="size-24 shrink-0 rounded border border-line object-cover grayscale"
              />
            ) : null}
            <div className="min-w-[260px] flex-1">
              <DescList
                items={[
                  { label: 'Style code', value: data.styleCode },
                  { label: 'Department', value: data.collection ?? '—' },
                  { label: 'Category', value: data.category ?? '—' },
                  { label: 'Made', value: humanise(data.productionType) },
                  { label: 'Sizes', value: `${variants.length}` },
                  { label: 'Updated', value: fmtDateTime(data.updatedAt) },
                ]}
              />
            </div>
          </div>
        </CardBody>
      </Card>

      {variants.length > 0 && mapped < variants.length ? (
        <p className="rounded-lg border border-line bg-surface-muted px-3.5 py-2.5 text-[12px] row-flag">
          <span className="font-medium text-ink">
            {variants.length - mapped} of {variants.length} sizes have no external mapping.
          </span>{' '}
          An order line for an unmapped size cannot resolve to this product, so its demand never
          reaches manufacturing.
        </p>
      ) : null}

      <Card>
        <CardHeader
          title="Sizes"
          description="Sorted the way a human reads them, not alphabetically. Each size is its own SKU and carries its own external identity."
        />
        {variants.length === 0 ? (
          <EmptyState
            title="No sizes on this product"
            description="Pull the catalogue from Shopify to bring its variants in."
          />
        ) : (
          <div className="scroll-x">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-surface-muted text-[12px] font-medium text-ink-muted">
                  <th className="px-3 py-1.5 text-left font-semibold">Size</th>
                  <th className="px-3 py-1.5 text-left font-semibold">SKU</th>
                  <th className="px-3 py-1.5 text-left font-semibold">Colour</th>
                  <th className="px-3 py-1.5 text-left font-semibold">Barcode</th>
                  <th className="px-3 py-1.5 text-left font-semibold">Linked to</th>
                  <th className="px-3 py-1.5 text-left font-semibold">BOM</th>
                </tr>
              </thead>
              <tbody>
                {variants.map((v) => (
                  <tr key={v.id} className={`border-b border-line last:border-0 ${v.externalMappings.length === 0 ? 'row-flag' : ''}`}>
                    <td className="px-3 py-1.5 font-display text-[13px] font-semibold">{v.size ?? '—'}</td>
                    <td className="px-3 py-1.5 font-mono text-[12px]">{v.sku}</td>
                    <td className="px-3 py-1.5 text-ink-muted">{v.color ?? '—'}</td>
                    <td className="px-3 py-1.5 font-mono text-[12px] text-ink-muted">{v.barcode ?? '—'}</td>
                    <td className="px-3 py-1.5">
                      {v.externalMappings.length === 0 ? (
                        <Badge tone="warn">not linked</Badge>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {v.externalMappings.map((m) => (
                            <Badge key={m.id} tone="outline" >
                              {humanise(m.provider)}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {v.activeBomVersionId
                        ? <Badge tone="neutral">set</Badge>
                        : <span className="text-ink-subtle">none</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Bills of material"
          description={withBom > 0
            ? `${withBom} of ${variants.length} sizes have an active BOM.`
            : 'No size has an active BOM yet, so nothing can be released to production.'}
        />
        {data.boms.length === 0 ? (
          <EmptyState
            title="No BOM for this style"
            description="A manufacturing order cannot be released without one — it is what tells the floor what to cut."
            action={
              <Link href="/bom/new" className="inline-flex items-center gap-1 rounded border border-line px-2.5 py-1 text-[12px] font-medium hover:bg-surface-muted">
                Create a BOM
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {data.boms.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 px-3.5 py-2">
                <span className="flex-1 text-[12.5px] font-medium">{b.name ?? 'Unnamed BOM'}</span>
                {b.versions.map((v) => (
                  <Link key={v.id} href={`/bom/${v.id}`} className="inline-flex items-center gap-1.5 hover:underline">
                    <span className="font-mono text-[12px]">v{v.version}</span>
                    <StatusBadge status={v.status} />
                  </Link>
                ))}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
