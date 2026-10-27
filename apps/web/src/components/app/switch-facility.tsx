'use client';

import * as React from 'react';
import Link from 'next/link';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeftRight, ArrowRight, Check, CircleHelp, Clock, ExternalLink, RefreshCw, X,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/components/app/auth-context';
import { fmtDate, fmtQty, humanise } from '@/lib/utils';

/* ----------------------------------------------------------------- types */

type CheckState = 'PASS' | 'FAIL' | 'UNKNOWN';
interface Check { code: string; label: string; state: CheckState; detail: string }
interface Item {
  code: string; sku: string | null; itemName: string | null; facilityCode: string | null; facilityName: string | null;
  statusCode: string | null; shippingPackageCode: string | null; shippingPackageStatus: string | null; onHold: boolean;
  lineId: string | null; lineMatch: string | null; lineTitle: string | null;
}
interface FacilityRow {
  code: string; name: string | null; kind: string; visible: boolean; enabled: boolean | null; isCurrent: boolean;
  availableQty: string | null; openSaleQty: string | null; heldQty: string | null; checkedAt: string | null;
  eligible: boolean; restriction: string | null;
}
interface Options {
  order: { id: string; orderName: string; saleOrderCode: string | null; saleOrderStatus: string | null; found: boolean; displayMatches: boolean };
  items: Item[];
  selectedItemCode: string | null;
  line: { id: string; title: string | null; sku: string | null; priority: string; orderedQty: string; openQty: string; requiredByDate: string | null } | null;
  production: {
    demand: { id: string; demandNo: string; status: string; priority: string; requiredByDate: string | null } | null;
    orders: { moNo: string; status: string; stage: string | null }[];
  } | null;
  current: { code: string | null; name: string | null; availableQty: string | null; checkedAt: string | null; statusCode: string | null; shippingPackageStatus: string | null } | null;
  facilities: FacilityRow[];
  checks: Check[];
  writes: { env: boolean; connection: boolean };
  activeOperation: { id: string; status: string } | null;
  fetchedAt: string;
}
interface Preflight {
  ready: boolean; checks: Check[]; blocker: Check | null; token: string | null; expiresAt: string | null;
  target: { code: string; availableQty: string | null; openSaleQty: string | null; heldQty: string | null; checkedAt: string | null };
}
export interface SwitchOperation {
  id: string; reference: string; orderId: string; status: string; saleOrderCode: string; saleOrderItemCode: string;
  sku: string | null; quantity: string; sourceFacilityCode: string; targetFacilityCode: string;
  verifiedFacilityCode: string | null; reason: string; operator: { id: string; name: string | null };
  createdAt: string; submittedAt: string | null; verificationCompletedAt: string | null;
  api: { successful: boolean | null; message: string | null; errors: { message: string | null; description: string | null }[]; warnings: { message: string | null; description: string | null }[] };
  failure: { code: string; message: string | null } | null;
  reconciliation: { reasons?: string[]; demandId: string | null; reviewedAt: string | null; reviewedBy: string | null; note: string | null } | null;
  events: { type: string; at: string; statusAfter: string | null; actor: string | null; errorCode: string | null }[];
}

const WORKING = ['CREATED', 'PREFLIGHT_CHECKING', 'READY', 'EXECUTING', 'API_ACCEPTED', 'VERIFYING'];

/* ---------------------------------------------------------------- button */

/**
 * The entry point everywhere a line can be switched. Hidden for anyone who
 * cannot read orders; disabled, with the reason, for anyone who cannot switch.
 */
export function SwitchFacilityButton({
  orderId, lineId, itemCode, compact, label = 'Switch facility', onDone,
}: {
  orderId: string | null; lineId?: string | null; itemCode?: string; compact?: boolean; label?: string; onDone?: () => void;
}) {
  const { can } = useAuth();
  const [open, setOpen] = React.useState(false);
  if (!can('demand.read')) return null;
  const allowed = can('demand.switch_facility');
  const reason = !orderId
    ? 'Only lines from a Shopify order can be switched.'
    : !allowed
      ? 'Needs the "Move an order item to another Unicommerce fulfilment facility" permission.'
      : 'Move this item to another Unicommerce facility';
  return (
    <>
      <button
        type="button"
        disabled={!allowed || !orderId}
        onClick={() => setOpen(true)}
        title={reason}
        aria-label={compact ? label : undefined}
        className={
          compact
            ? 'grid size-9 place-items-center rounded-lg text-ink-muted hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40'
            : 'inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-line px-3 text-[13px] font-medium text-ink hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50'
        }
      >
        <ArrowLeftRight className="size-3.5" />
        {compact ? null : label}
      </button>
      {open && orderId ? (
        <SwitchFacilityDialog
          open={open}
          onOpenChange={setOpen}
          orderId={orderId}
          lineId={lineId ?? undefined}
          itemCode={itemCode}
          onDone={onDone}
        />
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------- dialog */

export function SwitchFacilityDialog({
  open, onOpenChange, orderId, lineId, itemCode, onDone,
}: {
  open: boolean; onOpenChange: (open: boolean) => void; orderId: string; lineId?: string; itemCode?: string; onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [item, setItem] = React.useState<string | undefined>(itemCode);
  const [target, setTarget] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState('');
  const [operationId, setOperationId] = React.useState<string | null>(null);
  const [showDetail, setShowDetail] = React.useState(false);
  const pending = React.useRef<{ key: string; body: Record<string, string> } | null>(null);

  const options = useQuery({
    queryKey: ['facility-switch-options', orderId, lineId ?? null, item ?? null],
    queryFn: () => api.get<Options>(`/orders/${orderId}/facility-switch/options`, { line: lineId, item }),
    enabled: open && !operationId,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const data = options.data;
  const selected = data?.items.find((i) => i.code === data.selectedItemCode) ?? null;

  // An operation already running for this item takes over the dialog: the
  // switch is durable, so reopening shows where it got to.
  React.useEffect(() => {
    if (data?.activeOperation && !operationId) setOperationId(data.activeOperation.id);
  }, [data?.activeOperation, operationId]);

  const preflight = useMutation({
    mutationFn: (tgt: string) =>
      api.post<Preflight>(`/orders/${orderId}/facility-switch/preflight`, {
        saleOrderItemCode: selected!.code,
        targetFacilityCode: tgt,
        expectedCurrentFacilityCode: selected!.facilityCode,
      }),
  });
  const pf = preflight.data && preflight.variables === target ? preflight.data : null;

  const choose = (code: string) => {
    setTarget(code);
    preflight.reset();
    preflight.mutate(code);
  };

  const remaining = useCountdown(pf?.expiresAt ?? null);
  const expired = Boolean(pf?.token) && remaining <= 0;

  const start = useMutation({
    mutationFn: () => {
      const p = pending.current!;
      return api.post<{ replayed: boolean; operation: SwitchOperation }>(
        `/orders/${orderId}/facility-switch`, p.body, { headers: { 'Idempotency-Key': p.key } },
      );
    },
    onSuccess: (r) => setOperationId(r.operation.id),
  });

  const confirm = () => {
    if (!pf?.token || !selected || !target || start.isPending) return;
    // One key per confirmation; a retry after a lost response reuses it, so
    // the server replays the operation instead of starting a second one.
    pending.current = {
      key: `fsw-${crypto.randomUUID()}`,
      body: {
        preflightToken: pf.token, saleOrderItemCode: selected.code, targetFacilityCode: target,
        expectedCurrentFacilityCode: selected.facilityCode ?? '', reason: reason.trim(),
      },
    };
    start.mutate();
  };

  const op = useQuery({
    queryKey: ['facility-switch-operation', operationId],
    queryFn: () => api.get<SwitchOperation>(`/facility-switch/operations/${operationId}`),
    enabled: Boolean(operationId),
    refetchInterval: (q) => (q.state.data && !WORKING.includes(q.state.data.status) ? false : 1000),
  });
  const operation = op.data ?? null;

  const verify = useMutation({
    mutationFn: () => api.post<SwitchOperation>(`/facility-switch/operations/${operationId}/verify`, {}),
    onSuccess: (r) => qc.setQueryData(['facility-switch-operation', operationId], r),
  });

  // When an outcome lands, everything that shows this order is stale.
  const outcome = operation && !WORKING.includes(operation.status) ? operation.status : null;
  React.useEffect(() => {
    if (!outcome) return;
    void qc.invalidateQueries({ queryKey: ['order', orderId] });
    void qc.invalidateQueries({ queryKey: ['shopify-orders'] });
    void qc.invalidateQueries({ queryKey: ['facility-switch-history', orderId] });
    void qc.invalidateQueries({ queryKey: ['fulfilment-board'] });
    void qc.invalidateQueries({ queryKey: ['demand'] });
    onDone?.();
  }, [outcome, orderId, qc, onDone]);

  const refresh = () => {
    preflight.reset();
    setTarget(null);
    void options.refetch();
  };

  const view: View = operationId
    ? operation ? operationView(operation) : 'EXECUTING'
    : options.isLoading || options.isFetching ? 'INITIAL_LOADING'
    : options.error ? 'LOAD_FAILED'
    : !data?.order.found ? 'BLOCKED'
    : !target ? 'SELECT'
    : preflight.isPending ? 'CHECKING'
    : pf?.ready && !expired ? 'READY'
    : pf?.blocker?.code === 'STOCK' ? 'STOCK_CHANGED'
    : pf ? (expired ? 'EXPIRED' : 'BLOCKED')
    : preflight.error ? 'CHECK_FAILED' : 'SELECT';

  const reasonOk = reason.trim().length >= 5;
  const canConfirm = view === 'READY' && reasonOk && !start.isPending;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fsw-overlay" />
        <DialogPrimitive.Content
          className="fsw-panel"
          aria-describedby="fsw-subtitle"
          // A failed or uncertain switch is never dismissed by a stray click.
          onInteractOutside={(e) => { if (operationId) e.preventDefault(); }}
        >
          <header className="flex items-start gap-3 border-b px-5 pb-4 pt-5" style={{ borderColor: 'var(--fsw-border)' }}>
            <span className="grid size-10 shrink-0 place-items-center rounded-xl" style={{ background: 'color-mix(in srgb, var(--fsw-accent) 16%, transparent)' }}>
              <ArrowLeftRight className="size-[18px] fsw-accent" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="fsw-title">Switch Facility</DialogPrimitive.Title>
              <DialogPrimitive.Description id="fsw-subtitle" className="fsw-muted mt-0.5 text-[13px]">
                Move this order item to another fulfilment location
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close className="fsw-btn !min-h-[40px] !px-2.5" aria-label="Close">
              <X className="size-4" />
            </DialogPrimitive.Close>
          </header>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4" aria-live="polite">
            <StateBanner view={view} blocker={pf?.blocker ?? null} error={options.error ?? preflight.error ?? start.error} operation={operation} data={data ?? null} />

            {operationId ? (
              <OperationPanel operation={operation} showDetail={showDetail} />
            ) : data ? (
              <>
                <OrderSummary data={data} item={selected} />
                {data.items.length > 1 ? (
                  <ItemPicker items={data.items} selected={selected?.code ?? null} onSelect={(code) => { setItem(code); setTarget(null); preflight.reset(); }} />
                ) : null}
                {selected ? (
                  <>
                    <CurrentFacility data={data} />
                    <TargetFacilities rows={data.facilities} target={target} onChoose={choose} disabled={preflight.isPending} />
                    <ValidationSummary checks={pf?.checks ?? data.checks} />
                    {target && pf ? (
                      <Confirmation
                        item={selected} data={data} pf={pf} reason={reason} onReason={setReason}
                        remaining={remaining} expired={expired} onRecheck={() => choose(target)}
                      />
                    ) : null}
                  </>
                ) : data.items.length === 0 ? null : (
                  <p className="fsw-muted text-[13px]">Choose the exact item to move. Each unit is a separate Unicommerce item.</p>
                )}
              </>
            ) : null}
          </div>

          <footer className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3.5" style={{ borderColor: 'var(--fsw-border)' }}>
            {operationId ? (
              <OperationFooter
                operation={operation}
                orderId={orderId}
                onClose={() => onOpenChange(false)}
                onVerify={() => verify.mutate()}
                verifying={verify.isPending}
                showDetail={showDetail}
                onToggleDetail={() => setShowDetail((v) => !v)}
              />
            ) : (
              <>
                <DialogPrimitive.Close className="fsw-btn">Cancel</DialogPrimitive.Close>
                <button type="button" className="fsw-btn" onClick={refresh} disabled={options.isFetching || start.isPending}>
                  <RefreshCw className={`size-4 ${options.isFetching ? 'animate-spin' : ''}`} /> Refresh Availability
                </button>
                <button
                  type="button"
                  className="fsw-btn fsw-btn-primary"
                  disabled={!canConfirm}
                  onClick={confirm}
                  title={
                    view !== 'READY' ? 'Every check has to pass first.'
                    : !reasonOk ? 'Give a reason for the switch.'
                    : undefined
                  }
                >
                  {start.isPending ? 'Switching Facility…' : 'Confirm Facility Switch'}
                </button>
              </>
            )}
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ----------------------------------------------------------------- views */

type View =
  | 'INITIAL_LOADING' | 'LOAD_FAILED' | 'SELECT' | 'CHECKING' | 'READY' | 'BLOCKED' | 'STOCK_CHANGED'
  | 'EXPIRED' | 'CHECK_FAILED' | 'EXECUTING' | 'VERIFYING' | 'VERIFIED_SUCCESS' | 'VERIFIED_FAILURE'
  | 'VERIFICATION_PENDING' | 'RECONCILIATION_REQUIRED' | 'EXEC_BLOCKED';

function operationView(op: SwitchOperation): View {
  switch (op.status) {
    case 'VERIFIED_SUCCESS': return 'VERIFIED_SUCCESS';
    case 'VERIFIED_FAILURE': return 'VERIFIED_FAILURE';
    case 'VERIFICATION_PENDING': return 'VERIFICATION_PENDING';
    case 'RECONCILIATION_REQUIRED': return 'RECONCILIATION_REQUIRED';
    case 'BLOCKED': return 'EXEC_BLOCKED';
    case 'VERIFYING': case 'API_ACCEPTED': return 'VERIFYING';
    default: return 'EXECUTING';
  }
}

const BANNERS: Record<View, { heading: string; message: string; tone: 'info' | 'ok' | 'warn' | 'err'; busy?: boolean }> = {
  INITIAL_LOADING: { heading: 'Checking facility availability', message: 'Fetching the latest order and inventory information.', tone: 'info', busy: true },
  LOAD_FAILED: { heading: 'Unicommerce could not be read', message: 'Nothing has changed. Try Refresh Availability.', tone: 'err' },
  SELECT: { heading: 'Choose a facility', message: 'Pick where this item should be fulfilled from. Each choice is checked live before you can confirm.', tone: 'info' },
  CHECKING: { heading: 'Checking this facility', message: 'Re-reading the order, the item and stock at the facility you chose.', tone: 'info', busy: true },
  READY: { heading: 'Facility switch available', message: 'The selected item passed the current eligibility checks.', tone: 'ok' },
  BLOCKED: { heading: 'Facility switch unavailable', message: '', tone: 'err' },
  STOCK_CHANGED: { heading: 'Inventory availability changed', message: 'The selected target no longer has sufficient verified stock. Refresh or choose another facility.', tone: 'warn' },
  EXPIRED: { heading: 'The checks have expired', message: 'Confirmation is only valid for 30 seconds after the checks. Check again to continue.', tone: 'warn' },
  CHECK_FAILED: { heading: 'The checks could not run', message: 'Nothing has changed. Try again.', tone: 'err' },
  EXECUTING: { heading: 'Switching facility', message: 'Processing the selected line item through Unicommerce.', tone: 'info', busy: true },
  VERIFYING: { heading: 'Verifying the new facility', message: 'The request has been processed. Confirming the updated assignment.', tone: 'info', busy: true },
  VERIFIED_SUCCESS: { heading: 'Facility switched successfully', message: 'The selected item is now assigned to the verified target facility.', tone: 'ok' },
  VERIFIED_FAILURE: { heading: 'Facility switch failed', message: '', tone: 'err' },
  VERIFICATION_PENDING: { heading: 'Switch status needs verification', message: 'The external result is uncertain. Do not submit another switch until the current operation is reconciled.', tone: 'warn' },
  RECONCILIATION_REQUIRED: { heading: 'Production review required', message: 'Facility reassignment is confirmed, but linked manufacturing demand still needs review.', tone: 'warn' },
  EXEC_BLOCKED: { heading: 'Facility switch stopped before sending', message: '', tone: 'err' },
};

function StateBanner({
  view, blocker, error, operation, data,
}: { view: View; blocker: Check | null; error: unknown; operation: SwitchOperation | null; data: Options | null }) {
  const b = BANNERS[view];
  const message =
    view === 'BLOCKED' ? (blocker?.detail ?? (data && !data.order.found ? 'Unicommerce has no sale order for this order, so there is nothing to switch.' : 'A check did not pass.'))
    : view === 'VERIFIED_FAILURE' || view === 'EXEC_BLOCKED' ? `${operation?.failure?.message ?? 'The switch did not happen.'} Reference ${operation?.reference ?? ''}.`
    : view === 'LOAD_FAILED' || view === 'CHECK_FAILED' ? `${error instanceof ApiError ? error.message : 'The request failed.'} Nothing has changed.`
    : b.message;
  const Icon = b.tone === 'ok' ? Check : b.tone === 'warn' ? AlertTriangle : b.tone === 'err' ? AlertTriangle : Clock;
  const tone = b.tone === 'ok' ? 'fsw-panel-tone-ok' : b.tone === 'warn' ? 'fsw-panel-tone-warn' : b.tone === 'err' ? 'fsw-panel-tone-err' : '';
  const color = b.tone === 'ok' ? 'fsw-ok' : b.tone === 'warn' ? 'fsw-warn' : b.tone === 'err' ? 'fsw-err' : 'fsw-accent';
  return (
    <div className={`fsw-card ${tone} px-3.5 py-3`} role={b.tone === 'err' ? 'alert' : 'status'}>
      <div className="flex items-start gap-2.5">
        <Icon className={`mt-0.5 size-4 shrink-0 ${color} ${view === 'VERIFIED_SUCCESS' ? 'fsw-pop' : ''} ${b.busy ? 'fsw-pulse' : ''}`} aria-hidden />
        <div className="min-w-0">
          <p className="fsw-h">{b.heading}</p>
          <p className="fsw-muted mt-0.5 text-[13px] leading-snug">{message}</p>
        </div>
      </div>
      {b.busy ? <div className="fsw-progress mt-3" aria-hidden /> : null}
    </div>
  );
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="fsw-card px-3.5 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="fsw-h">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Facts({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
      {items.map((f) => (
        <div key={f.label} className="min-w-0">
          <dt className="fsw-muted text-[12px]">{f.label}</dt>
          <dd className="truncate">{f.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

function OrderSummary({ data, item }: { data: Options; item: Item | null }) {
  const mo = data.production?.orders[0] ?? null;
  return (
    <Section title="Order summary">
      <Facts
        items={[
          { label: 'Order', value: data.order.orderName },
          { label: 'Unicommerce order', value: data.order.saleOrderCode ? <span className="font-mono">{data.order.saleOrderCode}</span> : 'Not found' },
          { label: 'SKU', value: item?.sku ? <span className="font-mono">{item.sku}</span> : '—' },
          { label: 'Item', value: item?.itemName ?? data.line?.title ?? '—' },
          { label: 'Unfulfilled', value: data.line ? `${fmtQty(data.line.openQty, 0)} of ${fmtQty(data.line.orderedQty, 0)}` : '—' },
          { label: 'Manufacturing', value: mo ? `${mo.moNo} · ${mo.stage ?? humanise(mo.status)}` : data.production?.demand ? `${data.production.demand.demandNo} · ${humanise(data.production.demand.status)}` : 'None' },
          { label: 'Expected dispatch', value: data.production?.demand?.requiredByDate ? fmtDate(data.production.demand.requiredByDate) : data.line?.requiredByDate ? fmtDate(data.line.requiredByDate) : '—' },
          { label: 'Priority', value: humanise(data.production?.demand?.priority ?? data.line?.priority ?? 'NORMAL') },
        ]}
      />
    </Section>
  );
}

function ItemPicker({ items, selected, onSelect }: { items: Item[]; selected: string | null; onSelect: (code: string) => void }) {
  return (
    <Section title="Choose the exact item">
      <p className="fsw-muted mb-2 text-[12.5px]">Unicommerce holds one item per unit. Only the item you pick is moved.</p>
      <div role="radiogroup" aria-label="Sale order item" className="space-y-1.5">
        {items.map((i) => (
          <button key={i.code} type="button" role="radio" aria-checked={selected === i.code} className="fsw-option" onClick={() => onSelect(i.code)}>
            <span className="fsw-radio" aria-hidden />
            <span className="min-w-0">
              <span className="block truncate font-medium">{i.itemName ?? i.lineTitle ?? i.sku}</span>
              <span className="fsw-muted block truncate font-mono text-[12px]">{i.code} · {i.sku}</span>
            </span>
            <span className="fsw-muted text-right text-[12px]">
              {i.facilityCode}<br />{humanise(i.statusCode ?? 'UNKNOWN')}
            </span>
          </button>
        ))}
      </div>
    </Section>
  );
}

function CurrentFacility({ data }: { data: Options }) {
  const c = data.current!;
  return (
    <Section title="Current facility">
      <Facts
        items={[
          { label: 'Facility', value: c.name ?? c.code },
          { label: 'Code', value: <span className="font-mono">{c.code}</span> },
          { label: 'Available here', value: c.availableQty === null ? 'Not readable' : fmtQty(c.availableQty, 0) },
          { label: 'Item status', value: humanise(c.statusCode ?? 'UNKNOWN') },
          { label: 'Shipping package', value: c.shippingPackageStatus ? humanise(c.shippingPackageStatus) : 'None yet' },
        ]}
      />
    </Section>
  );
}

function TargetFacilities({
  rows, target, onChoose, disabled,
}: { rows: FacilityRow[]; target: string | null; onChoose: (code: string) => void; disabled: boolean }) {
  const checkedAt = rows.map((r) => r.checkedAt).filter(Boolean).sort().at(-1);
  const others = rows.filter((r) => !r.isCurrent);
  return (
    <Section
      title="Target facility"
      aside={checkedAt ? <span className="fsw-muted text-[12px]">Inventory checked {timeOf(checkedAt)}</span> : null}
    >
      <div role="radiogroup" aria-label="Target facility" className="space-y-1.5">
        {others.map((f) => (
          <button
            key={f.code}
            type="button"
            role="radio"
            aria-checked={target === f.code}
            disabled={!f.eligible || disabled}
            className="fsw-option"
            onClick={() => onChoose(f.code)}
          >
            <span className="fsw-radio" aria-hidden />
            <span className="min-w-0">
              <span className="block truncate font-medium">{f.name ?? f.code}</span>
              <span className="fsw-muted block truncate text-[12px]">
                <span className="font-mono">{f.code}</span> · {humanise(f.kind)}
                {f.eligible ? null : <span className={f.visible ? 'fsw-err' : 'fsw-warn'}> · {f.restriction}</span>}
              </span>
            </span>
            <span className="text-right">
              <span className={`num block text-[15px] font-semibold ${f.eligible ? 'fsw-ok' : ''}`}>
                {f.availableQty === null ? '—' : fmtQty(f.availableQty, 0)}
              </span>
              <span className="fsw-muted block text-[11px]">{f.availableQty === null ? 'unknown' : 'available'}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="fsw-muted mt-2 text-[12px] leading-snug">
        Available is Unicommerce&rsquo;s own &ldquo;available quantity&rdquo;. It is not a reservation; stock is checked again just before the switch is sent.
      </p>
    </Section>
  );
}

function ValidationSummary({ checks }: { checks: Check[] }) {
  if (checks.length === 0) return null;
  return (
    <Section title="Validation summary">
      <ul className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {checks.map((c) => (
          <li key={c.code} className="flex items-start gap-2 text-[13px]" title={c.detail}>
            {c.state === 'PASS' ? <Check className="mt-0.5 size-3.5 shrink-0 fsw-ok" aria-label="Passed" />
              : c.state === 'FAIL' ? <X className="mt-0.5 size-3.5 shrink-0 fsw-err" aria-label="Failed" />
              : <CircleHelp className="mt-0.5 size-3.5 shrink-0 fsw-warn" aria-label="Unknown" />}
            <span className="min-w-0">
              <span className="block">{c.label}</span>
              {c.state !== 'PASS' ? <span className="fsw-muted block text-[12px] leading-snug">{c.detail}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Confirmation({
  item, data, pf, reason, onReason, remaining, expired, onRecheck,
}: {
  item: Item; data: Options; pf: Preflight; reason: string; onReason: (v: string) => void;
  remaining: number; expired: boolean; onRecheck: () => void;
}) {
  return (
    <Section
      title="Confirm"
      aside={pf.token ? (
        expired
          ? <button type="button" className="fsw-btn !min-h-[32px] !px-2.5 text-[12.5px]" onClick={onRecheck}><RefreshCw className="size-3.5" /> Check again</button>
          : <span className="fsw-muted inline-flex items-center gap-1 text-[12px]"><Clock className="size-3" /> Valid for {remaining}s</span>
      ) : null}
    >
      <div className="flex items-center gap-2 text-[14px]">
        <span className="font-mono">{item.facilityCode}</span>
        <ArrowRight className="size-4 fsw-accent" aria-label="to" />
        <span className="font-mono font-semibold">{pf.target.code}</span>
      </div>
      <p className="fsw-muted mt-1 text-[12.5px]">
        1 unit · item <span className="font-mono">{item.code}</span> · {item.sku}
      </p>
      {data.production?.demand ? (
        <div className="fsw-card fsw-panel-tone-warn mt-2.5 px-3 py-2 text-[12.5px] leading-snug">
          Manufacturing demand {data.production.demand.demandNo} is {humanise(data.production.demand.status).toLowerCase()} for this line.
          A verified switch will flag it for review. Nothing in production is changed automatically.
        </div>
      ) : null}
      <label className="mt-3 block">
        <span className="fsw-muted mb-1 block text-[12.5px]">Reason for switch</span>
        <textarea
          className="fsw-field"
          rows={2}
          maxLength={500}
          value={reason}
          onChange={(e) => onReason(e.target.value)}
          placeholder="e.g. Inventory available at the Mumbai store"
        />
      </label>
    </Section>
  );
}

/* ------------------------------------------------------------- operation */

const STEPS = [
  { key: 'checks', label: 'Checks re-run', done: ['READY', 'EXECUTING', 'API_ACCEPTED', 'VERIFYING', 'VERIFIED_SUCCESS', 'VERIFIED_FAILURE', 'VERIFICATION_PENDING', 'RECONCILIATION_REQUIRED'] },
  { key: 'sent', label: 'Sent to Unicommerce', done: ['API_ACCEPTED', 'VERIFYING', 'VERIFIED_SUCCESS', 'VERIFIED_FAILURE', 'VERIFICATION_PENDING', 'RECONCILIATION_REQUIRED'] },
  { key: 'verify', label: 'New facility confirmed', done: ['VERIFIED_SUCCESS', 'RECONCILIATION_REQUIRED'] },
];

function OperationPanel({ operation: o, showDetail }: { operation: SwitchOperation | null; showDetail: boolean }) {
  if (!o) return null;
  const failedAt = o.status === 'BLOCKED' ? 0 : o.status === 'VERIFIED_FAILURE' ? 2 : o.status === 'VERIFICATION_PENDING' ? 2 : -1;
  return (
    <>
      <Section title="Progress" aside={<span className="fsw-muted font-mono text-[12px]">Ref {o.reference}</span>}>
        <ol className="space-y-2">
          {STEPS.map((s, i) => {
            const done = s.done.includes(o.status);
            const failed = i === failedAt;
            const active = !done && !failed && WORKING.includes(o.status) && (i === 0 || STEPS[i - 1]!.done.includes(o.status));
            return (
              <li key={s.key} className="flex items-center gap-2.5 text-[13.5px]">
                <span
                  className={`grid size-5 place-items-center rounded-full border ${done ? 'fsw-ok' : failed ? 'fsw-err' : ''} ${active ? 'fsw-pulse' : ''}`}
                  style={{ borderColor: 'currentColor' }}
                  aria-hidden
                >
                  {done ? <Check className="size-3" /> : failed ? <X className="size-3" /> : null}
                </span>
                <span className={done || active ? '' : 'fsw-muted'}>{s.label}</span>
              </li>
            );
          })}
        </ol>
      </Section>
      <Section title="Switch">
        <Facts
          items={[
            { label: 'From', value: <span className="font-mono">{o.sourceFacilityCode}</span> },
            { label: 'To', value: <span className="font-mono">{o.targetFacilityCode}</span> },
            { label: 'Item', value: <span className="font-mono">{o.saleOrderItemCode}</span> },
            { label: 'Verified at', value: o.verifiedFacilityCode ? <span className="font-mono">{o.verifiedFacilityCode}</span> : '—' },
            { label: 'Requested by', value: o.operator.name ?? '—' },
            { label: 'Reason', value: o.reason },
          ]}
        />
      </Section>
      {o.reconciliation?.reasons?.length ? (
        <Section title="Production to review">
          <ul className="list-disc space-y-1 pl-4 text-[13px]">
            {o.reconciliation.reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
          <p className="fsw-muted mt-2 text-[12.5px]">Nothing was cancelled or reversed. Decide whether the work continues, then mark the review done from Facility Switches.</p>
        </Section>
      ) : null}
      {o.api.warnings.length > 0 ? (
        <Section title="Unicommerce warnings">
          <ul className="space-y-1 text-[13px]">
            {o.api.warnings.map((w, i) => <li key={i} className="fsw-warn">{w.description ?? w.message}</li>)}
          </ul>
        </Section>
      ) : null}
      {showDetail ? (
        <Section title="What happened">
          <ul className="space-y-1 text-[12.5px]">
            {o.events.map((e, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>{humanise(e.type)}{e.errorCode ? <span className="fsw-err"> · {e.errorCode}</span> : null}</span>
                <span className="fsw-muted shrink-0">{timeOf(e.at)}</span>
              </li>
            ))}
          </ul>
          {o.api.errors.length > 0 ? (
            <p className="fsw-err mt-2 text-[12.5px]">{o.api.errors.map((e) => e.description ?? e.message).join(' · ')}</p>
          ) : null}
        </Section>
      ) : null}
    </>
  );
}

function OperationFooter({
  operation: o, orderId, onClose, onVerify, verifying, showDetail, onToggleDetail,
}: {
  operation: SwitchOperation | null; orderId: string; onClose: () => void; onVerify: () => void; verifying: boolean;
  showDetail: boolean; onToggleDetail: () => void;
}) {
  const status = o?.status ?? 'CREATED';
  const working = WORKING.includes(status);
  return (
    <>
      {working ? <span className="fsw-muted mr-auto text-[12px]">You can close this — the switch carries on and is recorded on the order.</span> : null}
      <button type="button" className="fsw-btn" onClick={onToggleDetail}>{showDetail ? 'Hide details' : status === 'VERIFIED_FAILURE' || status === 'BLOCKED' ? 'Review Issue' : 'View Details'}</button>
      {status === 'VERIFICATION_PENDING' || (working && status !== 'CREATED') ? (
        <button type="button" className="fsw-btn" onClick={onVerify} disabled={verifying}>
          <RefreshCw className={`size-4 ${verifying ? 'animate-spin' : ''}`} /> Check Status
        </button>
      ) : null}
      {status === 'RECONCILIATION_REQUIRED' ? (
        <Link className="fsw-btn" href="/demand" onClick={onClose}>View Manufacturing Demand</Link>
      ) : null}
      {status === 'VERIFIED_SUCCESS' || status === 'RECONCILIATION_REQUIRED' ? (
        <Link className="fsw-btn fsw-btn-primary" href={`/orders/${orderId}`} onClick={onClose}>View Updated Order</Link>
      ) : (
        <button type="button" className="fsw-btn" onClick={onClose}>Close</button>
      )}
    </>
  );
}

/* --------------------------------------------------------------- history */

/** Every switch on an order, for the order page. Hidden without audit access. */
export function FacilitySwitchHistory({ orderId }: { orderId: string }) {
  const { can } = useAuth();
  const allowed = can('demand.switch_facility') || can('admin.view_audit_log');
  const q = useQuery({
    queryKey: ['facility-switch-history', orderId],
    queryFn: () => api.get<SwitchOperation[]>(`/orders/${orderId}/facility-switch/history`),
    enabled: allowed,
  });
  if (!allowed || !q.data || q.data.length === 0) return null;
  return (
    <div className="glass rounded-3xl">
      <div className="border-b border-line px-5 py-3.5">
        <h2 className="t-card-title text-ink">Facility switches</h2>
        <p className="mt-0.5 text-[13px] text-ink-muted">Every request to move an item, and what Unicommerce showed afterwards.</p>
      </div>
      <ul className="divide-y divide-line">
        {q.data.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-[13px]">
            <span className="font-mono text-ink">{o.sourceFacilityCode} → {o.targetFacilityCode}</span>
            <SwitchStatusBadge status={o.status} />
            <span className="text-ink-muted">{o.operator.name ?? '—'} · {fmtDate(o.createdAt)} {timeOf(o.createdAt)}</span>
            <span className="min-w-0 flex-1 truncate text-ink-subtle">{o.reason}</span>
            <span className="font-mono text-[12px] text-ink-subtle">{o.reference}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SwitchStatusBadge({ status }: { status: string }) {
  const tone =
    status === 'VERIFIED_SUCCESS' ? 'text-ok border-ok/40'
    : status === 'VERIFIED_FAILURE' || status === 'BLOCKED' ? 'text-danger border-danger/40'
    : status === 'VERIFICATION_PENDING' || status === 'RECONCILIATION_REQUIRED' ? 'text-warn border-warn/40'
    : 'text-ink-muted border-line';
  const label: Record<string, string> = {
    VERIFIED_SUCCESS: 'Switched', VERIFIED_FAILURE: 'Failed', BLOCKED: 'Stopped before sending',
    VERIFICATION_PENDING: 'Needs verification', RECONCILIATION_REQUIRED: 'Production review',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[12px] font-medium ${tone}`}>
      {label[status] ?? humanise(status)}
    </span>
  );
}

/* --------------------------------------------------------------- helpers */

function useCountdown(until: string | null): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!until) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.ceil((new Date(until).getTime() - now) / 1000)) : 0;
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
