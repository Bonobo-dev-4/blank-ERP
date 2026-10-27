'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import {
  ArrowDownToLine, ArrowLeftRight, ArrowRight, ArrowRightFromLine, ArrowUpDown, BadgeCheck,
  Boxes, CalendarRange, CircleCheck, ClipboardList, Clock, Factory, FileCheck2, Hourglass, Layers,
  PackageCheck, PlayCircle, Scroll, Search, ShieldCheck, ShieldX, SlidersHorizontal, Trash2,
  TriangleAlert, Truck, Undo2, Wallet,
} from 'lucide-react';
import { api } from '@/lib/api';
import {
  cn, fmtDateTime, fmtInt, fmtMoneyCompact, fmtQty, fmtRelative, humanise, uomShort,
} from '@/lib/utils';
import {
  type Accent, Button, Card, ErrorPanel, InfoHint, Input, LoadingBlock, NativeSelect, Stat, StatusBadge,
} from '@/components/ui/primitives';
import { ProductionLine, type LineStage } from '@/components/app/production-line';
import {
  accentVar, CategoryBars, Donut, SegmentBar, stageAccent, TrendChart,
} from '@/components/ui/charts';
import { useAuth } from '@/components/app/auth-context';

/* ------------------------------------------------------------------ types */

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
    overdue: number; receiptsPendingInspection: number; byStatus: Record<string, number>;
  };
  production:
    | { available: false; phase: number; note: string }
    | {
        available: true;
        orders: {
          total: number; byStatus: Record<string, number>;
          orderedQty: string; releasedQty: string; completedQty: string; rejectedQty: string;
          overdue: number;
        };
        line: LineStage[];
        activeStages: number;
        wipTotal: string;
      };
  topAlerts: AlertRow[];
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

interface AlertRow {
  rawMaterialId: string; materialCode: string; materialName: string; baseUom: string;
  availableQty: string; minimumStock: string; reorderLevel: string;
  suggestedOrderQty: string; alertLevel: string; severity: string;
}

interface TrendsResponse {
  timeZone: string;
  hasProductionHistory: boolean;
  hasMovementHistory: boolean;
  days: { date: string; released: string; completed: string; rejected: string; movements: number }[];
}

type TrendRange = { days: 7 | 30 | 90 } | { from: string; to: string };

const trendKey = (r: TrendRange) => ('days' in r ? `days=${r.days}` : `from=${r.from}&to=${r.to}`);

function useTrends(range: TrendRange) {
  return useQuery({
    queryKey: ['dashboard-trends', trendKey(range)],
    queryFn: () => api.get<TrendsResponse>(`/dashboard/trends?${trendKey(range)}`),
    staleTime: 60_000,
  });
}

const dayLabel = (d: string) => {
  try { return format(parseISO(d), 'd MMM'); } catch { return d; }
};

/* ------------------------------------------------------------------- page */

export default function DashboardPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardSummary>('/dashboard/summary'),
    refetchInterval: 60_000,
  });
  // 30 days feeds the KPI sparklines and the stock-movement trend.
  const month = useTrends({ days: 30 });

  if (isLoading) return <LoadingBlock label="Loading the manufacturing overview" />;
  if (error) return <ErrorPanel error={error} onRetry={() => void refetch()} />;
  if (!data) return null;

  const prod = data.production.available ? data.production : null;
  const line = prod?.line ?? [];
  const working = line.filter((s) => s.hasActivity);
  const lastStage = (working.length ? working : line).at(-1);
  const rejectedTotal = line.reduce((n, s) => n + Number(s.rejectedQty), 0);

  const series = (k: 'released' | 'completed' | 'rejected') =>
    month.data?.hasProductionHistory ? month.data.days.map((d) => Number(d[k])) : undefined;

  return (
    <div className="mx-auto max-w-[1680px] space-y-4 lg:space-y-5">
      {/* --- heading ------------------------------------------------------ */}
      <header className="flex flex-col gap-3 pt-1 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-subtle">DASH AND DOT</p>
          <h1 className="text-[32px] font-semibold leading-tight tracking-tight text-ink lg:text-[38px]">
            Manufacturing overview
          </h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ink-muted">
            <span className="size-2 rounded-full bg-ok" aria-hidden="true" />
            Live as of {fmtDateTime(data.generatedAt)} · refreshes every minute
          </p>
        </div>
      </header>

      {/* --- KPI row ------------------------------------------------------ */}
      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6 lg:gap-4">
        <Stat
          label="On the floor"
          value={fmtInt(Math.round(Number(prod?.wipTotal ?? 0)))}
          hint={prod ? `${prod.activeStages} stages holding work` : 'Production not configured'}
          icon={Factory}
          accent="stitching"
          info="Garments taken into a stage and not yet handed on, rejected or out for rework — counted once, at the stage each has reached."
          href="/manufacturing"
        />
        <Stat
          label="Released"
          value={fmtInt(Math.round(Number(prod?.orders.releasedQty ?? 0)))}
          hint={`of ${fmtInt(Math.round(Number(prod?.orders.orderedQty ?? 0)))} ordered`}
          icon={PlayCircle}
          accent="release"
          info="Quantity released to the first production stage across active manufacturing orders. The trend is daily releases over 30 days."
          sparkline={series('released')}
          href="/manufacturing"
        />
        <Stat
          label="Completed"
          value={fmtInt(Math.round(Number(lastStage?.completedQty ?? 0)))}
          hint={lastStage ? `Finished ${lastStage.name}` : 'No stages yet'}
          icon={CircleCheck}
          accent="completed"
          info="Garments completed at the last stage of the line — work that has been all the way through."
        />
        <Stat
          label="Rejected"
          value={fmtInt(Math.round(rejectedTotal))}
          hint="Lost to rejection, all stages"
          icon={TriangleAlert}
          accent="rejected"
          tone={rejectedTotal > 0 ? 'danger' : undefined}
          info="Garments rejected at any stage. A rejected garment leaves the line, so this does sum across stages. The trend is daily rejections."
          sparkline={series('rejected')}
          href="/quality"
        />
        <Stat
          label="Pending inspection"
          value={fmtInt(data.purchasing.receiptsPendingInspection)}
          hint="Deliveries not yet usable"
          icon={ShieldCheck}
          accent="qc"
          tone={data.purchasing.receiptsPendingInspection > 0 ? 'warn' : undefined}
          info="Goods receipts received but not yet inspected. The stock is owned but cannot be issued to production until it passes."
          href="/purchasing/receipts?status=PENDING_INSPECTION"
        />
        <Stat
          label="Stock value"
          value={fmtMoneyCompact(data.inventory.rawMaterialStockValue)}
          hint="Raw material at lot cost"
          icon={Wallet}
          accent="inventory"
          info="Owned raw-material stock valued at each lot's unit cost, across physical, floor, job-worker, hold and in-transit locations."
          href="/inventory/stock"
        />
      </section>

      {/* --- production flow ---------------------------------------------- */}
      {prod ? (
        <ProductionLine stages={line} wipTotal={prod.wipTotal} activeStages={prod.activeStages} />
      ) : null}

      {/* --- trends + order distribution ---------------------------------- */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <ProductionTrends className="xl:col-span-8" />
        {prod ? <OrderDistribution className="xl:col-span-4" byStatus={prod.orders.byStatus} total={prod.orders.total} /> : null}
      </div>

      {/* --- stage workload + inventory health ---------------------------- */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {working.length > 0 ? (
          <Card className="xl:col-span-5">
            <PanelHeader
              title="Work taken in, by stage"
              description="Garments each stage has received. Per stage — never summed."
              icon={Layers}
            />
            <div className="px-3 pb-4 sm:px-5">
              <CategoryBars
                unit="garments"
                height={248}
                data={working.map((s, i) => ({
                  label: s.name.replace(/^Production\s+/i, ''),
                  value: Number(s.receivedQty),
                  accent: stageAccent(s.name, s.code, i),
                }))}
              />
            </div>
          </Card>
        ) : null}
        <InventoryHealth
          className={working.length > 0 ? 'xl:col-span-7' : 'xl:col-span-12'}
          inventory={data.inventory}
          activeMaterials={data.masterData.activeRawMaterials}
          trends={month.data}
          trendsLoading={month.isLoading}
        />
      </div>

      {/* --- purchasing + attention ---------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <PurchasingOverview className="xl:col-span-5" purchasing={data.purchasing} />
        <RequiresAttention className="xl:col-span-7" data={data} rejected={rejectedTotal} />
      </div>

      {/* --- alerts + movements -------------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <StockAlerts className="xl:col-span-7" fallback={data.topAlerts} />
        <MovementTimeline className="xl:col-span-5" movements={data.recentMovements} />
      </div>

      {/* --- master data, compact ------------------------------------------ */}
      <section aria-label="Master data" className="glass rounded-2xl px-4 py-3">
        <ul className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
          <li className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">Master data</li>
          {([
            ['Raw materials', data.masterData.rawMaterials, '/materials'],
            ['Active', data.masterData.activeRawMaterials, '/materials?status=ACTIVE'],
            ['Styles', data.masterData.products, '/admin/products'],
            ['SKUs', data.masterData.skus, '/admin/products'],
            ['Suppliers', data.masterData.suppliers, '/purchasing/suppliers'],
            ['Locations', data.masterData.stockLocations, '/admin/locations'],
            ['Material lots', data.masterData.materialLots, '/materials/lots'],
          ] as const).map(([label, value, href]) => (
            <li key={label}>
              <Link href={href} className="group inline-flex items-baseline gap-1.5">
                <span className="num font-semibold text-ink">{fmtInt(value)}</span>
                <span className="text-ink-muted group-hover:text-ink group-hover:underline">{label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------- panel header */

function PanelHeader({
  title, description, icon: Icon, actions, info,
}: {
  title: string;
  description?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  actions?: React.ReactNode;
  info?: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-4">
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <span className="glass-inset mt-0.5 grid size-9 shrink-0 place-items-center rounded-full">
            <Icon className="size-4 text-ink-muted" />
          </span>
        ) : null}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="text-[16px] font-semibold tracking-tight text-ink">{title}</h2>
            {info ? <InfoHint text={info} /> : null}
          </div>
          {description ? <p className="mt-0.5 text-[12.5px] text-ink-muted">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12.5px] font-medium text-brand transition-colors hover:bg-brand-soft"
    >
      {children} <ArrowRight className="size-3.5" />
    </Link>
  );
}

function CompactEmpty({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-4">
      <Icon className="mt-0.5 size-4 shrink-0 text-ink-subtle" />
      <div>
        <p className="text-[13px] font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-[12.5px] text-ink-muted">{children}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------ production trends */

function ProductionTrends({ className }: { className?: string }) {
  const [range, setRange] = React.useState<TrendRange>({ days: 30 });
  const [custom, setCustom] = React.useState<{ from: string; to: string }>(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 13 * 86_400_000);
    return { from: format(from, 'yyyy-MM-dd'), to: format(to, 'yyyy-MM-dd') };
  });
  const [showCustom, setShowCustom] = React.useState(false);
  const { data, isLoading, error, refetch } = useTrends(range);

  const rows = React.useMemo(
    () => (data?.days ?? []).map((d) => ({
      date: d.date, released: Number(d.released), completed: Number(d.completed), rejected: Number(d.rejected),
    })),
    [data],
  );

  const totals = rows.reduce(
    (t, r) => ({ released: t.released + r.released, completed: t.completed + r.completed, rejected: t.rejected + r.rejected }),
    { released: 0, completed: 0, rejected: 0 },
  );

  const presets: (7 | 30 | 90)[] = [7, 30, 90];
  const active = 'days' in range ? range.days : 'custom';

  return (
    <Card className={className}>
      <PanelHeader
        title="Production trends"
        description="Daily, from the stage ledger. “Stage work completed” counts completions at every stage — throughput, not finished garments."
        icon={CalendarRange}
        actions={
          <div role="group" aria-label="Date range" className="glass-raised inline-flex rounded-full p-0.5">
            {presets.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={active === d}
                onClick={() => { setRange({ days: d }); setShowCustom(false); }}
                className={cn(
                  'rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors',
                  active === d ? 'bg-ink text-canvas' : 'text-ink-muted hover:text-ink',
                )}
              >
                {d} days
              </button>
            ))}
            <button
              type="button"
              aria-pressed={active === 'custom'}
              aria-expanded={showCustom}
              onClick={() => setShowCustom((s) => !s)}
              className={cn(
                'rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors',
                active === 'custom' ? 'bg-ink text-canvas' : 'text-ink-muted hover:text-ink',
              )}
            >
              Custom
            </button>
          </div>
        }
      />

      {showCustom ? (
        <form
          className="mx-5 mb-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); setRange({ from: custom.from, to: custom.to }); }}
        >
          <label className="text-[12px] text-ink-muted">
            From
            <Input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className="mt-1 w-[160px]" />
          </label>
          <label className="text-[12px] text-ink-muted">
            To
            <Input type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className="mt-1 w-[160px]" />
          </label>
          <Button type="submit" size="md" variant="primary">Apply</Button>
          <span className="pb-2 text-[11.5px] text-ink-subtle">Up to 90 days.</span>
        </form>
      ) : null}

      <div className="px-3 pb-4 sm:px-5">
        {isLoading ? (
          <div className="h-[300px] animate-pulse rounded-2xl bg-surface-muted" aria-label="Loading trends" />
        ) : error ? (
          <ErrorPanel error={error} onRetry={() => void refetch()} />
        ) : !data?.hasProductionHistory ? (
          <CompactEmpty icon={CalendarRange} title="No production movements in this window">
            Releases, stage completions and rejections appear here as they are recorded on the floor. Try a wider range.
          </CompactEmpty>
        ) : (
          <>
            <dl className="mb-3 grid grid-cols-3 gap-2">
              {([
                ['Released', totals.released, 'release'],
                ['Stage work completed', totals.completed, 'completed'],
                ['Rejected', totals.rejected, 'rejected'],
              ] as const).map(([label, value, accent]) => (
                <div key={label} className="glass-inset rounded-xl px-3 py-2">
                  <dt className="flex items-center gap-1.5 text-[11.5px] text-ink-subtle">
                    <span className="size-2 rounded-full" style={{ background: accentVar(accent) }} />
                    {label}
                  </dt>
                  <dd className="num text-[18px] font-semibold text-ink">{fmtInt(Math.round(value))}</dd>
                </div>
              ))}
            </dl>
            <TrendChart
              data={rows}
              unit="garments"
              height={248}
              xFormatter={dayLabel}
              series={[
                { key: 'released', label: 'Released', accent: 'release' },
                { key: 'completed', label: 'Stage work completed', accent: 'completed' },
                { key: 'rejected', label: 'Rejected', accent: 'rejected' },
              ]}
            />
          </>
        )}
      </div>
    </Card>
  );
}

/* ---------------------------------------------------- order distribution */

const ORDER_GROUPS: { label: string; statuses: string[]; accent: Accent }[] = [
  { label: 'In production', statuses: ['RELEASED', 'IN_PROGRESS'], accent: 'release' },
  { label: 'Pending', statuses: ['DRAFT', 'PENDING_MATERIAL', 'MATERIAL_RESERVED'], accent: 'qc' },
  { label: 'On hold', statuses: ['ON_HOLD'], accent: 'rework' },
  { label: 'Completed', statuses: ['COMPLETED', 'CLOSED'], accent: 'completed' },
  { label: 'Cancelled', statuses: ['CANCELLED'], accent: 'neutral' },
];

function OrderDistribution({
  byStatus, total, className,
}: {
  byStatus: Record<string, number>;
  total: number;
  className?: string;
}) {
  const segments = ORDER_GROUPS.map((g) => ({
    label: g.label,
    accent: g.accent,
    value: g.statuses.reduce((n, s) => n + (byStatus[s] ?? 0), 0),
    href: `/manufacturing?status=${g.statuses[0]}`,
  }));
  return (
    <Card className={className}>
      <PanelHeader
        title="Manufacturing orders"
        description="Every order, by where it stands"
        icon={Factory}
        actions={<PanelLink href="/manufacturing">All orders</PanelLink>}
      />
      <div className="px-5 pb-5">
        {total === 0 ? (
          <CompactEmpty icon={Factory} title="No manufacturing orders yet">
            Orders appear here once created from demand or by hand.
          </CompactEmpty>
        ) : (
          <Donut segments={segments} centerLabel="Orders" unit="orders" className="sm:flex-col 2xl:flex-row" />
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------- inventory health */

function InventoryHealth({
  inventory, activeMaterials, trends, trendsLoading, className,
}: {
  inventory: DashboardSummary['inventory'];
  activeMaterials: number;
  trends?: TrendsResponse;
  trendsLoading: boolean;
  className?: string;
}) {
  const flagged = inventory.outOfStockCount + inventory.belowMinimumCount + inventory.atReorderLevelCount;
  const healthy = Math.max(0, activeMaterials - flagged);
  const movementRows = (trends?.days ?? []).map((d) => ({ date: d.date, movements: d.movements }));

  const tiles: [string, string, React.ComponentType<{ className?: string }>, string, Accent][] = [
    ['Issuable rolls', fmtInt(inventory.issuableFabricRolls), Scroll, `${fmtQty(inventory.fabricMetresOnHand)} m on hand`, 'cutting'],
    ['Out of stock', fmtInt(inventory.outOfStockCount), TriangleAlert, 'Nothing available', 'rejected'],
    ['Below minimum', fmtInt(inventory.belowMinimumCount), Hourglass, 'Under minimum stock', 'rework'],
    ['Movements today', fmtInt(inventory.movementsToday), ArrowLeftRight, 'Ledger entries', 'inventory'],
  ];

  return (
    <Card className={className}>
      <PanelHeader
        title="Raw material inventory"
        description="Stock health across active materials, and how much stock is moving"
        icon={Boxes}
        actions={<PanelLink href="/inventory/stock">Stock</PanelLink>}
      />
      <div className="space-y-4 px-5 pb-5">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {tiles.map(([label, value, Icon, hint, accent]) => {
            const alert = (accent === 'rejected' || accent === 'rework') && value !== '0';
            return (
              <div key={label} className="glass-inset rounded-2xl px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span
                    className="grid size-7 place-items-center rounded-full"
                    style={{ color: accentVar(accent), background: `color-mix(in srgb, ${accentVar(accent)} 16%, transparent)` }}
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <span className="truncate text-[11.5px] font-semibold uppercase tracking-[0.05em] text-ink-subtle">{label}</span>
                </div>
                <p
                  className="num mt-1.5 text-[22px] font-semibold leading-none"
                  style={{ color: alert ? `var(--color-${accent === 'rejected' ? 'danger' : 'hold'})` : 'var(--color-ink)' }}
                >
                  {value}
                </p>
                <p className="mt-1 truncate text-[11.5px] text-ink-muted">{hint}</p>
              </div>
            );
          })}
        </div>

        <div>
          <p className="mb-2 text-[12.5px] font-semibold text-ink">Stock status · {fmtInt(activeMaterials)} active materials</p>
          <SegmentBar
            segments={[
              { label: 'Healthy', value: healthy, accent: 'completed' },
              { label: 'At reorder level', value: inventory.atReorderLevelCount, accent: 'qc', href: '/intelligence/alerts' },
              { label: 'Below minimum', value: inventory.belowMinimumCount, accent: 'rework', href: '/intelligence/alerts' },
              { label: 'Out of stock', value: inventory.outOfStockCount, accent: 'rejected', href: '/intelligence/alerts' },
            ]}
          />
        </div>

        <div>
          <p className="mb-1 text-[12.5px] font-semibold text-ink">Stock movements · last 30 days</p>
          {trendsLoading ? (
            <div className="h-[150px] animate-pulse rounded-2xl bg-surface-muted" />
          ) : !trends?.hasMovementHistory ? (
            <CompactEmpty icon={ArrowLeftRight} title="No stock movements in the last 30 days">
              Receipts, issues and consumption appear here as they post to the ledger.
            </CompactEmpty>
          ) : (
            <TrendChart
              data={movementRows}
              unit="entries"
              height={150}
              xFormatter={dayLabel}
              series={[{ key: 'movements', label: 'Ledger entries', accent: 'inventory' }]}
            />
          )}
        </div>
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- purchasing */

const PO_STATUSES: { status: string; label: string; accent: Accent }[] = [
  { status: 'DRAFT', label: 'Draft', accent: 'neutral' },
  { status: 'PENDING_APPROVAL', label: 'Awaiting approval', accent: 'qc' },
  { status: 'APPROVED', label: 'Approved', accent: 'purchasing' },
  { status: 'PARTIALLY_RECEIVED', label: 'Part received', accent: 'issue' },
  { status: 'RECEIVED', label: 'Received', accent: 'completed' },
  { status: 'CLOSED', label: 'Closed', accent: 'neutral' },
  { status: 'CANCELLED', label: 'Cancelled', accent: 'rejected' },
];

function PurchasingOverview({
  purchasing, className,
}: {
  purchasing: DashboardSummary['purchasing'];
  className?: string;
}) {
  const bars = PO_STATUSES
    .map((p) => ({ label: p.label, value: purchasing.byStatus?.[p.status] ?? 0, accent: p.accent }))
    .filter((b) => b.value > 0);

  const tiles: [string, number, string, Accent, boolean][] = [
    ['Open orders', purchasing.openPurchaseOrders, '/purchasing/orders?status=APPROVED', 'purchasing', false],
    ['Awaiting approval', purchasing.awaitingApproval, '/purchasing/approvals', 'qc', purchasing.awaitingApproval > 0],
    ['Overdue', purchasing.overdue, '/purchasing/orders?overdueOnly=true', 'delayed', purchasing.overdue > 0],
    ['Pending inspection', purchasing.receiptsPendingInspection, '/purchasing/receipts?status=PENDING_INSPECTION', 'qc', purchasing.receiptsPendingInspection > 0],
  ];

  return (
    <Card className={className}>
      <PanelHeader
        title="Purchasing"
        description="Purchase orders by status"
        icon={ClipboardList}
        actions={<PanelLink href="/purchasing/orders">Orders</PanelLink>}
      />
      <div className="space-y-4 px-5 pb-5">
        <div className="grid grid-cols-2 gap-2">
          {tiles.map(([label, value, href, accent, alert]) => (
            <Link
              key={label}
              href={href}
              className="glass-inset group flex items-center justify-between gap-2 rounded-2xl px-3 py-2.5 transition-colors hover:bg-[var(--glass-surface-hover)]"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="size-2 shrink-0 rounded-full" style={{ background: accentVar(accent) }} />
                <span className="truncate text-[12.5px] text-ink-muted group-hover:text-ink">{label}</span>
              </span>
              <span
                className="num text-[20px] font-semibold leading-none"
                style={{ color: alert ? (accent === 'delayed' ? 'var(--color-danger)' : 'var(--color-warn)') : 'var(--color-ink)' }}
              >
                {fmtInt(value)}
              </span>
            </Link>
          ))}
        </div>
        {bars.length === 0 ? (
          <CompactEmpty icon={FileCheck2} title="No purchase orders yet">
            Raise a purchase request to start the purchasing flow.
          </CompactEmpty>
        ) : (
          <CategoryBars data={bars} unit="orders" layout="horizontal-bars" height={Math.max(120, bars.length * 40)} />
        )}
      </div>
    </Card>
  );
}

/* --------------------------------------------------------- requires attention */

function RequiresAttention({
  data, rejected, className,
}: {
  data: DashboardSummary;
  rejected: number;
  className?: string;
}) {
  const prod = data.production.available ? data.production : null;
  const blocked = (prod?.orders.byStatus.ON_HOLD ?? 0) + (prod?.orders.byStatus.PENDING_MATERIAL ?? 0);

  const items: {
    key: string; n: number; label: string; detail: string; href: string;
    severity: 'critical' | 'attention'; icon: React.ComponentType<{ className?: string }>; accent: Accent;
  }[] = [
    { key: 'oos', n: data.inventory.outOfStockCount, label: 'Materials out of stock', detail: 'Active materials with nothing available to issue', href: '/intelligence/alerts', severity: 'critical', icon: TriangleAlert, accent: 'rejected' },
    { key: 'po-overdue', n: data.purchasing.overdue, label: 'Overdue purchase orders', detail: 'Past their expected delivery date', href: '/purchasing/orders?overdueOnly=true', severity: 'critical', icon: Truck, accent: 'delayed' },
    { key: 'mo-overdue', n: prod?.orders.overdue ?? 0, label: 'Overdue production', detail: 'Manufacturing orders past their due date', href: '/manufacturing', severity: 'critical', icon: Clock, accent: 'delayed' },
    { key: 'blocked', n: blocked, label: 'Blocked orders', detail: 'On hold or waiting for material', href: '/manufacturing', severity: 'attention', icon: Hourglass, accent: 'hold' },
    { key: 'rejected', n: Math.round(rejected), label: 'Rejected garments', detail: 'Lost to rejection across stages', href: '/quality', severity: 'attention', icon: ShieldX, accent: 'rejected' },
    { key: 'below-min', n: data.inventory.belowMinimumCount, label: 'Below minimum stock', detail: 'Under the configured minimum', href: '/intelligence/alerts', severity: 'attention', icon: Boxes, accent: 'rework' },
    { key: 'approval', n: data.purchasing.awaitingApproval, label: 'Awaiting approval', detail: 'Purchase orders blocked until someone decides', href: '/purchasing/approvals', severity: 'attention', icon: BadgeCheck, accent: 'qc' },
    { key: 'inspection', n: data.purchasing.receiptsPendingInspection, label: 'Pending inspection', detail: 'Received, not yet usable', href: '/purchasing/receipts?status=PENDING_INSPECTION', severity: 'attention', icon: PackageCheck, accent: 'qc' },
  ];

  const open = items.filter((i) => i.n > 0);
  const clear = items.filter((i) => i.n === 0);

  return (
    <Card className={cn('overflow-hidden', className)}>
      {/* A thin lit edge in the colour of the most serious item — emphasis
          without an opaque block. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-6 top-0 h-px"
        style={{
          background: `linear-gradient(90deg, transparent, ${accentVar(open.some((i) => i.severity === 'critical') ? 'rejected' : open.length ? 'qc' : 'completed')}, transparent)`,
        }}
      />
      <PanelHeader
        title="Requires attention"
        description={open.length ? `${open.length} things are waiting on someone` : 'Nothing is waiting on anyone right now'}
        icon={TriangleAlert}
      />
      <div className="px-5 pb-5">
        {open.length === 0 ? (
          <CompactEmpty icon={CircleCheck} title="All clear">
            No shortages, overdue orders, rejections or pending inspections.
          </CompactEmpty>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {open.map((i) => {
              const Icon = i.icon;
              return (
                <li key={i.key}>
                  <Link
                    href={i.href}
                    className={cn(
                      'glass-inset group flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-[var(--glass-surface-hover)]',
                      i.severity === 'critical' && 'shadow-[inset_3px_0_0_0_var(--color-danger)]',
                    )}
                  >
                    <span
                      className="grid size-9 shrink-0 place-items-center rounded-full"
                      style={{ color: accentVar(i.accent), background: `color-mix(in srgb, ${accentVar(i.accent)} 16%, transparent)` }}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="num text-[18px] font-semibold leading-none text-ink">{fmtInt(i.n)}</span>
                        <span className="truncate text-[13px] font-medium text-ink">{i.label}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] text-ink-muted">{i.detail}</span>
                    </span>
                    <StatusBadge status={i.severity === 'critical' ? 'CRITICAL' : 'WARNING'} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {clear.length > 0 && open.length > 0 ? (
          <p className="mt-3 flex flex-wrap items-center gap-x-1.5 text-[12px] text-ink-subtle">
            <CircleCheck className="size-3.5" style={{ color: accentVar('completed') }} />
            Clear: {clear.map((c) => c.label.toLowerCase()).join(' · ')}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------- stock alerts */

const LEVELS = [
  { value: 'ALL', label: 'All levels' },
  { value: 'OUT_OF_STOCK', label: 'Out of stock' },
  { value: 'BELOW_MINIMUM', label: 'Below minimum' },
  { value: 'AT_REORDER_LEVEL', label: 'At reorder level' },
];

type SortKey = 'material' | 'available' | 'reorder' | 'suggest';

function StockAlerts({ fallback, className }: { fallback: AlertRow[]; className?: string }) {
  const { can } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['inventory-alerts'],
    queryFn: () => api.get<{ alerts: AlertRow[] }>('/inventory/alerts'),
    enabled: can('inventory.read'),
    staleTime: 30_000,
  });
  const all = data?.alerts ?? fallback;

  const [q, setQ] = React.useState('');
  const [level, setLevel] = React.useState('ALL');
  const [sort, setSort] = React.useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'available', dir: 1 });
  const [page, setPage] = React.useState(1);
  const pageSize = 6;

  const rows = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = all.filter(
      (a) =>
        (level === 'ALL' || a.alertLevel === level) &&
        (!needle || a.materialCode.toLowerCase().includes(needle) || a.materialName.toLowerCase().includes(needle)),
    );
    const val = (a: AlertRow) =>
      sort.key === 'material' ? a.materialCode
      : sort.key === 'available' ? Number(a.availableQty)
      : sort.key === 'reorder' ? Number(a.reorderLevel)
      : Number(a.suggestedOrderQty);
    return [...filtered].sort((a, b) => {
      const x = val(a); const y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [all, q, level, sort]);

  React.useEffect(() => { setPage(1); }, [q, level]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const visible = rows.slice((page - 1) * pageSize, page * pageSize);

  const header = (key: SortKey, label: string, right?: boolean) => (
    <th scope="col" className={cn('px-3 py-2.5 font-semibold', right ? 'text-right' : 'text-left')}>
      <button
        type="button"
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}
        className={cn('inline-flex items-center gap-1 uppercase tracking-[0.06em] hover:text-ink', sort.key === key && 'text-ink')}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <ArrowUpDown className="size-3" />
      </button>
    </th>
  );

  return (
    <Card className={className}>
      <PanelHeader
        title="Stock alerts"
        description={`${all.length} materials below a threshold`}
        icon={TriangleAlert}
        actions={<PanelLink href="/intelligence/alerts">All alerts</PanelLink>}
      />
      <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code or name" aria-label="Search stock alerts" className="pl-9" />
        </div>
        <NativeSelect value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Filter by level" className="w-auto min-w-[150px]">
          {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </NativeSelect>
      </div>

      {isLoading && !fallback.length ? (
        <LoadingBlock label="Loading alerts" />
      ) : rows.length === 0 ? (
        <div className="px-5 pb-5">
          <CompactEmpty icon={CircleCheck} title={all.length ? 'No alerts match' : 'Every material is above its thresholds'}>
            {all.length ? 'Clear the search or choose another level.' : 'Nothing is at or below its reorder level.'}
          </CompactEmpty>
        </div>
      ) : (
        <>
          <div className="scroll-x border-y border-line">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead className="bg-surface-muted text-[11.5px] text-ink-subtle">
                <tr>
                  {header('material', 'Material')}
                  {header('available', 'Available', true)}
                  {header('reorder', 'Reorder at', true)}
                  {header('suggest', 'Suggest', true)}
                  <th scope="col" className="px-3 py-2.5 text-left font-semibold uppercase tracking-[0.06em]">Level</th>
                  <th scope="col" className="px-3 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => (
                  <tr
                    key={a.rawMaterialId}
                    className={cn(
                      'border-b border-line transition-colors last:border-0 hover:bg-surface-muted',
                      a.alertLevel === 'OUT_OF_STOCK' && 'row-flag',
                    )}
                  >
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-[12px] text-ink">{a.materialCode}</span>
                      <span className="ml-2 text-ink-muted">{a.materialName}</span>
                    </td>
                    <td className="num px-3 py-2.5 text-right font-semibold text-ink">
                      {fmtQty(a.availableQty)} <span className="font-normal text-ink-subtle">{uomShort(a.baseUom)}</span>
                    </td>
                    <td className="num px-3 py-2.5 text-right text-ink-muted">{fmtQty(a.reorderLevel)}</td>
                    <td className="num px-3 py-2.5 text-right text-ink">{fmtQty(a.suggestedOrderQty, 0)}</td>
                    <td className="px-3 py-2.5"><StatusBadge status={a.alertLevel} /></td>
                    <td className="px-3 py-2.5 text-right">
                      <Link
                        href={`/materials/${a.rawMaterialId}`}
                        className="rounded-full px-2.5 py-1 text-[12px] font-medium text-brand hover:bg-brand-soft"
                        aria-label={`View ${a.materialCode}`}
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-2 px-5 py-3 text-[12.5px] text-ink-muted">
            <span className="num">
              {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, rows.length)} of {rows.length}
            </span>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="default" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button size="sm" variant="default" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

/* --------------------------------------------------------- movement timeline */

const MOVEMENT_STYLE: Record<string, { icon: React.ComponentType<{ className?: string }>; accent: Accent }> = {
  OPENING_BALANCE: { icon: Layers, accent: 'neutral' },
  PURCHASE_INWARD: { icon: ArrowDownToLine, accent: 'purchasing' },
  QC_RELEASE: { icon: ShieldCheck, accent: 'completed' },
  QC_REJECT: { icon: ShieldX, accent: 'rejected' },
  SUPPLIER_RETURN: { icon: Undo2, accent: 'neutral' },
  ISSUE_TO_PRODUCTION: { icon: ArrowRightFromLine, accent: 'issue' },
  RETURN_FROM_PRODUCTION: { icon: Undo2, accent: 'release' },
  TRANSFER: { icon: ArrowLeftRight, accent: 'inventory' },
  ISSUE_TO_JOB_WORKER: { icon: ArrowRightFromLine, accent: 'stitching' },
  RETURN_FROM_JOB_WORKER: { icon: Undo2, accent: 'stitching' },
  CONSUMPTION: { icon: Factory, accent: 'cutting' },
  WASTAGE: { icon: Trash2, accent: 'rework' },
  ADJUSTMENT_IN: { icon: SlidersHorizontal, accent: 'neutral' },
  ADJUSTMENT_OUT: { icon: SlidersHorizontal, accent: 'neutral' },
  STOCK_COUNT_GAIN: { icon: SlidersHorizontal, accent: 'finishing' },
  STOCK_COUNT_LOSS: { icon: SlidersHorizontal, accent: 'rework' },
};

function MovementTimeline({
  movements, className,
}: {
  movements: DashboardSummary['recentMovements'];
  className?: string;
}) {
  return (
    <Card className={className}>
      <PanelHeader
        title="Recent stock movements"
        description="The immutable ledger, newest first"
        icon={ArrowLeftRight}
        actions={<PanelLink href="/inventory/movements">Full ledger</PanelLink>}
      />
      <div className="px-5 pb-4">
        {movements.length === 0 ? (
          <CompactEmpty icon={ArrowLeftRight} title="No stock has moved yet">
            Receive a purchase order to create the first ledger entries.
          </CompactEmpty>
        ) : (
          <ol className="relative">
            {movements.slice(0, 8).map((m, i, arr) => {
              const style = MOVEMENT_STYLE[m.movementType] ?? { icon: ArrowLeftRight, accent: 'neutral' as Accent };
              const Icon = style.icon;
              return (
                <li key={m.id} className="relative flex gap-3 pb-3 last:pb-0">
                  {i < arr.length - 1 ? (
                    <span aria-hidden="true" className="absolute left-[15px] top-8 h-[calc(100%-26px)] w-px bg-line" />
                  ) : null}
                  <span
                    className="relative z-10 grid size-8 shrink-0 place-items-center rounded-full border"
                    style={{
                      color: accentVar(style.accent),
                      background: `color-mix(in srgb, ${accentVar(style.accent)} 15%, var(--glass-solid) 60%)`,
                      borderColor: `color-mix(in srgb, ${accentVar(style.accent)} 32%, transparent)`,
                    }}
                    aria-hidden="true"
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-[13px] font-semibold text-ink">{humanise(m.movementType)}</p>
                      <p className="num shrink-0 text-[13px] font-semibold text-ink">
                        {fmtQty(m.baseQty)} <span className="font-normal text-ink-subtle">{uomShort(m.rawMaterial.baseUom)}</span>
                      </p>
                    </div>
                    <p className="truncate text-[12px] text-ink-muted">
                      <span className="font-mono text-ink">{m.rawMaterial.materialCode}</span>
                      <span className="mx-1.5">·</span>
                      {m.sourceLocation.code} <ArrowRight className="inline size-3" /> {m.destinationLocation.code}
                    </p>
                    <p className="text-[11.5px] text-ink-subtle">
                      <span className="font-mono">{m.movementNo}</span> · {fmtRelative(m.occurredAt)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Card>
  );
}
