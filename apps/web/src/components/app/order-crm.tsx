'use client';

import * as React from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Popover from '@radix-ui/react-popover';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Crown, Flag, Flame,
  History, Lock, Minus, StickyNote,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/components/app/auth-context';
import { fmtDateTime, humanise } from '@/lib/utils';

/* ----------------------------------------------------------------- types */

export type OrderPriority = 'VIP' | 'HIGH' | 'MEDIUM' | 'NORMAL';
export type DispatchState = 'NONE' | 'OVERDUE' | 'TODAY' | 'SOON' | 'LATER' | 'SETTLED';

export interface OrderCrm {
  expectedDispatchDate: string | null;
  dispatchDateSource: string;
  dispatchDateLocked: boolean;
  dispatchState: DispatchState;
  dispatchDateUpdatedBy: string | null;
  dispatchDateUpdatedAt: string | null;
  dispatchDateOriginalValue: string | null;
  dispatchDateChangeReason: string | null;
  shopify: { date: string | null; source: string | null; text: string | null; issue: string | null };
  conflict: boolean;
  priority: OrderPriority;
  prioritySource: string;
  priorityUpdatedBy: string | null;
  priorityUpdatedAt: string | null;
  priorityReason: string | null;
  remarks: string | null;
  remarksUpdatedBy: string | null;
  remarksUpdatedAt: string | null;
}

export const PRIORITIES: { value: OrderPriority; label: string; short: string; icon: typeof Crown }[] = [
  { value: 'VIP', label: 'VIP Order', short: 'VIP', icon: Crown },
  { value: 'HIGH', label: 'High Priority', short: 'High', icon: Flame },
  { value: 'MEDIUM', label: 'Medium Priority', short: 'Medium', icon: Flag },
  { value: 'NORMAL', label: 'Normal Priority', short: 'Normal', icon: Minus },
];

export const DISPATCH_SOURCE_LABEL: Record<string, string> = {
  CRM_MANUAL: 'Set by CRM',
  SHOPIFY_METAFIELD: 'Shopify field',
  SHOPIFY_CUSTOM_ATTRIBUTE: 'Shopify checkout attribute',
  SHOPIFY_NOTE: 'Shopify order note',
  UNASSIGNED: 'Not set',
};

const ISSUE_LABEL: Record<string, string> = {
  CONFLICTING_DATES: 'The Shopify note names more than one dispatch date.',
  AMBIGUOUS_DATE: 'The Shopify note has a dispatch date that cannot be read without guessing.',
  INVALID_DATE: 'The Shopify note has a dispatch date that does not exist.',
};

/** 05 Nov 2026 — a calendar date, never shifted by the viewer's timezone. */
export function fmtDispatchDate(ymd: string | null | undefined): string {
  if (!ymd) return '';
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Today in India, as YYYY-MM-DD. */
export function istToday(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Everything that shows an order's CRM fields goes stale together. */
function useInvalidateCrm(orderId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['shopify-orders'] });
    void qc.invalidateQueries({ queryKey: ['order', orderId] });
    void qc.invalidateQueries({ queryKey: ['order-crm-history', orderId] });
    void qc.invalidateQueries({ queryKey: ['order-facets'] });
    void qc.invalidateQueries({ queryKey: ['demand'] });
    void qc.invalidateQueries({ queryKey: ['fulfilment-board'] });
  };
}

const errorText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'The change was not saved.');

/* -------------------------------------------------------------- priority */

export function PriorityBadge({ priority, compact }: { priority: OrderPriority; compact?: boolean }) {
  const p = PRIORITIES.find((x) => x.value === priority) ?? PRIORITIES[3]!;
  const Icon = p.icon;
  return (
    <span className={`prio-badge prio-${p.value}`} title={p.label}>
      <Icon aria-hidden /> {compact ? p.short : p.label}
    </span>
  );
}

/**
 * The priority, changeable in place by the CRM. Shows the new value at once
 * and puts the old one back if the save fails.
 */
export function PriorityPicker({
  orderId, value, compact = true,
}: { orderId: string; value: OrderPriority; compact?: boolean }) {
  const { can } = useAuth();
  const invalidate = useInvalidateCrm(orderId);
  const [shown, setShown] = React.useState(value);
  React.useEffect(() => setShown(value), [value]);

  const save = useMutation({
    mutationFn: (priority: OrderPriority) => api.patch<{ crm: OrderCrm }>(`/orders/${orderId}/priority`, { priority }),
    onMutate: (priority) => {
      const before = shown;
      setShown(priority);
      return { before };
    },
    onError: (e, _p, ctx) => {
      if (ctx) setShown(ctx.before);
      toast.error(`Priority not saved: ${errorText(e)}`);
    },
    onSuccess: (r) => {
      toast.success(`Priority set to ${PRIORITIES.find((p) => p.value === r.crm.priority)?.label ?? r.crm.priority}`);
      invalidate();
    },
  });

  if (!can('demand.manage_crm')) return <PriorityBadge priority={shown} compact={compact} />;
  const current = PRIORITIES.find((p) => p.value === shown) ?? PRIORITIES[3]!;
  const Icon = current.icon;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={`prio-badge prio-${shown} ${save.isPending ? 'opacity-60' : ''}`}
          aria-label={`Priority: ${current.label}. Change`}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Icon aria-hidden /> {compact ? current.short : current.label}
          <ChevronDown className="!size-3 opacity-70" aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="glass-floating crm-pop w-[200px] p-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenu.Label className="px-2.5 pb-1.5 pt-1 text-[11.5px] font-medium text-ink-subtle">Order priority</DropdownMenu.Label>
          {PRIORITIES.map((p) => {
            const I = p.icon;
            return (
              <DropdownMenu.Item
                key={p.value}
                onSelect={() => { if (p.value !== shown) save.mutate(p.value); }}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink outline-none data-[highlighted]:bg-surface-muted"
              >
                <span className={`prio-${p.value} grid size-5 place-items-center rounded-full`} style={{ color: 'var(--prio-c)', background: 'color-mix(in srgb, var(--prio-c) 14%, transparent)' }}>
                  <I className="size-3" aria-hidden />
                </span>
                <span className="flex-1">{p.label}</span>
                {p.value === shown ? <Check className="size-3.5 text-ink-muted" aria-label="Current" /> : null}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/* ---------------------------------------------------------- dispatch date */

/** A date coloured by how it reads today; read-only. */
export function DispatchDateText({ date, state }: { date: string | null; state: DispatchState }) {
  if (!date) return <span className="text-ink-subtle">—</span>;
  return (
    <span className={`dispatch-${state} num whitespace-nowrap`} title={state === 'OVERDUE' ? 'Overdue: promised date has passed' : undefined}>
      {fmtDispatchDate(date)}
      {state === 'OVERDUE' ? <span className="sr-only"> (overdue)</span> : null}
    </span>
  );
}

/**
 * The dispatch date, editable in place by the CRM: a date, or "Set Dispatch
 * Date" when there is none. Saves only on an explicit Save.
 */
export function DispatchDateCell({
  orderId, date, state, source,
}: { orderId: string; date: string | null; state: DispatchState; source?: string }) {
  const { can } = useAuth();
  const [open, setOpen] = React.useState(false);
  if (!can('demand.manage_crm')) return <DispatchDateText date={date} state={state} />;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className="group inline-flex min-h-[28px] items-center gap-1.5 rounded-lg px-1.5 -mx-1.5 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-brand"
          title={date ? `${DISPATCH_SOURCE_LABEL[source ?? ''] ?? ''} — change` : 'Set the expected dispatch date'}
        >
          {date ? (
            <DispatchDateText date={date} state={state} />
          ) : (
            <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brand-strong">
              <CalendarDays className="size-3.5" aria-hidden /> Set Dispatch Date
            </span>
          )}
          {date && source === 'CRM_MANUAL' ? <Lock className="size-3 text-ink-subtle" aria-label="Set by CRM" /> : null}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={16}
          className="glass-floating crm-pop w-[300px] p-3"
          onClick={(e) => e.stopPropagation()}
        >
          <DispatchDateEditor orderId={orderId} current={date} onDone={() => setOpen(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function DispatchDateEditor({
  orderId, current, onDone,
}: { orderId: string; current: string | null; onDone: () => void }) {
  const invalidate = useInvalidateCrm(orderId);
  const [picked, setPicked] = React.useState<string | null>(current);
  const [reason, setReason] = React.useState('');
  const changingExisting = current !== null && picked !== current;
  const reasonOk = !changingExisting || reason.trim().length >= 3;

  const save = useMutation({
    mutationFn: (date: string | null) =>
      api.patch<{ crm: OrderCrm }>(`/orders/${orderId}/dispatch-date`, { date, reason: reason.trim() || undefined }),
    onSuccess: (r) => {
      toast.success(r.crm.expectedDispatchDate ? `Dispatch date set to ${fmtDispatchDate(r.crm.expectedDispatchDate)}` : 'Dispatch date cleared');
      invalidate();
      onDone();
    },
    onError: (e) => toast.error(`Dispatch date not saved: ${errorText(e)}`),
  });

  const today = istToday();
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="font-display text-[14px] font-semibold text-ink">Expected dispatch</p>
        <p className="num text-[12.5px] text-ink-muted">{picked ? fmtDispatchDate(picked) : 'No date'}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {[{ l: 'Today', d: today }, { l: 'Tomorrow', d: addDays(today, 1) }, { l: '+3 days', d: addDays(today, 3) }, { l: '+7 days', d: addDays(today, 7) }].map((q) => (
          <button
            key={q.l}
            type="button"
            onClick={() => setPicked(q.d)}
            aria-pressed={picked === q.d}
            className={`h-7 rounded-lg border px-2.5 text-[12px] font-medium ${picked === q.d ? 'border-brand/60 bg-brand-soft text-ink' : 'border-line text-ink-muted hover:text-ink'}`}
          >
            {q.l}
          </button>
        ))}
      </div>
      <GlassCalendar value={picked} onChange={setPicked} />
      {changingExisting ? (
        <label className="block">
          <span className="mb-1 block text-[12px] text-ink-muted">
            Reason for {picked ? 'changing' : 'clearing'} the date <span className="text-danger">*</span>
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="e.g. Embroidery needs two more days"
            className="w-full rounded-lg border border-line-strong bg-surface px-2.5 py-2 text-[13px] text-ink placeholder:text-ink-subtle focus-visible:border-brand focus-visible:outline-none"
          />
        </label>
      ) : null}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        {current ? (
          <button
            type="button"
            onClick={() => setPicked(null)}
            className="h-9 rounded-lg px-2.5 text-[13px] font-medium text-danger hover:bg-surface-muted"
          >
            Clear date
          </button>
        ) : <span />}
        <div className="flex gap-2">
          <button type="button" onClick={onDone} className="h-9 rounded-lg border border-line px-3 text-[13px] text-ink hover:bg-surface-muted">Cancel</button>
          <button
            type="button"
            disabled={save.isPending || picked === current || !reasonOk}
            onClick={() => save.mutate(picked)}
            className="h-9 rounded-lg bg-ink px-3.5 text-[13px] font-semibold text-canvas disabled:opacity-40"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A month calendar on glass. Monday-first, today ringed in blue, the chosen
 * day filled. Arrow keys move by day and week; PageUp/PageDown by month.
 */
export function GlassCalendar({ value, onChange }: { value: string | null; onChange: (ymd: string) => void }) {
  const today = istToday();
  const [month, setMonth] = React.useState(() => (value ?? today).slice(0, 7));
  const [focus, setFocus] = React.useState(value ?? today);
  const grid = React.useRef<HTMLDivElement>(null);

  const first = new Date(`${month}-01T00:00:00Z`);
  const lead = (first.getUTCDay() + 6) % 7;
  const start = addDays(`${month}-01`, -lead);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const label = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const shiftMonth = (n: number) => {
    const d = new Date(`${month}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
  };

  const moveFocus = (to: string) => {
    setFocus(to);
    if (to.slice(0, 7) !== month) setMonth(to.slice(0, 7));
    requestAnimationFrame(() => grid.current?.querySelector<HTMLButtonElement>(`[data-day="${to}"]`)?.focus());
  };
  const onKey = (e: React.KeyboardEvent) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (step[e.key] !== undefined) { e.preventDefault(); moveFocus(addDays(focus, step[e.key]!)); }
    else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      const d = new Date(`${focus}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + (e.key === 'PageUp' ? -1 : 1));
      moveFocus(d.toISOString().slice(0, 10));
    }
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month" className="grid size-8 place-items-center rounded-lg text-ink-muted hover:bg-surface-muted hover:text-ink">
          <ChevronLeft className="size-4" />
        </button>
        <p className="font-display text-[13.5px] font-semibold text-ink" aria-live="polite">{label}</p>
        <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month" className="grid size-8 place-items-center rounded-lg text-ink-muted hover:bg-surface-muted hover:text-ink">
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="cal-grid mb-1 text-center text-[11px] font-medium text-ink-subtle" aria-hidden>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i}>{d}</span>)}
      </div>
      <div ref={grid} role="grid" aria-label={label} className="cal-grid" onKeyDown={onKey}>
        {days.map((d) => (
          <button
            key={d}
            type="button"
            role="gridcell"
            data-day={d}
            data-outside={d.slice(0, 7) !== month}
            data-today={d === today}
            aria-selected={d === value}
            aria-label={fmtDispatchDate(d)}
            tabIndex={d === focus ? 0 : -1}
            onClick={() => { setFocus(d); onChange(d); }}
            className="cal-day"
          >
            {Number(d.slice(8))}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- order page card */

interface CrmChange {
  id: string; field: string; previousValue: string | null; newValue: string | null;
  source: string; reason: string | null; changedAt: string; changedBy: string | null;
}

/** "CRM & Dispatch" on the order page: the promise, where it came from, and who changed it. */
export function CrmDispatchCard({ orderId, crm, note }: { orderId: string; crm: OrderCrm; note: string | null }) {
  const { can } = useAuth();
  const canEdit = can('demand.manage_crm');
  const invalidate = useInvalidateCrm(orderId);
  const [showNote, setShowNote] = React.useState(false);
  const [showHistory, setShowHistory] = React.useState(false);
  const [remarks, setRemarks] = React.useState(crm.remarks ?? '');
  React.useEffect(() => setRemarks(crm.remarks ?? ''), [crm.remarks]);
  const [useShopifyReason, setUseShopifyReason] = React.useState<string | null>(null);

  const saveRemarks = useMutation({
    mutationFn: () => api.patch<{ crm: OrderCrm }>(`/orders/${orderId}/crm-remarks`, { remarks: remarks.trim() || null }),
    onSuccess: () => { toast.success('Remarks saved'); invalidate(); },
    onError: (e) => toast.error(`Remarks not saved: ${errorText(e)}`),
  });
  const useShopify = useMutation({
    mutationFn: () => api.post<{ crm: OrderCrm }>(`/orders/${orderId}/dispatch-date/use-shopify`, { reason: useShopifyReason }),
    onSuccess: () => { toast.success("Dispatch date returned to Shopify's"); setUseShopifyReason(null); invalidate(); },
    onError: (e) => toast.error(errorText(e)),
  });
  const history = useQuery({
    queryKey: ['order-crm-history', orderId],
    queryFn: () => api.get<CrmChange[]>(`/orders/${orderId}/crm-history`),
    enabled: showHistory,
  });

  const lastUpdate = [
    { at: crm.dispatchDateUpdatedAt, by: crm.dispatchDateUpdatedBy },
    { at: crm.priorityUpdatedAt, by: crm.priorityUpdatedBy },
    { at: crm.remarksUpdatedAt, by: crm.remarksUpdatedBy },
  ].filter((u) => u.at).sort((a, b) => (b.at! > a.at! ? 1 : -1))[0];

  return (
    <div className="glass rounded-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
        <div>
          <h2 className="t-card-title text-ink">CRM &amp; Dispatch</h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">The promise made to the customer, and its priority.</p>
        </div>
        <div className="flex items-center gap-1.5">
          {note ? (
            <button type="button" onClick={() => setShowNote((v) => !v)} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-ink-muted hover:bg-surface-muted hover:text-ink" aria-expanded={showNote}>
              <StickyNote className="size-3.5" /> Shopify note
            </button>
          ) : null}
          <button type="button" onClick={() => setShowHistory((v) => !v)} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-ink-muted hover:bg-surface-muted hover:text-ink" aria-expanded={showHistory}>
            <History className="size-3.5" /> Change history
          </button>
        </div>
      </div>

      <div className="grid gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-[12.5px] font-medium text-ink-subtle">Expected dispatch date</p>
          <div className="mt-1 text-[15px]">
            <DispatchDateCell orderId={orderId} date={crm.expectedDispatchDate} state={crm.dispatchState} source={crm.dispatchDateSource} />
          </div>
          {crm.dispatchState === 'OVERDUE' ? <p className="mt-0.5 text-[12px] font-medium text-danger">Overdue — not yet dispatched</p> : null}
        </div>
        <div>
          <p className="text-[12.5px] font-medium text-ink-subtle">Date source</p>
          <p className="mt-1 text-[13.5px] text-ink">
            {DISPATCH_SOURCE_LABEL[crm.dispatchDateSource] ?? humanise(crm.dispatchDateSource)}
            {crm.dispatchDateLocked ? <Lock className="ml-1 inline size-3 text-ink-subtle" aria-label="Locked against Shopify sync" /> : null}
          </p>
          {crm.dispatchDateChangeReason ? <p className="mt-0.5 text-[12px] text-ink-muted">“{crm.dispatchDateChangeReason}”</p> : null}
          {crm.dispatchDateOriginalValue ? <p className="mt-0.5 text-[12px] text-ink-subtle">Originally {crm.dispatchDateOriginalValue}</p> : null}
        </div>
        <div>
          <p className="text-[12.5px] font-medium text-ink-subtle">Priority</p>
          <div className="mt-1"><PriorityPicker orderId={orderId} value={crm.priority} compact={false} /></div>
          {crm.priorityReason ? <p className="mt-1 text-[12px] text-ink-muted">“{crm.priorityReason}”</p> : null}
          {crm.prioritySource !== 'CRM_MANUAL' && crm.prioritySource !== 'DEFAULT' ? (
            <p className="mt-0.5 text-[12px] text-ink-subtle">From {humanise(crm.prioritySource)}</p>
          ) : null}
        </div>
        <div>
          <p className="text-[12.5px] font-medium text-ink-subtle">Last updated</p>
          <p className="mt-1 text-[13.5px] text-ink">{lastUpdate ? (lastUpdate.by ?? 'Shopify sync') : '—'}</p>
          {lastUpdate?.at ? <p className="text-[12px] text-ink-muted">{fmtDateTime(lastUpdate.at)}</p> : null}
        </div>
      </div>

      {/* What Shopify says, when it disagrees or cannot be read. */}
      {crm.conflict || crm.shopify.issue ? (
        <div className="mx-5 mb-4 flex flex-wrap items-start gap-3 rounded-xl border border-warn/40 bg-warn-soft px-3.5 py-2.5 text-[13px]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-ink">
              {crm.conflict
                ? `Shopify now says ${fmtDispatchDate(crm.shopify.date)} — the CRM date is kept.`
                : ISSUE_LABEL[crm.shopify.issue!] ?? 'The Shopify dispatch date needs review.'}
            </p>
            {crm.shopify.text ? <p className="mt-0.5 truncate text-[12.5px] text-ink-muted">Read from: “{crm.shopify.text}”</p> : null}
          </div>
          {crm.conflict && canEdit ? (
            useShopifyReason === null ? (
              <button type="button" onClick={() => setUseShopifyReason('')} className="h-8 rounded-lg border border-line px-2.5 text-[12.5px] font-medium text-ink hover:bg-surface-muted">
                Use Shopify&rsquo;s date
              </button>
            ) : (
              <div className="flex w-full flex-wrap items-center gap-2">
                <input
                  value={useShopifyReason}
                  onChange={(e) => setUseShopifyReason(e.target.value)}
                  placeholder="Reason"
                  className="h-8 min-w-[200px] flex-1 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] text-ink"
                />
                <button type="button" onClick={() => setUseShopifyReason(null)} className="h-8 rounded-lg px-2.5 text-[12.5px] text-ink-muted hover:bg-surface-muted">Cancel</button>
                <button
                  type="button"
                  disabled={useShopifyReason.trim().length < 3 || useShopify.isPending}
                  onClick={() => useShopify.mutate()}
                  className="h-8 rounded-lg bg-ink px-3 text-[12.5px] font-semibold text-canvas disabled:opacity-40"
                >
                  Use {fmtDispatchDate(crm.shopify.date)}
                </button>
              </div>
            )
          ) : null}
        </div>
      ) : crm.shopify.date && crm.dispatchDateSource !== 'CRM_MANUAL' ? (
        <p className="mx-5 mb-4 text-[12.5px] text-ink-muted">Read from Shopify: “{crm.shopify.text}”</p>
      ) : null}

      <div className="border-t border-line px-5 py-4">
        <label htmlFor={`crm-remarks-${orderId}`} className="text-[12.5px] font-medium text-ink-subtle">CRM remarks</label>
        {canEdit ? (
          <>
            <textarea
              id={`crm-remarks-${orderId}`}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Anything the team should know about this customer's order"
              className="mt-1.5 w-full rounded-xl border border-line-strong bg-surface px-3 py-2 text-[13.5px] text-ink placeholder:text-ink-subtle focus-visible:border-brand focus-visible:outline-none"
            />
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="text-[12px] text-ink-subtle">
                {crm.remarksUpdatedAt ? `Saved by ${crm.remarksUpdatedBy ?? '—'} · ${fmtDateTime(crm.remarksUpdatedAt)}` : ''}
              </span>
              <button
                type="button"
                disabled={(remarks.trim() || null) === (crm.remarks ?? null) || saveRemarks.isPending}
                onClick={() => saveRemarks.mutate()}
                className="h-8 rounded-lg bg-ink px-3 text-[12.5px] font-semibold text-canvas disabled:opacity-40"
              >
                {saveRemarks.isPending ? 'Saving…' : 'Save remarks'}
              </button>
            </div>
          </>
        ) : (
          <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-ink">{crm.remarks ?? '—'}</p>
        )}
      </div>

      {showNote && note ? (
        <div className="border-t border-line px-5 py-4">
          <p className="text-[12.5px] font-medium text-ink-subtle">Shopify order note (unchanged)</p>
          <p className="mt-1 whitespace-pre-wrap text-[13px] text-ink">{note}</p>
        </div>
      ) : null}

      {showHistory ? (
        <div className="border-t border-line px-5 py-4">
          <p className="mb-2 text-[12.5px] font-medium text-ink-subtle">Change history</p>
          {history.isLoading ? <p className="text-[13px] text-ink-muted">Loading…</p>
            : !history.data?.length ? <p className="text-[13px] text-ink-muted">No changes yet.</p>
            : (
              <ol className="space-y-2">
                {history.data.map((h) => (
                  <li key={h.id} className="text-[13px]">
                    <span className="font-medium text-ink">{fieldLabel(h.field)}</span>
                    <span className="text-ink-muted"> {valueLabel(h.field, h.previousValue)} → </span>
                    <span className="text-ink">{valueLabel(h.field, h.newValue)}</span>
                    <span className="block text-[12px] text-ink-subtle">
                      {h.changedBy ?? DISPATCH_SOURCE_LABEL[h.source] ?? humanise(h.source)} · {fmtDateTime(h.changedAt)}
                      {h.reason ? ` · “${h.reason}”` : ''}
                    </span>
                  </li>
                ))}
              </ol>
            )}
        </div>
      ) : null}
    </div>
  );
}

function fieldLabel(field: string) {
  return field === 'EXPECTED_DISPATCH_DATE' ? 'Dispatch date' : field === 'PRIORITY' ? 'Priority' : 'Remarks';
}

function valueLabel(field: string, v: string | null) {
  if (v === null) return 'none';
  if (field === 'EXPECTED_DISPATCH_DATE') return fmtDispatchDate(v);
  if (field === 'PRIORITY') return PRIORITIES.find((p) => p.value === v)?.label ?? v;
  return v.length > 60 ? `“${v.slice(0, 60)}…”` : `“${v}”`;
}
