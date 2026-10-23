'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ button */

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded font-medium transition-colors ' +
    'disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-brand text-white hover:bg-brand-strong',
        default: 'bg-surface text-ink border border-line-strong hover:bg-surface-muted',
        ghost: 'text-ink-muted hover:bg-surface-muted hover:text-ink',
        danger: 'bg-danger text-white hover:brightness-90',
        // For actions that create or destroy value. Visually distinct so an
        // operator notices before clicking, not after.
        elevated: 'bg-warn-soft text-ink border border-warn/40 hover:bg-warn/15',
      },
      size: {
        sm: 'h-7 px-2.5 text-[12px] [&_svg]:size-3.5',
        md: 'h-8 px-3 text-[13px] [&_svg]:size-4',
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
        'h-8 w-full rounded border border-line-strong bg-surface px-2 text-[13px] text-ink',
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
      'w-full rounded border border-line-strong bg-surface px-2 py-1.5 text-[13px] text-ink',
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
      'h-8 w-full rounded border border-line-strong bg-surface px-2 text-[13px] text-ink',
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
    <label className={cn('block text-[12px] font-medium text-ink-muted', className)} {...props}>
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
      {message ? <p className="text-[11.5px] text-danger">{message}</p> : null}
    </div>
  );
}

/* -------------------------------------------------------------------- card */

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-lg border border-line bg-surface', className)} {...props}>
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
    <div className={cn('flex items-start justify-between gap-3 border-b border-line px-4 py-3', className)}>
      <div className="min-w-0">
        <h2 className="truncate text-[13.5px] font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-[12px] text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('px-4 py-3', className)}>{children}</div>;
}

/* ------------------------------------------------------------------- badge */

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium leading-tight whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-neutral-soft text-ink-muted',
        brand: 'bg-brand-soft text-brand-strong',
        ok: 'bg-ok-soft text-ok',
        warn: 'bg-warn-soft text-warn',
        danger: 'bg-danger-soft text-danger',
        info: 'bg-info-soft text-info',
        outline: 'border border-line-strong bg-surface text-ink-muted',
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
  // purchasing
  PARTIALLY_RECEIVED: 'info', RECEIVED: 'ok', PENDING_INSPECTION: 'warn',
  INSPECTED: 'info', POSTED: 'ok',
  // inspection
  PASS: 'ok', FAIL: 'danger', REWORK: 'warn', HOLD: 'warn',
  // stock alert levels
  OK: 'ok', AT_REORDER_LEVEL: 'info', BELOW_MINIMUM: 'warn', OUT_OF_STOCK: 'danger',
  // fabric rolls
  QC_PENDING: 'warn', AVAILABLE: 'ok', PARTIALLY_ISSUED: 'info',
  ISSUED: 'neutral', EXHAUSTED: 'neutral', BLOCKED: 'danger', RETURNED_TO_SUPPLIER: 'neutral',
  // sync
  SYNC_PENDING: 'warn', SYNC_SUCCESS: 'ok', SYNC_FAILED: 'danger',
  RECONCILIATION_REQUIRED: 'danger', RECONCILED: 'ok', NOT_REQUIRED: 'neutral',
  // location kinds
  PHYSICAL: 'outline', PRODUCTION_FLOOR: 'info', JOB_WORKER: 'info',
  QUALITY_HOLD: 'warn', IN_TRANSIT: 'info', SINK: 'neutral', COUNTERPARTY: 'neutral',
  // severities
  CRITICAL: 'danger', WARNING: 'warn', INFO: 'info',
};

export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  if (!status) return <span className="text-ink-subtle">-</span>;
  const tone = STATUS_TONES[status] ?? 'neutral';
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
    <div className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-ink-muted">
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
      {Icon ? <Icon className="size-7 text-ink-subtle" /> : null}
      <p className="text-[13px] font-medium text-ink">{title}</p>
      {description ? <p className="max-w-md text-[12.5px] text-ink-muted">{description}</p> : null}
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
    <div className={cn('rounded-lg border border-danger/30 bg-danger-soft px-4 py-3', className)}>
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">{e?.message ?? 'Something went wrong'}</p>
          {e?.code ? (
            <p className="mt-0.5 font-mono text-[11px] text-ink-muted">{e.code}</p>
          ) : null}

          {details && Object.keys(details).length > 0 ? (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11.5px]">
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
              <span className="font-mono text-[10.5px] text-ink-subtle">ref {e.requestId}</span>
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
    <div className="mb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[17px] font-semibold tracking-tight text-ink">{title}</h1>
          {description ? <p className="mt-0.5 text-[12.5px] text-ink-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

/** A labelled figure. `hint` carries the definition, which matters a lot here:
 *  "available" and "on hand" are different numbers and users must see which. */
export function Stat({
  label,
  value,
  hint,
  tone,
  href,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'default' | 'ok' | 'warn' | 'danger' | 'info';
  href?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const toneClass =
    tone === 'ok' ? 'text-ok'
    : tone === 'warn' ? 'text-warn'
    : tone === 'danger' ? 'text-danger'
    : tone === 'info' ? 'text-info'
    : 'text-ink';

  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11.5px] font-medium uppercase tracking-wide text-ink-subtle">{label}</p>
        {Icon ? <Icon className="size-3.5 shrink-0 text-ink-subtle" /> : null}
      </div>
      <p className={cn('num mt-1 text-[22px] font-semibold leading-none tracking-tight', toneClass)}>{value}</p>
      {hint ? <p className="mt-1 text-[11.5px] text-ink-muted">{hint}</p> : null}
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        className="block rounded-lg border border-line bg-surface px-3.5 py-3 transition-colors hover:border-line-strong hover:bg-surface-muted"
      >
        {inner}
      </a>
    );
  }
  return <div className="rounded-lg border border-line bg-surface px-3.5 py-3">{inner}</div>;
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
          <dt className="text-[11.5px] font-medium uppercase tracking-wide text-ink-subtle">{it.label}</dt>
          <dd className="mt-0.5 truncate text-[13px] text-ink">{it.value ?? '-'}</dd>
        </div>
      ))}
    </dl>
  );
}
