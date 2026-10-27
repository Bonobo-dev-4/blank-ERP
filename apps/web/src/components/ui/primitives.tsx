'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import Link from 'next/link';
import { Info, Loader2, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlassTooltip } from './tooltip';

/* ------------------------------------------------------------------ button */

const buttonVariants = cva(
  'press inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium ' +
    'transition-[background-color,border-color,color,box-shadow,filter,transform] duration-200 ease-out ' +
    'disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0',
  {
    variants: {
      /*
       * Primary is a solid chip of the ink colour — near-white on night,
       * graphite on day — so it is the highest-contrast thing on the glass in
       * both themes. Destructive is an outline in the danger colour that FILLS
       * on hover: the moment of fill is the moment of pause.
       */
      variant: {
        primary: 'bg-ink text-canvas font-semibold shadow-sm hover:brightness-110',
        default: 'glass-raised text-ink hover:bg-[var(--glass-surface-elevated)] hover:brightness-105',
        ghost: 'text-ink-muted hover:bg-surface-muted hover:text-ink',
        danger:
          'border-[1.5px] border-danger bg-transparent font-semibold text-danger hover:bg-danger hover:text-canvas',
        // An unusual action, not a dangerous one: dashed, so it reads as
        // deliberate without borrowing the destructive treatment.
        elevated:
          'border border-dashed border-line-strong bg-transparent text-ink hover:bg-surface-muted',
      },
      size: {
        sm: 'h-8 px-3 text-[13px] [&_svg]:size-3.5',
        md: 'h-9 px-3.5 text-[13.5px] [&_svg]:size-4',
        lg: 'h-10 px-4 text-[14px] [&_svg]:size-4',
        icon: 'h-8 w-8 [&_svg]:size-4',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? <Loader2 className="animate-spin" /> : null}
        {children}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

/* ------------------------------------------------------------------- input */

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[14px] text-ink',
        'transition-[border-color,box-shadow] duration-200',
        'focus-visible:border-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-soft',
        'placeholder:text-ink-subtle disabled:bg-surface-muted disabled:text-ink-subtle',
        'aria-[invalid=true]:border-danger',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

/**
 * Quantity input.
 *
 * `inputMode="decimal"` so a tablet shows a numeric keypad, and the value is
 * kept as a STRING all the way to the API - never parsed to a float on the way
 * through, which is how a 4-decimal fabric length loses its last digit.
 */
export const QtyInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <Input
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={cn('num text-right', className)}
      {...props}
    />
  ),
);
QtyInput.displayName = 'QtyInput';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-[14px] text-ink',
      'transition-[border-color,box-shadow] duration-200',
      'focus-visible:border-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-soft',
      'placeholder:text-ink-subtle aria-[invalid=true]:border-danger',
      className,
    )}
    rows={3}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'h-9 w-full rounded-lg border border-line-strong bg-surface px-2.5 text-[14px] text-ink',
      'transition-[border-color,box-shadow] duration-200 [&>option]:bg-canvas [&>option]:text-ink',
      'focus-visible:border-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-soft',
      'disabled:bg-surface-muted disabled:text-ink-subtle aria-[invalid=true]:border-danger',
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
NativeSelect.displayName = 'NativeSelect';

/* ------------------------------------------------------------------- label */

export function Label({
  className,
  required,
  hint,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean; hint?: string }) {
  return (
    <label className={cn('block text-[13px] font-medium text-ink-muted', className)} {...props}>
      {children}
      {required ? <span className="ml-0.5 text-danger">*</span> : null}
      {hint ? <span className="ml-1.5 font-normal text-ink-subtle">{hint}</span> : null}
    </label>
  );
}

export function Field({
  label,
  required,
  hint,
  error,
  children,
  className,
}: {
  label?: string;
  required?: boolean;
  hint?: string;
  error?: string | string[];
  children: React.ReactNode;
  className?: string;
}) {
  const message = Array.isArray(error) ? error[0] : error;
  return (
    <div className={cn('space-y-1', className)}>
      {label ? (
        <Label required={required} hint={hint}>
          {label}
        </Label>
      ) : null}
      {children}
      {message ? <p className="text-[12px] font-medium text-danger">{message}</p> : null}
    </div>
  );
}

/* -------------------------------------------------------------------- card */

/**
 * A panel of glass. `material` picks the elevation: standard for ordinary
 * panels, elevated for the major analytical ones, dense for tables and forms.
 */
export function Card({
  className, children, material = 'standard', ...props
}: React.HTMLAttributes<HTMLDivElement> & { material?: 'standard' | 'elevated' | 'dense' }) {
  const cls = material === 'elevated' ? 'glass-elevated' : material === 'dense' ? 'glass-dense' : 'glass';
  return (
    <div className={cn(cls, 'rounded-3xl', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3 border-b border-line px-5 py-3.5', className)}>
      <div className="min-w-0">
        <h2 className="t-card-title truncate text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('px-5 py-4', className)}>{children}</div>;
}

/* ------------------------------------------------------------------- badge */

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-medium leading-tight whitespace-nowrap',
  {
    /*
     * One colour per business meaning, the same on every screen:
     *
     *   ok       emerald  completed, passed, healthy
     *   info     blue     in progress
     *   warn     amber    pending, waiting on someone
     *   hold     orange   on hold, rework
     *   danger   red      rejected, failed — FILLED, because it needs action
     *   violet   violet   quality check
     *   neutral  slate    cancelled, closed, inactive
     *
     * Every badge carries its word, so colour is reinforcement and never the
     * only signal; danger is also the only filled tone.
     */
    variants: {
      tone: {
        neutral: 'border-line bg-neutral-soft text-ink-muted',
        brand: 'border-transparent bg-brand font-semibold text-canvas',
        ok: 'border-ok/30 bg-ok-soft text-ok',
        warn: 'border-warn/35 bg-warn-soft font-semibold text-warn',
        hold: 'border-hold/35 bg-hold-soft font-semibold text-hold',
        danger: 'border-transparent bg-danger font-semibold text-canvas',
        info: 'border-info/30 bg-info-soft text-info',
        violet: 'border-violet/30 bg-violet-soft text-violet',
        outline: 'border-line-strong bg-transparent text-ink-muted',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

export function Badge({
  tone,
  className,
  children,
}: VariantProps<typeof badgeVariants> & { className?: string; children: React.ReactNode }) {
  return <span className={cn(badgeVariants({ tone }), className)}>{children}</span>;
}

/**
 * Status badge with one shared status-to-colour mapping.
 *
 * Centralised deliberately: if "REJECTED" were amber on one screen and red on
 * another, operators would stop trusting the colour and start reading every
 * label, which defeats the point of having them.
 */
const STATUS_TONES: Record<string, BadgeTone> = {
  // generic
  ACTIVE: 'ok', INACTIVE: 'neutral', ARCHIVED: 'neutral', DRAFT: 'neutral',
  // approvals
  PENDING_APPROVAL: 'warn', PENDING: 'warn', APPROVED: 'ok', REJECTED: 'danger',
  CANCELLED: 'neutral', CLOSED: 'neutral', CONVERTED: 'info',
  // manufacturing orders and stage tasks
  PENDING_MATERIAL: 'warn', MATERIAL_RESERVED: 'info', RELEASED: 'info', IN_PROGRESS: 'info',
  ON_HOLD: 'hold', COMPLETED: 'ok', NOT_STARTED: 'neutral', SKIPPED: 'neutral',
  // purchasing
  PARTIALLY_RECEIVED: 'info', RECEIVED: 'ok', PENDING_INSPECTION: 'violet',
  INSPECTED: 'violet', POSTED: 'ok',
  // inspection
  PASS: 'ok', FAIL: 'danger', REWORK: 'hold', HOLD: 'hold', QC_PASSED: 'ok', INWARDED: 'ok',
  // stock alert levels
  OK: 'ok', AT_REORDER_LEVEL: 'info', BELOW_MINIMUM: 'warn', OUT_OF_STOCK: 'danger',
  // fabric rolls
  QC_PENDING: 'violet', AVAILABLE: 'ok', PARTIALLY_ISSUED: 'info',
  ISSUED: 'neutral', EXHAUSTED: 'neutral', BLOCKED: 'danger', RETURNED_TO_SUPPLIER: 'neutral',
  // commerce orders and shipping
  OPEN: 'info', FULFILLED: 'ok', PROCESSING: 'info', COMPLETE: 'ok', DISPATCHED: 'ok',
  SHIPPED: 'ok', DELIVERED: 'ok', RETURNED: 'neutral',
  // demand and fulfilment routing
  NEEDS_MAPPING: 'warn', NEEDS_CHECK: 'warn', DISPATCH: 'ok', SWITCH_FACILITY: 'info',
  MANUFACTURE: 'violet',
  // sync
  SYNC_PENDING: 'warn', SYNC_SUCCESS: 'ok', SYNC_FAILED: 'danger', SUCCESS: 'ok', FAILED: 'danger',
  RECONCILIATION_REQUIRED: 'danger', RECONCILED: 'ok', NOT_REQUIRED: 'neutral',
  // location kinds
  PHYSICAL: 'outline', PRODUCTION_FLOOR: 'info', JOB_WORKER: 'info',
  QUALITY_HOLD: 'hold', IN_TRANSIT: 'info', SINK: 'neutral', COUNTERPARTY: 'neutral',
  // severities
  CRITICAL: 'danger', WARNING: 'warn', INFO: 'info',
};

export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  if (!status) return <span className="text-ink-subtle">-</span>;
  const tone = STATUS_TONES[status] ?? STATUS_TONES[status.toUpperCase()] ?? 'neutral';
  return (
    <Badge tone={tone} className={className}>
      {status.replace(/_/g, ' ').toLowerCase()}
    </Badge>
  );
}

/* ------------------------------------------------------- feedback & states */

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-ink-subtle', className)} />;
}

export function LoadingBlock({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-[13px] text-ink-muted">
      <Spinner />
      {label}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon: Icon,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {Icon ? (
        <span className="glass-inset mb-1 grid size-11 place-items-center rounded-2xl">
          <Icon className="size-5 text-ink-muted" />
        </span>
      ) : null}
      <p className="text-[14px] font-semibold text-ink">{title}</p>
      {description ? <p className="max-w-md text-[13px] text-ink-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/**
 * Error panel.
 *
 * Shows the API's machine-readable code and the actual numbers from `details`.
 * A storekeeper told "requested 300.0000, available 262.5000 at Fabric Room"
 * can fix the problem; one told "Conflict" has to find a developer.
 */
export function ErrorPanel({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const e = error as {
    message?: string;
    code?: string;
    details?: Record<string, unknown>;
    requestId?: string;
    isRetryable?: boolean;
  };
  const details = e?.details ?? undefined;

  return (
    <div role="alert" className={cn('rounded-2xl border border-danger/35 bg-danger-soft px-4 py-3.5', className)}>
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">{e?.message ?? 'Something went wrong'}</p>
          {e?.code ? (
            <p className="mt-0.5 font-mono text-[12px] text-ink-muted">{e.code}</p>
          ) : null}

          {details && Object.keys(details).length > 0 ? (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
              {Object.entries(details).map(([k, v]) => (
                <React.Fragment key={k}>
                  <dt className="text-ink-muted">{humaniseKey(k)}</dt>
                  <dd className="num font-medium text-ink">
                    {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                  </dd>
                </React.Fragment>
              ))}
            </dl>
          ) : null}

          <div className="mt-2 flex items-center gap-3">
            {onRetry ? (
              <Button size="sm" variant="default" onClick={onRetry}>
                Try again
              </Button>
            ) : null}
            {e?.requestId ? (
              <span className="font-mono text-[11px] text-ink-subtle">ref {e.requestId}</span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function humaniseKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
}

/* -------------------------------------------------------------- data shell */

export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="t-page-title text-ink">{title}</h1>
          {description ? <p className="mt-1 max-w-3xl text-[14px] text-ink-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

/** A semantic accent from the chart palette — the same meaning everywhere. */
export type Accent =
  | 'release' | 'issue' | 'cutting' | 'stitching' | 'finishing' | 'qc' | 'rework'
  | 'rejected' | 'completed' | 'inventory' | 'purchasing' | 'delayed' | 'hold' | 'neutral';

/**
 * A labelled figure on glass — the metric card.
 *
 * `hint` carries the definition, which matters a lot here: "available" and
 * "on hand" are different numbers and users must see which. `info` explains
 * the calculation in a tooltip; `sparkline` draws only when real history is
 * passed in, never as decoration.
 */
export function Stat({
  label,
  value,
  hint,
  tone,
  href,
  icon: Icon,
  accent,
  info,
  sparkline,
  footer,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: 'default' | 'ok' | 'warn' | 'danger' | 'info';
  href?: string;
  icon?: React.ComponentType<{ className?: string }>;
  accent?: Accent;
  info?: string;
  sparkline?: number[];
  footer?: React.ReactNode;
  className?: string;
}) {
  const toneClass =
    tone === 'ok' ? 'text-ok'
    : tone === 'warn' ? 'text-warn'
    : tone === 'danger' ? 'text-danger'
    : tone === 'info' ? 'text-info'
    : 'text-ink';

  // The icon chip takes the accent colour; a tone that needs attention
  // overrides it, so a red figure never sits beside a calm blue icon.
  const chipColour =
    tone === 'danger' ? 'var(--chart-rejected)'
    : tone === 'warn' ? 'var(--chart-qc)'
    : accent ? `var(--chart-${accent})`
    : 'var(--chart-neutral)';

  const showSpark = sparkline && sparkline.length > 1 && sparkline.some((v) => v !== 0);

  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="truncate text-[13px] font-medium text-ink-muted">{label}</p>
          {info ? <InfoHint text={info} /> : null}
        </div>
        {Icon ? (
          <span
            className="grid size-9 shrink-0 place-items-center rounded-full border shadow-[inset_0_1px_0_var(--glass-highlight),0_2px_8px_-2px_var(--glass-shadow)]"
            style={{
              color: chipColour,
              // A lit orb: brighter where the light falls, the accent deepening
              // toward the rim — tinted glass, not a flat swatch.
              background: `radial-gradient(circle at 32% 26%, color-mix(in srgb, ${chipColour} 26%, transparent), color-mix(in srgb, ${chipColour} 9%, transparent) 72%)`,
              borderColor: `color-mix(in srgb, ${chipColour} 26%, transparent)`,
            }}
            aria-hidden="true"
          >
            <Icon className="size-4" />
          </span>
        ) : null}
      </div>
      <div className="mt-2.5 flex items-end justify-between gap-3">
        <p className={cn('t-kpi', toneClass)}>{value}</p>
        {showSpark ? <Sparkline values={sparkline!} colour={chipColour} /> : null}
      </div>
      {hint ? <p className="mt-1.5 text-[13px] leading-snug text-ink-subtle">{hint}</p> : null}
      {footer ? <div className="mt-2">{footer}</div> : null}
    </>
  );

  // A tile that needs attention carries a rule down its edge, as well as
  // its colour, so it survives a bad panel and a colour-blind reader alike.
  const flagged = tone === 'danger' || tone === 'warn';
  const shell = cn(
    'glass flex h-full flex-col rounded-2xl px-[18px] py-4',
    flagged && (tone === 'danger' ? 'ring-1 ring-inset ring-danger/35' : 'ring-1 ring-inset ring-warn/35'),
    className,
  );

  if (href) {
    return (
      <Link href={href} className={cn(shell, 'glass-interactive')}>
        {inner}
      </Link>
    );
  }
  return <div className={shell}>{inner}</div>;
}

/** A small "how is this calculated" affordance, keyboard reachable. */
export function InfoHint({ text }: { text: string }) {
  return (
    <GlassTooltip content={text}>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
        aria-label={text}
        className="grid size-4 shrink-0 place-items-center rounded-full text-ink-subtle transition-colors hover:text-ink"
      >
        <Info className="size-3.5" />
      </button>
    </GlassTooltip>
  );
}

/** A tiny trend line. No axes: it shows shape, the card shows the number. */
export function Sparkline({
  values, colour, width = 84, height = 30,
}: {
  values: number[];
  colour: string;
  width?: number;
  height?: number;
}) {
  const id = React.useId();
  const max = Math.max(...values);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => [i * step, height - 2 - ((v - min) / span) * (height - 4)] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="shrink-0">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colour} stopOpacity={0.28} />
          <stop offset="100%" stopColor={colour} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={colour} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function Separator({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-line', className)} />;
}

/** Key/value grid for detail panels. */
export function DescList({
  items,
  columns = 2,
  className,
}: {
  items: readonly { label: string; value: React.ReactNode }[];
  columns?: 1 | 2 | 3 | 4;
  className?: string;
}) {
  const cols =
    columns === 1 ? 'sm:grid-cols-1'
    : columns === 2 ? 'sm:grid-cols-2'
    : columns === 3 ? 'sm:grid-cols-3'
    : 'sm:grid-cols-4';
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-2.5', cols, className)}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-[12.5px] font-medium text-ink-subtle">{it.label}</dt>
          <dd className="mt-0.5 truncate text-[14px] text-ink">{it.value ?? '-'}</dd>
        </div>
      ))}
    </dl>
  );
}
