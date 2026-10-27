'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Pencil } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtQty, humanise, uomShort } from '@/lib/utils';
import {
  Badge, Button, Card, CardBody, CardHeader, DescList, ErrorPanel, LoadingBlock,
  PageHeader, Stat, StatusBadge,
} from '@/components/ui/primitives';
import { CodeCell } from '@/components/ui/data-table';
import { useAuth } from '@/components/app/auth-context';
import { MaterialFormDialog } from '../material-form';

interface MaterialDetail {
  id: string; materialCode: string; name: string; category: string; description: string | null;
  color: string | null; fabricComposition: string | null; width: string | null; widthUom: string | null;
  gsm: number | null; baseUom: string; purchaseUom: string | null; purchaseRate: string | null;
  averageCost: string; minimumStock: string; reorderLevel: string; reorderQty: string;
  leadTimeDays: number; lotTracked: boolean; shadeTracked: boolean; status: string;
  defaultSupplier: { id: string; name: string } | null;
  defaultLocation: { id: string; code: string; name: string } | null;
  uomConversions: { id: string; fromUom: string; toUom: string; factor: string; note: string | null }[];
  lots: {
    id: string; lotCode: string; shade: string | null; width: string | null; gsm: number | null;
    unitCost: string; receivedAt: string | null; isGeneral: boolean;
    supplier: { id: string; name: string } | null;
  }[];
  stock: {
    onHandQty: string; issuableQty: string; reservedQty: string; availableQty: string;
    qualityHoldQty: string; blockedQty: string; withJobWorkerQty: string;
    inTransitQty: string; issuedToProductionQty: string; alertLevel: string;
  };
  balancesByLocation: {
    locationId: string; locationCode: string; locationName: string; locationKind: string;
    materialLotId: string; lotCode: string; shade: string | null; width: string | null;
    onHandQty: string; reservedQty: string;
  }[];
}

export default function MaterialDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const [editing, setEditing] = React.useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['material', id],
    queryFn: () => api.get<MaterialDetail>(`/materials/${id}`),
  });

  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorPanel error={error} onRetry={() => void refetch()} />;
  if (!data) return null;

  const uom = uomShort(data.baseUom);

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${data.materialCode} · ${data.name}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="outline">{humanise(data.category)}</Badge>
            <StatusBadge status={data.status} />
            {data.lotTracked ? <Badge tone="info">Lot tracked</Badge> : null}
            {data.shadeTracked ? <Badge tone="info">Shade controlled</Badge> : null}
          </span>
        }
        actions={
          <>
            <Button variant="default" onClick={() => router.push('/materials')}>
              <ArrowLeft />
              All materials
            </Button>
            {can('materials.write') ? (
              <Button variant="primary" onClick={() => setEditing(true)}>
                <Pencil />
                Edit
              </Button>
            ) : null}
          </>
        }
      />

      {/* The stock position, with the distinctions that matter spelled out. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="Available"
          value={`${fmtQty(data.stock.availableQty)}`}
          hint={`${uom} · free to issue`}
          tone={data.stock.alertLevel === 'OK' ? 'ok' : data.stock.alertLevel === 'OUT_OF_STOCK' ? 'danger' : 'warn'}
        />
        <Stat label="Reserved" value={fmtQty(data.stock.reservedQty)} hint="committed to orders" />
        <Stat label="At production" value={fmtQty(data.stock.issuedToProductionQty)} hint="issued, not consumed" />
        <Stat label="QC hold" value={fmtQty(data.stock.qualityHoldQty)} hint="awaiting inspection" tone={Number(data.stock.qualityHoldQty) > 0 ? 'warn' : undefined} />
        <Stat label="Blocked" value={fmtQty(data.stock.blockedQty)} hint="rejected or damaged" tone={Number(data.stock.blockedQty) > 0 ? 'danger' : undefined} />
        <Stat label="On hand" value={fmtQty(data.stock.onHandQty)} hint="total owned" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Stock by location and lot"
            description="This is the ledger projection: one row per material, lot and location"
            actions={
              <Link
                href={`/inventory/movements?rawMaterialId=${data.id}`}
                className="text-[12px] font-medium text-brand hover:underline"
              >
                Movement history
              </Link>
            }
          />
          {data.balancesByLocation.length === 0 ? (
            <CardBody className="text-[12.5px] text-ink-muted">
              No stock anywhere. Receive a purchase order to create the first balance.
            </CardBody>
          ) : (
            <div className="scroll-x">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-line bg-surface-muted text-[12px] font-medium text-ink-muted">
                    <th className="px-3 py-1.5 text-left font-semibold">Location</th>
                    <th className="px-3 py-1.5 text-left font-semibold">Lot</th>
                    <th className="px-3 py-1.5 text-left font-semibold">Shade</th>
                    <th className="px-3 py-1.5 text-right font-semibold">On hand</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Reserved</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Available</th>
                  </tr>
                </thead>
                <tbody>
                  {data.balancesByLocation.map((b) => (
                    <tr key={`${b.locationId}-${b.materialLotId}`} className="border-b border-line last:border-0">
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <CodeCell>{b.locationCode}</CodeCell>
                          <StatusBadge status={b.locationKind} />
                        </div>
                      </td>
                      <td className="px-3 py-1.5"><CodeCell>{b.lotCode}</CodeCell></td>
                      <td className="px-3 py-1.5 text-ink-muted">{b.shade ?? '-'}</td>
                      <td className="num px-3 py-1.5 text-right font-medium">{fmtQty(b.onHandQty)}</td>
                      <td className="num px-3 py-1.5 text-right text-ink-muted">{fmtQty(b.reservedQty)}</td>
                      <td className="num px-3 py-1.5 text-right">
                        {fmtQty(String(Number(b.onHandQty) - Number(b.reservedQty)))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Specification" />
            <CardBody>
              <DescList
                columns={2}
                items={[
                  { label: 'Base unit', value: humanise(data.baseUom) },
                  { label: 'Purchase unit', value: data.purchaseUom ? humanise(data.purchaseUom) : 'Same as base' },
                  { label: 'Colour', value: data.color ?? '-' },
                  { label: 'Composition', value: data.fabricComposition ?? '-' },
                  { label: 'Width', value: data.width ? `${fmtQty(data.width, 1)} ${data.widthUom ?? ''}` : '-' },
                  { label: 'GSM', value: data.gsm ?? '-' },
                  { label: 'Average cost', value: fmtMoney(data.averageCost) },
                  { label: 'Purchase rate', value: fmtMoney(data.purchaseRate) },
                  { label: 'Minimum stock', value: `${fmtQty(data.minimumStock, 0)} ${uom}` },
                  { label: 'Reorder level', value: `${fmtQty(data.reorderLevel, 0)} ${uom}` },
                  { label: 'Reorder quantity', value: `${fmtQty(data.reorderQty, 0)} ${uom}` },
                  { label: 'Lead time', value: `${data.leadTimeDays} days` },
                  { label: 'Default supplier', value: data.defaultSupplier?.name ?? '-' },
                  {
                    label: 'Default location',
                    value: data.defaultLocation ? `${data.defaultLocation.code}` : '-',
                  },
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Unit conversions"
              description="Conversions are never assumed; only configured ones apply"
            />
            {data.uomConversions.length === 0 ? (
              <CardBody className="text-[12.5px] text-ink-muted">
                None configured. A purchase in any unit other than {humanise(data.baseUom)} will be
                refused until a conversion exists.
              </CardBody>
            ) : (
              <ul className="divide-y divide-line text-[12.5px]">
                {data.uomConversions.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                    <span className="num">
                      1 {humanise(c.fromUom)} = {fmtQty(c.factor, 4)} {humanise(c.toUom)}
                    </span>
                    {c.note ? <span className="truncate text-[12px] text-ink-subtle">{c.note}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Lots"
          description="One lot per delivery, carrying the shade and width that must not be mixed"
          actions={
            <Link href={`/materials/lots?rawMaterialId=${data.id}`} className="text-[12px] font-medium text-brand hover:underline">
              All lots
            </Link>
          }
        />
        {data.lots.length === 0 ? (
          <CardBody className="text-[12.5px] text-ink-muted">No lots yet.</CardBody>
        ) : (
          <div className="scroll-x">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-surface-muted text-[12px] font-medium text-ink-muted">
                  <th className="px-3 py-1.5 text-left font-semibold">Lot</th>
                  <th className="px-3 py-1.5 text-left font-semibold">Shade</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Width</th>
                  <th className="px-3 py-1.5 text-right font-semibold">GSM</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Unit cost</th>
                  <th className="px-3 py-1.5 text-left font-semibold">Supplier</th>
                  <th className="px-3 py-1.5 text-left font-semibold">Received</th>
                </tr>
              </thead>
              <tbody>
                {data.lots.map((l) => (
                  <tr key={l.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-1.5">
                      <CodeCell>{l.lotCode}</CodeCell>
                      {l.isGeneral ? <Badge tone="neutral" className="ml-1.5">implicit</Badge> : null}
                    </td>
                    <td className="px-3 py-1.5">{l.shade ?? '-'}</td>
                    <td className="num px-3 py-1.5 text-right">{l.width ? fmtQty(l.width, 1) : '-'}</td>
                    <td className="num px-3 py-1.5 text-right">{l.gsm ?? '-'}</td>
                    <td className="num px-3 py-1.5 text-right">{fmtMoney(l.unitCost)}</td>
                    <td className="px-3 py-1.5 text-ink-muted">{l.supplier?.name ?? '-'}</td>
                    <td className="px-3 py-1.5 text-ink-muted">{fmtDate(l.receivedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing ? (
        <MaterialFormDialog
          open={editing}
          onOpenChange={setEditing}
          material={data as unknown as { id: string } & Record<string, unknown>}
          onSaved={() => void refetch()}
        />
      ) : null}
    </div>
  );
}
