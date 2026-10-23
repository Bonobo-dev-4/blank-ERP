'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight, Boxes, Clock, FileCheck2, PackageCheck, Scroll, TriangleAlert, Warehouse,
} from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDateTime, fmtInt, fmtMoneyCompact, fmtQty, fmtRelative, humanise, uomShort } from '@/lib/utils';
import {
  Badge, Card, CardBody, CardHeader, ErrorPanel, LoadingBlock, PageHeader, Stat, StatusBadge,
} from '@/components/ui/primitives';

interface DashboardSummary {
  generatedAt: string;
  masterData: {
    rawMaterials: number; activeRawMaterials: number; products: number; skus: number;
    suppliers: number; stockLocations: number; materialLots: number;
  };
  inventory: {
    available: boolean; issuableFabricRolls: number; fabricMetresOnHand: string;
    movementsToday: number; rawMaterialStockValue: string;
    outOfStockCount: number; belowMinimumCount: number; atReorderLevelCount: number;
  };
  purchasing: {
    available: boolean; openPurchaseOrders: number; awaitingApproval: number;
    overdue: number; receiptsPendingInspection: number;
  };
  production: { available: false; phase: number; note: string };
  demand: { available: false; phase: number; note: string };
  finishedGoods: { available: false; phase: number; note: string };
  topAlerts: {
    rawMaterialId: string; materialCode: string; materialName: string; baseUom: string;
    availableQty: string; minimumStock: string; reorderLevel: string;
    suggestedOrderQty: string; alertLevel: string; severity: string;
  }[];
  recentMovements: {
    id: string; movementNo: string; movementType: string; baseQty: string; occurredAt: string;
    rawMaterial: { materialCode: string; name: string; baseUom: string };
    sourceLocation: { code: string; kind: string };
    destinationLocation: { code: string; kind: string };
  }[];
  receiptsAwaitingInspection: {
    id: string; grnNo: string; receiptDate: string;
    supplier: { name: string }; _count: { lines: number };
  }[];
  buildStatus: { built: number; partial: number; planned: number; total: number };
}

export default function DashboardPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardSummary>('/dashboard/summary'),
    refetchInterval: 60_000,
  });

  if (isLoading) return <LoadingBlock label="Loading dashboard" />;
  if (error) return <ErrorPanel error={error} onRetry={() => void refetch()} />;
  if (!data) return null;

  const alertTotal =
    data.inventory.outOfStockCount + data.inventory.belowMinimumCount + data.inventory.atReorderLevelCount;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard"
        description={
          <>
            Live figures as of {fmtDateTime(data.generatedAt)}. Every number here is an aggregate over
            real records.
          </>
        }
      />

      {/* --- raw material inventory ----------------------------------------- */}
      <section>
        <SectionTitle>Raw material inventory</SectionTitle>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Stat
            label="Stock value"
            value={fmtMoneyCompact(data.inventory.rawMaterialStockValue)}
            hint="Owned stock at lot cost"
            icon={Warehouse}
            href="/inventory/stock"
          />
          <Stat
            label="Issuable rolls"
            value={fmtInt(data.inventory.issuableFabricRolls)}
            hint={`${fmtQty(data.inventory.fabricMetresOnHand)} m on hand`}
            icon={Scroll}
            href="/materials/rolls"
          />
          <Stat
            label="Out of stock"
            value={fmtInt(data.inventory.outOfStockCount)}
            hint="Active materials with nothing available"
            tone={data.inventory.outOfStockCount > 0 ? 'danger' : 'ok'}
            icon={TriangleAlert}
            href="/intelligence/alerts"
          />
          <Stat
            label="Below minimum"
            value={fmtInt(data.inventory.belowMinimumCount)}
            hint="Under the configured minimum stock"
            tone={data.inventory.belowMinimumCount > 0 ? 'warn' : 'ok'}
            href="/intelligence/alerts"
          />
          <Stat
            label="Movements today"
            value={fmtInt(data.inventory.movementsToday)}
            hint="Ledger entries since midnight"
            icon={Clock}
            href="/inventory/movements"
          />
        </div>
      </section>

      {/* --- purchasing ----------------------------------------------------- */}
      <section>
        <SectionTitle>Purchasing</SectionTitle>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat
            label="Open orders"
            value={fmtInt(data.purchasing.openPurchaseOrders)}
            hint="Approved or partially received"
            icon={FileCheck2}
            href="/purchasing/orders?status=APPROVED"
          />
          <Stat
            label="Awaiting approval"
            value={fmtInt(data.purchasing.awaitingApproval)}
            tone={data.purchasing.awaitingApproval > 0 ? 'warn' : undefined}
            hint="Blocked until someone decides"
            href="/purchasing/approvals"
          />
          <Stat
            label="Overdue"
            value={fmtInt(data.purchasing.overdue)}
            tone={data.purchasing.overdue > 0 ? 'danger' : 'ok'}
            hint="Past the expected delivery date"
            href="/purchasing/orders?overdueOnly=true"
          />
          <Stat
            label="Pending inspection"
            value={fmtInt(data.purchasing.receiptsPendingInspection)}
            tone={data.purchasing.receiptsPendingInspection > 0 ? 'warn' : undefined}
            hint="Received but not yet usable"
            icon={PackageCheck}
            href="/purchasing/receipts?status=PENDING_INSPECTION"
          />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* --- stock alerts ------------------------------------------------- */}
        <Card>
          <CardHeader
            title="Stock alerts"
            description={alertTotal > 0 ? `${alertTotal} materials need attention` : 'Nothing below its thresholds'}
            actions={
              <Link
                href="/intelligence/alerts"
                className="inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline"
              >
                All alerts <ArrowRight className="size-3" />
              </Link>
            }
          />
          {data.topAlerts.length === 0 ? (
            <CardBody className="text-[12.5px] text-ink-muted">
              Every active material is above its reorder level.
            </CardBody>
          ) : (
            <div className="scroll-x">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-line bg-surface-muted text-[11px] uppercase tracking-wide text-ink-muted">
                    <th className="px-3 py-1.5 text-left font-semibold">Material</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Available</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Reorder at</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Suggest</th>
                    <th className="px-3 py-1.5 text-left font-semibold">Level</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topAlerts.map((a) => (
                    <tr key={a.rawMaterialId} className="border-b border-line last:border-0">
                      <td className="px-3 py-1.5">
                        <Link href={`/materials/${a.rawMaterialId}`} className="hover:underline">
                          <span className="font-mono text-[11.5px]">{a.materialCode}</span>
                          <span className="ml-2 text-ink-muted">{a.materialName}</span>
                        </Link>
                      </td>
                      <td className="num px-3 py-1.5 text-right font-medium">
                        {fmtQty(a.availableQty)} {uomShort(a.baseUom)}
                      </td>
                      <td className="num px-3 py-1.5 text-right text-ink-muted">{fmtQty(a.reorderLevel)}</td>
                      <td className="num px-3 py-1.5 text-right">{fmtQty(a.suggestedOrderQty, 0)}</td>
                      <td className="px-3 py-1.5">
                        <StatusBadge status={a.alertLevel} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* --- recent ledger activity --------------------------------------- */}
        <Card>
          <CardHeader
            title="Recent stock movements"
            description="The immutable ledger, newest first"
            actions={
              <Link
                href="/inventory/movements"
                className="inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline"
              >
                Full ledger <ArrowRight className="size-3" />
              </Link>
            }
          />
          {data.recentMovements.length === 0 ? (
            <CardBody className="text-[12.5px] text-ink-muted">
              No stock has moved yet. Receive a purchase order to create the first ledger entries.
            </CardBody>
          ) : (
            <ul className="divide-y divide-line">
              {data.recentMovements.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-3 py-1.5">
                  <Badge tone="outline" className="shrink-0">
                    {humanise(m.movementType)}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">
                    <span className="font-mono text-[11.5px]">{m.rawMaterial.materialCode}</span>
                    <span className="ml-1.5 text-ink-muted">
                      {m.sourceLocation.code} <ArrowRight className="inline size-3" /> {m.destinationLocation.code}
                    </span>
                  </span>
                  <span className="num shrink-0 text-[12.5px] font-medium">
                    {fmtQty(m.baseQty)} {uomShort(m.rawMaterial.baseUom)}
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-subtle">{fmtRelative(m.occurredAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* --- awaiting inspection ------------------------------------------- */}
      {data.receiptsAwaitingInspection.length > 0 ? (
        <Card>
          <CardHeader
            title="Deliveries awaiting inspection"
            description="This stock is owned but cannot be issued to production until it is inspected"
          />
          <ul className="divide-y divide-line">
            {data.receiptsAwaitingInspection.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                <Link href={`/purchasing/receipts/${r.id}`} className="font-mono text-[12px] hover:underline">
                  {r.grnNo}
                </Link>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-muted">{r.supplier.name}</span>
                <span className="num text-[12px] text-ink-muted">{r._count.lines} lines</span>
                <span className="text-[11.5px] text-ink-subtle">{fmtRelative(r.receiptDate)}</span>
                <StatusBadge status="PENDING_INSPECTION" />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* --- honest reporting of what is not built yet ---------------------- */}
      <section>
        <SectionTitle>Not built yet</SectionTitle>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {([
            ['Production', data.production],
            ['Orders & demand', data.demand],
            ['Finished goods', data.finishedGoods],
          ] as const).map(([label, section]) => (
            <div key={label} className="rounded-lg border border-dashed border-line-strong bg-surface-muted px-3.5 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12.5px] font-medium text-ink">{label}</p>
                <Badge tone="outline">Phase {section.phase}</Badge>
              </div>
              <p className="mt-1 text-[11.5px] text-ink-muted">{section.note}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] text-ink-subtle">
          {data.buildStatus.built} of {data.buildStatus.total} screens are implemented,{' '}
          {data.buildStatus.partial} partially. Unbuilt modules are shown disabled in the sidebar rather
          than linking to empty pages.
        </p>
      </section>

      {/* --- master data --------------------------------------------------- */}
      <section>
        <SectionTitle>Master data</SectionTitle>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          {([
            ['Raw materials', data.masterData.rawMaterials, '/materials', Boxes],
            ['Active', data.masterData.activeRawMaterials, '/materials?status=ACTIVE', undefined],
            ['Styles', data.masterData.products, '/admin/products', undefined],
            ['SKUs', data.masterData.skus, '/admin/products', undefined],
            ['Suppliers', data.masterData.suppliers, '/purchasing/suppliers', undefined],
            ['Locations', data.masterData.stockLocations, '/admin/locations', undefined],
            ['Material lots', data.masterData.materialLots, '/materials/lots', undefined],
          ] as const).map(([label, value, href, icon]) => (
            <Stat key={label} label={label} value={fmtInt(value)} href={href} icon={icon} />
          ))}
        </div>
      </section>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-[11.5px] font-semibold uppercase tracking-wider text-ink-subtle">{children}</h2>
  );
}
