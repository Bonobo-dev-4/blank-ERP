'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import {
  ArrowDownToLine, ArrowLeftRight, ArrowRight, ArrowRightFromLine, ArrowUpDown, BadgeCheck,
  Boxes, CalendarRange, CircleCheck, ClipboardList, Clock, Factory, FileCheck2, Gauge, Hourglass,
  Layers, PackageCheck, PlayCircle, RefreshCw, Scroll, Search, ShieldCheck, ShieldX,
  SlidersHorizontal, Trash2, TriangleAlert, Truck, Undo2, Wallet,
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
  accentVar, CategoryBars, Donut, RadialProgress, SegmentBar, stageAccent, TrendChart,
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
  quality?: {
    windowDays: number; inspections: number;
    inspectedQty: string; passedQty: string; failedQty: string; reworkQty: string; holdQty: string;
    openReworkOrders: number;
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

/** How a period reads in captions. */
function periodLabel(r: TrendRange): string {
  if ('days' in r) return `last ${r.days} days`;
  try { return `${format(parseISO(r.from), 'd MMM')} – ${format(parseISO(r.to), 'd MMM')}`; } catch { return 'custom range'; }
}

/** The same window as ISO instants, for endpoints that take timestamps. */
function periodInstants(r: TrendRange): { from: string; to: string } {
  if ('days' in r) {
    const from = new Date(Date.now() - (r.days - 1) * 86_400_000);
    from.setHours(0, 0, 0, 0);
    return { from: from.toISOString(), to: new Date().toISOString() };
  }
  return {
    from: new Date(`${r.from}T00:00:00`).toISOString(),
    to: new Date(`${r.to}T23:59:59.999`).toISOString(),
  };
}

const dayLabel = (d: string) => {
  try { return format(parseISO(d), 'd MMM'); } catch { return d; }
};

/** Garments are discrete: whole numbers print whole. */
const garments = (n: number) => fmtInt(Math.round(n));

/* ------------------------------------------------------------------- page */

export default function DashboardPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardSummary>('/dashboard/summary'),
    refetchInterval: 60_000,
  });
  // One period for the whole page: trends, sparklines, stock movements and QC.
  const [period, setPeriod] = React.useState<TrendRange>({ days: 30 });
  const month = useTrends(period);

  if (isLoading) return <LoadingBlock label="Loading the manufacturing overview" />;
  if (error) return <ErrorPanel error={error} onRetry={() => void refetch()} />;
  if (!data) return null;

  const prod = data.production.available ? data.production : null;
  const line = prod?.line ?? [];
  const working = line.filter((s) => s.hasActivity);
  const lastStage = (working.length ? working : line).at(-1);
  const rejectedTotal = line.reduce((n, s) => n + Number(s.rejectedQty), 0);

  const series = (k: 'released' | 'rejected') =>
    month.data?.hasProductionHistory ? month.data.days.map((d) => Number(d[k])) : undefined;

  return (
    <div className="mx-auto max-w-[1680px] space-y-5">
      {/* --- heading ------------------------------------------------------ */}
      <header className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="t-page-title text-ink">Manufacturing Overview</h1>
          <p className="mt-1 text-[13.5px] text-ink-muted">
            Production, inventory and purchasing — live from the floor and the ledger.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
        <PeriodControl value={period} onChange={setPeriod} />
        <p className="glass-subtle inline-flex h-8 shrink-0 items-center gap-2 rounded-lg px-3 text-[12.5px] text-ink-muted">
          <span className="size-1.5 rounded-full bg-ok shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-ok)_22%,transparent)]" aria-hidden="true" />
          <span className="font-medium text-ink">Live</span>
          <span className="num">{fmtDateTime(data.generatedAt)}</span>
        </p>
        </div>
      </header>

      {/* --- KPI row ------------------------------------------------------ */}
      <section aria-label="Key figures" className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="On the floor"
          value={garments(Number(prod?.wipTotal ?? 0))}
          hint={prod ? `garments at ${prod.activeStages} stages` : 'production not configured'}
          icon={Factory}
          accent="stitching"
          info="Garments taken into a stage and not yet handed on, rejected or out for rework — each counted once, at the stage it has reached."
          href="/manufacturing"
        />
        <Stat
          label="Released"
          value={garments(Number(prod?.orders.releasedQty ?? 0))}
          hint={`garments of ${garments(Number(prod?.orders.orderedQty ?? 0))} ordered`}
          icon={PlayCircle}
          accent="release"
          info="Garments released to the first production stage, across active manufacturing orders. The line shows daily releases over the selected period."
          sparkline={series('released')}
          href="/manufacturing"
        />
        <Stat
          label="Completed"
          value={garments(Number(lastStage?.completedQty ?? 0))}
          hint={lastStage ? `garments through ${lastStage.name}` : 'no stages yet'}
          icon={CircleCheck}
          accent="completed"
          info="Garments completed at the LAST stage of the line — work that has been all the way through. This is not finished-goods stock and not completed orders."
        />
        <Stat
          label="Rejected"
          value={garments(rejectedTotal)}
          hint="garments, across all stages"
          icon={TriangleAlert}
          accent="rejected"
          tone={rejectedTotal > 0 ? 'danger' : undefined}
          info="Garments rejected at any stage. A rejected garment leaves the line, so rejections do add up across stages. The line shows daily rejections over the selected period."
          sparkline={series('rejected')}
          href="/quality"
        />
        <Stat
          label="Pending inspection"
          value={fmtInt(data.purchasing.receiptsPendingInspection)}
          hint="deliveries awaiting QC"
          icon={ShieldCheck}
          accent="qc"
          tone={data.purchasing.receiptsPendingInspection > 0 ? 'warn' : undefined}
          info="Goods receipts (deliveries) received but not yet inspected. The stock is owned but cannot be issued to production until it passes."
          href="/purchasing/receipts?status=PENDING_INSPECTION"
        />
        <Stat
          label="Stock value"
          value={fmtMoneyCompact(data.inventory.rawMaterialStockValue)}
          hint="raw material at lot cost"
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
        <ProductionTrends className="xl:col-span-8" range={period} />
        {prod ? (
          <OrderDistribution className="xl:col-span-4" byStatus={prod.orders.byStatus} total={prod.orders.total} />
        ) : null}
      </div>

      {/* --- bottlenecks, quality, purchasing ------------------------------ */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12">
        {prod ? (
          <ProductionBottlenecks className="xl:col-span-4" stages={working} wipTotal={Number(prod.wipTotal)} />
        ) : null}
        <QualityPanel
          range={period}
          className="xl:col-span-4"
          quality={data.quality}
          pendingInspection={data.purchasing.receiptsPendingInspection}
        />
        <PurchasingOverview className="md:col-span-2 xl:col-span-4" purchasing={data.purchasing} />
      </div>

      {/* --- inventory + exceptions ---------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <InventoryHealth
          range={period}
          className="xl:col-span-7"
          inventory={data.inventory}
          activeMaterials={data.masterData.activeRawMaterials}
          trends={month.data}
          trendsLoading={month.isLoading}
        />
        <OperationalExceptions className="xl:col-span-5" data={data} rejected={rejectedTotal} />
      </div>

      {/* --- alerts + movements -------------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <StockAlerts className="xl:col-span-7" fallback={data.topAlerts} />
        <MovementTimeline className="xl:col-span-5" movements={data.recentMovements} range={period} />
      </div>

      {/* --- master data, compact ------------------------------------------ */}
      <section aria-label="Master data" className="glass-subtle rounded-2xl px-5 py-3">
        <ul className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
          <li className="t-micro text-ink-subtle">Master data</li>
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

/* ---------------------------------------------------------- panel pieces */

function PanelHeader({
  title, description, icon: Icon, accent, actions, info,
}: {
  title: string;
  description?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  accent?: Accent;
  actions?: React.ReactNode;
  info?: string;
}) {
  const colour = accent ? accentVar(accent) : undefined;
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-[18px]">
      <div className="flex min-w-0 items-center gap-3">
        {Icon ? (
          <span
            className="grid size-8 shrink-0 place-items-center rounded-full border"
            style={colour ? {
              color: colour,
              background: `color-mix(in srgb, ${colour} 14%, transparent)`,
              borderColor: `color-mix(in srgb, ${colour} 28%, transparent)`,
            } : { color: 'var(--color-ink-muted)', background: 'var(--glass-inset)', borderColor: 'var(--glass-inset-border)' }}
            aria-hidden="true"
          >
            <Icon className="size-4" />
          </span>
        ) : null}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="t-section-title truncate text-ink">{title}</h2>
            {info ? <InfoHint text={info} /> : null}
          </div>
          {description ? <p className="text-[13px] text-ink-subtle">{description}</p> : null}
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
      className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-brand-strong transition-colors hover:bg-brand-soft"
    >
      {children} <ArrowRight className="size-3.5" />
    </Link>
  );
}

function CompactEmpty({
  icon: Icon, title, children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-dashed border-line-strong/60 px-4 py-3.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-ink-subtle" />
      <div>
        <p className="text-[13.5px] font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-[13px] text-ink-muted">{children}</p>
      </div>
    </div>
  );
}

function Segmented<T extends string | number>({
  options, value, onChange, label,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex h-8 items-center gap-0.5 rounded-lg border border-line bg-surface-muted p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-full rounded-md px-2.5 text-[12.5px] font-medium transition-colors',
            value === o.value ? 'glass-raised text-ink' : 'text-ink-subtle hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ period control */

/**
 * The dashboard's one period: 7, 30 or 90 days, or a custom range of up to 90.
 * Everything time-based on the page follows it.
 */
function PeriodControl({ value, onChange }: { value: TrendRange; onChange: (r: TrendRange) => void }) {
  const [open, setOpen] = React.useState(false);
  const [custom, setCustom] = React.useState<{ from: string; to: string }>(() => {
    const to = new Date();
    return { from: format(new Date(to.getTime() - 13 * 86_400_000), 'yyyy-MM-dd'), to: format(to, 'yyyy-MM-dd') };
  });
  const active: 7 | 30 | 90 | 'custom' = 'days' in value ? value.days : 'custom';
  const tooLong = (new Date(custom.to).getTime() - new Date(custom.from).getTime()) / 86_400_000 > 89;

  return (
    <div className="relative">
      <Segmented<7 | 30 | 90 | 'custom'>
        label="Dashboard period"
        value={active}
        onChange={(v) => {
          if (v === 'custom') { setOpen((o) => !o); return; }
          onChange({ days: v }); setOpen(false);
        }}
        options={[
          { value: 7, label: '7D' },
          { value: 30, label: '30D' },
          { value: 90, label: '90D' },
          { value: 'custom', label: active === 'custom' ? periodLabel(value) : 'Custom' },
        ]}
      />
      {open ? (
        <form
          className="glass-floating absolute right-0 top-10 z-30 flex w-[300px] flex-col gap-2.5 rounded-xl p-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (tooLong || custom.from > custom.to) return;
            onChange({ from: custom.from, to: custom.to });
            setOpen(false);
          }}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        >
          <p className="text-[13px] font-medium text-ink">Custom period</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[12.5px] text-ink-muted">
              From
              <Input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className="mt-1" />
            </label>
            <label className="text-[12.5px] text-ink-muted">
              To
              <Input type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className="mt-1" />
            </label>
          </div>
          {tooLong ? <p className="text-[12px] font-medium text-danger">Choose 90 days or fewer.</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" size="sm" disabled={tooLong || custom.from > custom.to}>Apply</Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------ production trends */

function ProductionTrends({ className, range }: { className?: string; range: TrendRange }) {
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

  return (
    <Card material="elevated" className={className}>
      <PanelHeader
        title="Production trends"
        description={`Daily, in garments · ${periodLabel(range)}`}
        icon={CalendarRange}
        accent="release"
        info="“Stage work completed” counts completions at EVERY stage — it measures throughput, not finished garments. Released and rejected count each garment once. The period is set at the top of the page."
      />

      <div className="px-3 pb-5 sm:px-5">
        {isLoading ? (
          <div className="h-[300px] animate-pulse rounded-xl bg-surface-muted" aria-label="Loading trends" />
        ) : error ? (
          <ErrorPanel error={error} onRetry={() => void refetch()} />
        ) : !data?.hasProductionHistory ? (
          <CompactEmpty icon={CalendarRange} title="No production movements in this window">
            Releases, stage completions and rejections appear here as they are recorded on the floor. Try a wider range.
          </CompactEmpty>
        ) : (
          <>
            <dl className="mb-4 grid grid-cols-3 gap-2">
              {([
                ['Released', totals.released, 'release'],
                ['Stage work completed', totals.completed, 'completed'],
                ['Rejected', totals.rejected, 'rejected'],
              ] as const).map(([label, value, accent]) => (
                <div key={label} className="glass-inset rounded-xl px-3.5 py-2.5">
                  <dt className="flex items-center gap-1.5 truncate text-[12.5px] text-ink-subtle">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: accentVar(accent) }} />
                    {label}
                  </dt>
                  <dd className="num mt-0.5 text-[20px] font-semibold tracking-[-0.02em] text-ink">{garments(value)}</dd>
                </div>
              ))}
            </dl>
            <TrendChart
              data={rows}
              unit="garments"
              height={240}
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
  { label: 'On hold', statuses: ['ON_HOLD'], accent: 'hold' },
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
  const segments = ORDER_GROUPS.map((g) => {
    const present = g.statuses.filter((s) => (byStatus[s] ?? 0) > 0);
    return {
      label: g.label,
      accent: g.accent,
      value: g.statuses.reduce((n, s) => n + (byStatus[s] ?? 0), 0),
      // The order list filters by ONE status, so a slice links only when a
      // single status accounts for all of it — otherwise the link would show
      // a different number from the one clicked.
      href: present.length === 1 ? `/manufacturing?status=${present[0]}` : undefined,
    };
  });
  return (
    <Card className={className}>
      <PanelHeader
        title="Manufacturing orders"
        description="Orders, not garments — by where each stands"
        icon={Factory}
        accent="stitching"
        actions={<PanelLink href="/manufacturing">All</PanelLink>}
      />
      <div className="px-5 pb-5">
        {total === 0 ? (
          <CompactEmpty icon={Factory} title="No manufacturing orders yet">
            Orders appear here once created from demand or by hand.
          </CompactEmpty>
        ) : (
          <Donut segments={segments} centerLabel="orders" unit="orders" size={176} className="sm:flex-col 2xl:flex-row" />
        )}
      </div>
    </Card>
  );
}

/* ---------------------------------------------------- production bottlenecks */

function ProductionBottlenecks({
  stages, wipTotal, className,
}: {
  stages: LineStage[];
  wipTotal: number;
  className?: string;
}) {
  const [orderBy, setOrderBy] = React.useState<'waiting' | 'route'>('waiting');
  const holding = stages
    .map((s, i) => ({ ...s, wip: Number(s.wipQty), accent: stageAccent(s.name, s.code, i) }))
    .filter((s) => s.wip > 0);
  // The callout always names the longest queue, whatever the list order.
  const top = [...holding].sort((a, b) => b.wip - a.wip)[0];
  const ranked = orderBy === 'waiting' ? [...holding].sort((a, b) => b.wip - a.wip) : holding;
  const max = top?.wip ?? 1;

  return (
    <Card className={className}>
      <PanelHeader
        title="Bottlenecks"
        description="Where garments are waiting now"
        icon={Gauge}
        accent="qc"
        actions={
          holding.length > 1 ? (
            <Segmented<'waiting' | 'route'>
              label="Sort stages"
              value={orderBy}
              onChange={setOrderBy}
              options={[{ value: 'waiting', label: 'Most waiting' }, { value: 'route', label: 'Route order' }]}
            />
          ) : undefined
        }
        info="Garments sitting at each stage now — taken in, not yet handed on, rejected or out for rework. Each garment is at exactly one stage, so these shares add up to the floor total. The longest queue is usually the constraint."
      />
      <div className="px-5 pb-5">
        {!top ? (
          <CompactEmpty icon={CircleCheck} title="No work is waiting">
            No stage is holding garments right now.
          </CompactEmpty>
        ) : (
          <>
            <p className="mb-4 text-[13.5px] leading-snug text-ink-muted">
              <span className="font-semibold text-ink">{top.name}</span> holds{' '}
              <span className="num font-semibold text-ink">{garments(top.wip)}</span> of{' '}
              <span className="num">{garments(wipTotal)}</span> garments on the floor
              {wipTotal > 0 ? <> ({Math.round((top.wip / wipTotal) * 100)}%)</> : null}.
            </p>
            <ul className="space-y-3">
              {ranked.map((s) => {
                const share = wipTotal > 0 ? Math.round((s.wip / wipTotal) * 100) : 0;
                return (
                  <li key={s.stageId}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px]">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="size-2 shrink-0 rounded-full" style={{ background: accentVar(s.accent) }} />
                        <span className="truncate font-medium text-ink">{s.name}</span>
                      </span>
                      <span className="num shrink-0 text-ink">
                        <span className="font-semibold">{garments(s.wip)}</span>
                        <span className="ml-1.5 text-ink-subtle">{share}%</span>
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
                      <div
                        className="bar-grow h-full rounded-full"
                        style={{
                          width: `${(s.wip / max) * 100}%`,
                          background: `linear-gradient(90deg, color-mix(in srgb, ${accentVar(s.accent)} 65%, transparent), ${accentVar(s.accent)})`,
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
}

/* --------------------------------------------------------- QC and inspection */

function QualityPanel({
  quality: summaryQuality, pendingInspection, range, className,
}: {
  quality?: DashboardSummary['quality'];
  pendingInspection: number;
  range: TrendRange;
  className?: string;
}) {
  const windowed = useQuery({
    queryKey: ['dashboard-quality', trendKey(range)],
    queryFn: () => api.get<NonNullable<DashboardSummary['quality']>>(`/dashboard/quality?${trendKey(range)}`),
    staleTime: 60_000,
  });
  // The summary's 30-day figure stands in only while the 30-day window loads.
  const quality = windowed.data ?? ('days' in range && range.days === 30 ? summaryQuality : undefined);
  const inspected = Number(quality?.inspectedQty ?? 0);
  const passed = Number(quality?.passedQty ?? 0);
  const yieldPct = inspected > 0 ? (passed / inspected) * 100 : 0;

  return (
    <Card className={className}>
      <PanelHeader
        title="QC & inspection"
        description={`Production inspections · ${periodLabel(range)}`}
        icon={ShieldCheck}
        accent="qc"
        actions={<PanelLink href="/quality">QC</PanelLink>}
      />
      <div className="space-y-4 px-5 pb-5">
        {!quality || quality.inspections === 0 ? (
          <CompactEmpty icon={ShieldCheck} title={windowed.isLoading && !quality ? 'Loading inspections…' : `No production inspections in the ${periodLabel(range)}`}>
            Pass, rework and reject results appear here as inspections are recorded.
          </CompactEmpty>
        ) : (
          <div className="flex items-center gap-5">
            <RadialProgress value={yieldPct} accent="completed" label="passed" />
            <dl className="min-w-0 flex-1 space-y-1.5 text-[13px]">
              {([
                ['Passed', quality.passedQty, 'completed'],
                ['Rework', quality.reworkQty, 'rework'],
                ['Failed', quality.failedQty, 'rejected'],
                ['On hold', quality.holdQty, 'hold'],
              ] as const).map(([label, value, accent]) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: accentVar(accent) }} />
                  <dt className="flex-1 text-ink-muted">{label}</dt>
                  <dd className="num font-semibold text-ink">{garments(Number(value))}</dd>
                </div>
              ))}
              <div className="flex items-center gap-2 border-t border-line pt-1.5 text-ink-subtle">
                <dt className="flex-1">{fmtInt(quality.inspections)} inspections</dt>
                <dd className="num">{garments(inspected)} garments</dd>
              </div>
            </dl>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Link href="/quality/rework" className="glass-inset rounded-xl px-3.5 py-2.5 transition-colors hover:bg-[var(--glass-surface-hover)]">
            <p className="flex items-center gap-1.5 text-[12.5px] text-ink-subtle">
              <RefreshCw className="size-3.5" style={{ color: accentVar('rework') }} /> Open rework orders
            </p>
            <p className="num mt-0.5 text-[20px] font-semibold tracking-[-0.02em] text-ink">{fmtInt(quality?.openReworkOrders ?? 0)}</p>
          </Link>
          <Link href="/purchasing/receipts?status=PENDING_INSPECTION" className="glass-inset rounded-xl px-3.5 py-2.5 transition-colors hover:bg-[var(--glass-surface-hover)]">
            <p className="flex items-center gap-1.5 text-[12.5px] text-ink-subtle">
              <PackageCheck className="size-3.5" style={{ color: accentVar('qc') }} /> Deliveries to inspect
            </p>
            <p
              className="num mt-0.5 text-[20px] font-semibold tracking-[-0.02em]"
              style={{ color: pendingInspection > 0 ? 'var(--color-warn)' : 'var(--color-ink)' }}
            >
              {fmtInt(pendingInspection)}
            </p>
          </Link>
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------- inventory health */

function InventoryHealth({
  inventory, activeMaterials, trends, trendsLoading, range, className,
}: {
  range: TrendRange;
  inventory: DashboardSummary['inventory'];
  activeMaterials: number;
  trends?: TrendsResponse;
  trendsLoading: boolean;
  className?: string;
}) {
  const flagged = inventory.outOfStockCount + inventory.belowMinimumCount + inventory.atReorderLevelCount;
  const healthy = Math.max(0, activeMaterials - flagged);
  const movementRows = (trends?.days ?? []).map((d) => ({ date: d.date, movements: d.movements }));

  const tiles: [string, string, React.ComponentType<{ className?: string }>, string, Accent, boolean][] = [
    ['Issuable rolls', fmtInt(inventory.issuableFabricRolls), Scroll, `${fmtQty(inventory.fabricMetresOnHand)} m of fabric`, 'cutting', false],
    ['Out of stock', fmtInt(inventory.outOfStockCount), TriangleAlert, 'materials with nothing available', 'rejected', inventory.outOfStockCount > 0],
    ['Below minimum', fmtInt(inventory.belowMinimumCount), Hourglass, 'materials under minimum', 'rework', inventory.belowMinimumCount > 0],
    ['Movements today', fmtInt(inventory.movementsToday), ArrowLeftRight, 'ledger entries', 'inventory', false],
  ];

  return (
    <Card className={className}>
      <PanelHeader
        title="Raw material inventory"
        description="Stock health across active materials"
        icon={Boxes}
        accent="inventory"
        actions={<PanelLink href="/inventory/stock">Stock</PanelLink>}
      />
      <div className="space-y-5 px-5 pb-5">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {tiles.map(([label, value, Icon, hint, accent, alert]) => (
            <div key={label} className="glass-inset rounded-xl px-3.5 py-3">
              <p className="flex items-center gap-1.5 truncate text-[12.5px] text-ink-subtle">
                <span className="shrink-0" style={{ color: accentVar(accent) }}><Icon className="size-3.5" /></span>
                {label}
              </p>
              <p
                className="num mt-1 text-[22px] font-semibold leading-tight tracking-[-0.025em]"
                style={{ color: alert ? `var(--color-${accent === 'rejected' ? 'danger' : 'hold'})` : 'var(--color-ink)' }}
              >
                {value}
              </p>
              <p className="truncate text-[12px] text-ink-subtle">{hint}</p>
            </div>
          ))}
        </div>

        <div>
          <p className="mb-2.5 text-[13px] font-medium text-ink">
            Stock status <span className="font-normal text-ink-subtle">· {fmtInt(activeMaterials)} active materials</span>
          </p>
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
          <p className="mb-1 text-[13px] font-medium text-ink">
            Stock movements <span className="font-normal text-ink-subtle">· ledger entries per day, {periodLabel(range)}</span>
          </p>
          {trendsLoading ? (
            <div className="h-[150px] animate-pulse rounded-xl bg-surface-muted" />
          ) : !trends?.hasMovementHistory ? (
            <CompactEmpty icon={ArrowLeftRight} title={`No stock movements in the ${periodLabel(range)}`}>
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

  const tiles: [string, number, string, Accent, 'danger' | 'warn' | null][] = [
    ['Open orders', purchasing.openPurchaseOrders, '/purchasing/orders?status=APPROVED', 'purchasing', null],
    ['Awaiting approval', purchasing.awaitingApproval, '/purchasing/approvals', 'qc', purchasing.awaitingApproval > 0 ? 'warn' : null],
    ['Overdue', purchasing.overdue, '/purchasing/orders?overdueOnly=true', 'delayed', purchasing.overdue > 0 ? 'danger' : null],
    ['Pending inspection', purchasing.receiptsPendingInspection, '/purchasing/receipts?status=PENDING_INSPECTION', 'qc', purchasing.receiptsPendingInspection > 0 ? 'warn' : null],
  ];

  return (
    <Card className={className}>
      <PanelHeader
        title="Purchasing"
        description="Purchase orders by status"
        icon={ClipboardList}
        accent="purchasing"
        actions={<PanelLink href="/purchasing/orders">Orders</PanelLink>}
      />
      <div className="space-y-4 px-5 pb-5">
        <div className="grid grid-cols-2 gap-2">
          {tiles.map(([label, value, href, accent, alert]) => (
            <Link
              key={label}
              href={href}
              className="glass-inset group rounded-xl px-3.5 py-2.5 transition-colors hover:bg-[var(--glass-surface-hover)]"
            >
              <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-ink-subtle group-hover:text-ink-muted">
                <span className="size-2 shrink-0 rounded-full" style={{ background: accentVar(accent) }} />
                <span className="truncate">{label}</span>
              </span>
              <span
                className="num mt-0.5 block text-[20px] font-semibold tracking-[-0.02em]"
                style={{ color: alert ? `var(--color-${alert})` : 'var(--color-ink)' }}
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
          <CategoryBars data={bars} unit="orders" layout="horizontal-bars" height={Math.max(96, bars.length * 34)} />
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------ operational exceptions */

function OperationalExceptions({
  data, rejected, className,
}: {
  data: DashboardSummary;
  rejected: number;
  className?: string;
}) {
  const prod = data.production.available ? data.production : null;
  const blocked = (prod?.orders.byStatus.ON_HOLD ?? 0) + (prod?.orders.byStatus.PENDING_MATERIAL ?? 0);

  const items: {
    key: string; n: number; unit: string; label: string; href: string;
    severity: 'critical' | 'attention'; icon: React.ComponentType<{ className?: string }>; accent: Accent;
  }[] = [
    { key: 'oos', n: data.inventory.outOfStockCount, unit: 'materials', label: 'out of stock', href: '/intelligence/alerts', severity: 'critical', icon: TriangleAlert, accent: 'rejected' },
    { key: 'po-overdue', n: data.purchasing.overdue, unit: 'purchase orders', label: 'overdue', href: '/purchasing/orders?overdueOnly=true', severity: 'critical', icon: Truck, accent: 'delayed' },
    { key: 'mo-overdue', n: prod?.orders.overdue ?? 0, unit: 'manufacturing orders', label: 'past due date', href: '/manufacturing?overdueOnly=true', severity: 'critical', icon: Clock, accent: 'delayed' },
    { key: 'blocked', n: blocked, unit: 'manufacturing orders', label: 'on hold or waiting for material', href: '/manufacturing', severity: 'attention', icon: Hourglass, accent: 'hold' },
    { key: 'rejected', n: Math.round(rejected), unit: 'garments', label: 'rejected across stages', href: '/quality', severity: 'attention', icon: ShieldX, accent: 'rejected' },
    { key: 'below-min', n: data.inventory.belowMinimumCount, unit: 'materials', label: 'below minimum stock', href: '/intelligence/alerts', severity: 'attention', icon: Boxes, accent: 'rework' },
    { key: 'approval', n: data.purchasing.awaitingApproval, unit: 'purchase orders', label: 'awaiting approval', href: '/purchasing/approvals', severity: 'attention', icon: BadgeCheck, accent: 'qc' },
    { key: 'inspection', n: data.purchasing.receiptsPendingInspection, unit: 'deliveries', label: 'awaiting inspection', href: '/purchasing/receipts?status=PENDING_INSPECTION', severity: 'attention', icon: PackageCheck, accent: 'qc' },
  ];

  const [scope, setScope] = React.useState<'all' | 'critical'>('all');
  const [orderBy, setOrderBy] = React.useState<'severity' | 'count'>('severity');
  const rank = (i: (typeof items)[number]) => (i.severity === 'critical' ? 0 : 1);
  const open = items
    .filter((i) => i.n > 0 && (scope === 'all' || i.severity === 'critical'))
    .sort((a, b) => (orderBy === 'count' ? b.n - a.n : rank(a) - rank(b) || b.n - a.n));
  const clear = items.filter((i) => i.n === 0);
  const totalOpen = items.filter((i) => i.n > 0).length;

  return (
    <Card className={className}>
      <PanelHeader
        title="Operational exceptions"
        description={totalOpen ? `${totalOpen} need someone's attention` : 'Nothing is waiting on anyone'}
        icon={TriangleAlert}
        accent={items.some((i) => i.n > 0 && i.severity === 'critical') ? 'rejected' : 'qc'}
        actions={
          totalOpen ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Segmented<'all' | 'critical'>
                label="Show"
                value={scope}
                onChange={setScope}
                options={[{ value: 'all', label: 'All' }, { value: 'critical', label: 'Critical' }]}
              />
              <Segmented<'severity' | 'count'>
                label="Sort by"
                value={orderBy}
                onChange={setOrderBy}
                options={[{ value: 'severity', label: 'Severity' }, { value: 'count', label: 'Count' }]}
              />
            </div>
          ) : undefined
        }
      />
      <div className="px-3 pb-4">
        {open.length === 0 ? (
          <div className="px-2">
            <CompactEmpty icon={CircleCheck} title={totalOpen ? 'Nothing critical' : 'All clear'}>
              {totalOpen
                ? 'Nothing needs action now. Switch to All to see what is waiting.'
                : 'No shortages, overdue orders, rejections or pending inspections.'}
            </CompactEmpty>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {open.map((i) => {
              const Icon = i.icon;
              return (
                <li key={i.key}>
                  <Link
                    href={i.href}
                    className="group flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-surface-muted"
                  >
                    <span
                      className="grid size-8 shrink-0 place-items-center rounded-full"
                      style={{ color: accentVar(i.accent), background: `color-mix(in srgb, ${accentVar(i.accent)} 15%, transparent)` }}
                      aria-hidden="true"
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 text-[13.5px] leading-snug">
                      <span className="num font-semibold text-ink">{fmtInt(i.n)}</span>{' '}
                      <span className="text-ink">{i.unit}</span>{' '}
                      <span className="text-ink-muted">{i.label}</span>
                    </span>
                    <StatusBadge status={i.severity === 'critical' ? 'CRITICAL' : 'WARNING'} />
                    <ArrowRight className="size-3.5 shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {clear.length > 0 && open.length > 0 && scope === 'all' ? (
          <p className="mx-2 mt-2 flex flex-wrap items-center gap-x-1.5 border-t border-line pt-3 text-[12.5px] text-ink-subtle">
            <CircleCheck className="size-3.5" style={{ color: accentVar('completed') }} />
            Clear: {clear.map((c) => `${c.unit} ${c.label}`).join(' · ')}
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

  const header = (key: SortKey, label: string, right?: boolean) => {
    const activeSort = sort.key === key;
    return (
      <th
        scope="col"
        aria-sort={activeSort ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
        className={cn('whitespace-nowrap px-3 py-2.5 font-semibold', right ? 'text-right' : 'text-left')}
      >
        <button
          type="button"
          onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}
          className={cn('inline-flex items-center gap-1 transition-colors hover:text-ink', activeSort && 'text-ink')}
        >
          {label}
          <ArrowUpDown className="size-3 opacity-70" />
        </button>
      </th>
    );
  };

  return (
    <Card className={className}>
      <PanelHeader
        title="Stock alerts"
        description={`${all.length} materials at or below a threshold`}
        icon={TriangleAlert}
        accent="rework"
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
              <thead className="bg-surface-muted text-[12px] text-ink-muted">
                <tr>
                  {header('material', 'Material')}
                  {header('available', 'Available', true)}
                  {header('reorder', 'Reorder at', true)}
                  {header('suggest', 'Suggest', true)}
                  <th scope="col" className="px-3 py-2.5 text-left font-semibold">Level</th>
                  <th scope="col" className="px-3 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => (
                  <tr
                    key={a.rawMaterialId}
                    className={cn(
                      'border-t border-line transition-colors hover:bg-surface-muted',
                      a.alertLevel === 'OUT_OF_STOCK' && 'row-flag',
                    )}
                  >
                    <td className="px-3 py-2">
                      <span className="font-mono text-[12.5px] text-ink">{a.materialCode}</span>
                      <span className="ml-2 text-ink-muted">{a.materialName}</span>
                    </td>
                    <td className="num px-3 py-2 text-right font-semibold text-ink">
                      {fmtQty(a.availableQty)} <span className="font-normal text-ink-subtle">{uomShort(a.baseUom)}</span>
                    </td>
                    <td className="num px-3 py-2 text-right text-ink-muted">{fmtQty(a.reorderLevel)}</td>
                    <td className="num px-3 py-2 text-right text-ink">{fmtQty(a.suggestedOrderQty, 0)}</td>
                    <td className="px-3 py-2"><StatusBadge status={a.alertLevel} /></td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/materials/${a.rawMaterialId}`}
                        className="rounded-md px-2 py-1 text-[12.5px] font-medium text-brand-strong hover:bg-brand-soft"
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
          <div className="flex items-center justify-between gap-2 px-5 py-3 text-[13px] text-ink-subtle">
            <span className="num">
              {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, rows.length)} of {rows.length}
            </span>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
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

type MovementRow = DashboardSummary['recentMovements'][number];

const MOVE_SORTS: { value: string; label: string; sortBy: string; sortDir: 'asc' | 'desc' }[] = [
  { value: 'newest', label: 'Newest first', sortBy: 'occurredAt', sortDir: 'desc' },
  { value: 'oldest', label: 'Oldest first', sortBy: 'occurredAt', sortDir: 'asc' },
  { value: 'largest', label: 'Largest quantity', sortBy: 'baseQty', sortDir: 'desc' },
];

function MovementTimeline({
  movements: summaryMovements, range, className,
}: {
  movements: DashboardSummary['recentMovements'];
  range: TrendRange;
  className?: string;
}) {
  const [type, setType] = React.useState('');
  const [order, setOrder] = React.useState('newest');
  const sortDef = MOVE_SORTS.find((x) => x.value === order)!;
  const { from, to } = periodInstants(range);

  // Read from the ledger itself, filtered and sorted on the server within the
  // dashboard period — not a re-shuffle of the last dozen rows.
  const ledger = useQuery({
    queryKey: ['dashboard-movements', trendKey(range), type, order],
    queryFn: () => api.get<{ data: MovementRow[]; total: number }>('/inventory/movements', {
      page: 1, pageSize: 8, from, to,
      movementType: type || undefined, sortBy: sortDef.sortBy, sortDir: sortDef.sortDir,
    }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const movements = ledger.data?.data ?? (!type && order === 'newest' ? summaryMovements : []);
  const filtered = Boolean(type) || order !== 'newest';

  return (
    <Card className={className}>
      <PanelHeader
        title="Stock movements"
        description={`The immutable ledger · ${periodLabel(range)}${ledger.data ? ` · ${ledger.data.total.toLocaleString('en-IN')} entries` : ''}`}
        icon={ArrowLeftRight}
        accent="inventory"
        actions={<PanelLink href="/inventory/movements">Ledger</PanelLink>}
      />
      <div className="flex flex-wrap gap-2 px-5 pb-3">
        <NativeSelect value={type} onChange={(e) => setType(e.target.value)} aria-label="Movement type" className="h-8 w-auto min-w-[160px] text-[13px]">
          <option value="">All movement types</option>
          {Object.keys(MOVEMENT_STYLE).map((t) => <option key={t} value={t}>{humanise(t)}</option>)}
        </NativeSelect>
        <NativeSelect value={order} onChange={(e) => setOrder(e.target.value)} aria-label="Sort movements" className="h-8 w-auto min-w-[150px] text-[13px]">
          {MOVE_SORTS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
        </NativeSelect>
      </div>
      <div className={cn('px-5 pb-5 transition-opacity', ledger.isFetching && 'opacity-70')}>
        {movements.length === 0 ? (
          <CompactEmpty icon={ArrowLeftRight} title={filtered ? 'No movements match' : `No stock movements in the ${periodLabel(range)}`}>
            {filtered ? 'Choose another movement type or a wider period.' : 'Receive a purchase order to create the first ledger entries.'}
          </CompactEmpty>
        ) : (
          <ol>
            {movements.slice(0, 8).map((m, i, arr) => {
              const style = MOVEMENT_STYLE[m.movementType] ?? { icon: ArrowLeftRight, accent: 'neutral' as Accent };
              const Icon = style.icon;
              return (
                <li key={m.id} className="relative flex gap-3 pb-3.5 last:pb-0">
                  {i < arr.length - 1 ? (
                    <span aria-hidden="true" className="absolute left-[15px] top-9 bottom-1 w-px bg-line" />
                  ) : null}
                  <span
                    className="relative grid size-8 shrink-0 place-items-center rounded-full border"
                    style={{
                      color: accentVar(style.accent),
                      background: `color-mix(in srgb, ${accentVar(style.accent)} 14%, transparent)`,
                      borderColor: `color-mix(in srgb, ${accentVar(style.accent)} 28%, transparent)`,
                    }}
                    aria-hidden="true"
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-[13.5px] font-medium text-ink">{humanise(m.movementType)}</p>
                      <p className="num shrink-0 text-[13.5px] font-semibold text-ink">
                        {fmtQty(m.baseQty)} <span className="font-normal text-ink-subtle">{uomShort(m.rawMaterial.baseUom)}</span>
                      </p>
                    </div>
                    <p className="truncate text-[12.5px] text-ink-muted">
                      <span className="font-mono text-ink">{m.rawMaterial.materialCode}</span>
                      <span className="mx-1.5 text-ink-subtle">·</span>
                      {m.sourceLocation.code} <ArrowRight className="inline size-3 text-ink-subtle" /> {m.destinationLocation.code}
                    </p>
                    <p className="text-[12px] text-ink-subtle">
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
