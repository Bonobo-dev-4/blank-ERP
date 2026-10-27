'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarRange, Search, SlidersHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ---------------------------------------------------------------- types */

export interface FilterOption { value: string; label: string; count?: number }

export interface SelectFilter {
  key: string;
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}

export interface ToggleFilter {
  key: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export interface DateRangeFilter {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
}

export type SortDir = 'asc' | 'desc';
export interface SortState { key: string; dir: SortDir }

/* ------------------------------------------------------------ filter bar */

const iso = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));

const PRESETS: { label: string; days: number | null }[] = [
  { label: 'Today', days: 0 },
  { label: '7D', days: 6 },
  { label: '30D', days: 29 },
  { label: '90D', days: 89 },
];

/**
 * One filter bar for every table: search, dropdowns that show how many rows
 * each choice leaves, on/off toggles, a date range with quick presets, and a
 * single way back to "everything".
 *
 * Presentational — it neither fetches nor filters. Server-paginated lists
 * drive it from their query state; tables that hold all their rows drive it
 * from `useTableControls`.
 */
export function FilterBar({
  search, selects = [], toggles = [], dateRange, resultLabel, onClear, extra, className,
}: {
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  selects?: SelectFilter[];
  toggles?: ToggleFilter[];
  dateRange?: DateRangeFilter;
  resultLabel?: React.ReactNode;
  onClear?: () => void;
  extra?: React.ReactNode;
  className?: string;
}) {
  const active =
    (search?.value ? 1 : 0) +
    selects.filter((s) => s.value).length +
    toggles.filter((t) => t.checked).length +
    (dateRange && (dateRange.from || dateRange.to) ? 1 : 0);

  const presetActive = (days: number) =>
    dateRange?.from === daysAgo(days) && dateRange?.to === iso(new Date());

  return (
    <div className={cn('space-y-2.5', className)} role="search">
      <div className="flex flex-wrap items-center gap-2">
        {search ? (
          <div className="relative min-w-[200px] flex-1 sm:max-w-[320px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
            <input
              type="search"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder ?? 'Search'}
              aria-label={search.placeholder ?? 'Search'}
              className="h-9 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-8 text-[13.5px] text-ink placeholder:text-ink-subtle focus-visible:border-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-soft"
            />
            {search.value ? (
              <button
                type="button"
                onClick={() => search.onChange('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-ink-subtle hover:bg-surface-muted hover:text-ink"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        ) : null}

        {selects.map((s) => (
          <label key={s.key} className="relative">
            <span className="sr-only">{s.label}</span>
            <select
              value={s.value}
              onChange={(e) => s.onChange(e.target.value)}
              className={cn(
                'h-9 appearance-none rounded-lg border bg-surface pl-3 pr-8 text-[13px] text-ink [&>option]:bg-canvas',
                'focus-visible:border-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-soft',
                s.value ? 'border-brand/60 font-medium' : 'border-line-strong',
              )}
            >
              <option value="">{s.label}: all</option>
              {s.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}{o.count !== undefined ? ` (${o.count.toLocaleString('en-IN')})` : ''}
                </option>
              ))}
            </select>
            <SlidersHorizontal className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-subtle" />
          </label>
        ))}

        {toggles.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={t.checked}
            onClick={() => t.onChange(!t.checked)}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors',
              t.checked
                ? 'border-brand/60 bg-brand-soft text-ink'
                : 'border-line-strong text-ink-muted hover:bg-surface-muted hover:text-ink',
            )}
          >
            <span
              aria-hidden="true"
              className={cn('size-3.5 rounded-[4px] border', t.checked ? 'border-brand bg-brand' : 'border-line-strong')}
            />
            {t.label}
          </button>
        ))}

        {extra}

        <div className="ml-auto flex items-center gap-2">
          {resultLabel ? <span className="num text-[12.5px] text-ink-subtle" aria-live="polite">{resultLabel}</span> : null}
          {onClear && active > 0 ? (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-[13px] font-medium text-brand-strong hover:bg-brand-soft"
            >
              <X className="size-3.5" /> Clear {active > 1 ? `${active} filters` : 'filter'}
            </button>
          ) : null}
        </div>
      </div>

      {dateRange ? (
        <div className="flex flex-wrap items-center gap-2">
          <CalendarRange className="size-4 text-ink-subtle" aria-hidden="true" />
          <div role="group" aria-label="Quick date range" className="inline-flex h-8 items-center gap-0.5 rounded-lg border border-line bg-surface-muted p-0.5">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                aria-pressed={p.days !== null && presetActive(p.days)}
                onClick={() => dateRange.onChange({ from: daysAgo(p.days ?? 0), to: iso(new Date()) })}
                className={cn(
                  'h-full rounded-md px-2.5 text-[12.5px] font-medium transition-colors',
                  p.days !== null && presetActive(p.days) ? 'glass-raised text-ink' : 'text-ink-subtle hover:text-ink',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-[12.5px] text-ink-muted">
            From
            <input
              type="date"
              value={dateRange.from}
              max={dateRange.to || undefined}
              onChange={(e) => dateRange.onChange({ from: e.target.value, to: dateRange.to })}
              className="h-8 rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[12.5px] text-ink-muted">
            To
            <input
              type="date"
              value={dateRange.to}
              min={dateRange.from || undefined}
              onChange={(e) => dateRange.onChange({ from: dateRange.from, to: e.target.value })}
              className="h-8 rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink"
            />
          </label>
          {dateRange.from || dateRange.to ? (
            <button
              type="button"
              onClick={() => dateRange.onChange({ from: '', to: '' })}
              className="h-8 rounded-lg px-2 text-[12.5px] text-ink-subtle hover:bg-surface-muted hover:text-ink"
            >
              Any date
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ sort header */

/**
 * A column header that sorts. Clicking cycles descending → ascending for
 * numbers and dates (largest/newest first is the usual question), and
 * ascending → descending for text. The state is announced with aria-sort.
 */
export function SortTh({
  label, sortKey, sort, onSort, align = 'left', numeric, className,
}: {
  label: React.ReactNode;
  sortKey: string;
  sort: SortState | null;
  onSort: (key: string, firstDir: SortDir) => void;
  align?: 'left' | 'right' | 'center';
  /** Numbers and dates start descending. */
  numeric?: boolean;
  className?: string;
}) {
  const active = sort?.key === sortKey ? sort.dir : null;
  const Icon = active === 'asc' ? ArrowUp : active === 'desc' ? ArrowDown : ArrowUpDown;
  return (
    <th
      scope="col"
      aria-sort={active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none'}
      className={cn(
        'whitespace-nowrap px-3 py-2.5 font-semibold',
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey, numeric ? 'desc' : 'asc')}
        className={cn(
          'inline-flex items-center gap-1 rounded transition-colors hover:text-ink',
          align === 'right' && 'flex-row-reverse',
          active ? 'text-ink' : '',
        )}
      >
        {label}
        <Icon className={cn('size-3', active ? 'opacity-100' : 'opacity-50')} aria-hidden="true" />
      </button>
    </th>
  );
}

/** Next sort state for a header click. */
export function nextSort(current: SortState | null, key: string, firstDir: SortDir): SortState {
  if (current?.key !== key) return { key, dir: firstDir };
  return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
}

/* --------------------------------------------- client-side table controls */

type Getter<T> = (row: T) => string | number | null | undefined;

export interface ClientFilterDef<T> {
  key: string;
  label: string;
  get: (row: T) => string | null | undefined;
  /** How a raw value reads in the dropdown. */
  format?: (value: string) => string;
}

/**
 * Search, filter and sort for a table that already holds all its rows —
 * dashboards and reports. Options are derived from the rows themselves, each
 * with the number of rows it would leave.
 */
export function useTableControls<T>(
  rows: readonly T[] | undefined,
  opts: {
    search?: (row: T) => string;
    filters?: ClientFilterDef<T>[];
    toggles?: { key: string; label: string; test: (row: T) => boolean }[];
    sorts?: Record<string, Getter<T>>;
    defaultSort?: SortState | null;
  },
) {
  const [query, setQuery] = React.useState('');
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [on, setOn] = React.useState<Record<string, boolean>>({});
  const [sort, setSort] = React.useState<SortState | null>(opts.defaultSort ?? null);

  const all = rows ?? [];
  const needle = query.trim().toLowerCase();

  const passes = React.useCallback(
    (r: T, skipKey?: string) =>
      (!needle || (opts.search?.(r) ?? '').toLowerCase().includes(needle)) &&
      (opts.filters ?? []).every((f) => f.key === skipKey || !values[f.key] || (f.get(r) ?? '') === values[f.key]) &&
      (opts.toggles ?? []).every((t) => !on[t.key] || t.test(r)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [needle, values, on],
  );

  const visible = React.useMemo(() => {
    const out = all.filter((r) => passes(r));
    const get = sort ? opts.sorts?.[sort.key] : undefined;
    if (sort && get) {
      const m = sort.dir === 'asc' ? 1 : -1;
      out.sort((a, b) => {
        const x = get(a);
        const y = get(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1; // blanks last either way
        if (y == null) return -1;
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * m;
        return String(x).localeCompare(String(y), 'en-IN', { numeric: true, sensitivity: 'base' }) * m;
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, passes, sort]);

  // Each dropdown counts against every OTHER active filter, so its numbers
  // say what choosing it would actually leave.
  const selects: SelectFilter[] = (opts.filters ?? []).map((f) => {
    const counts = new Map<string, number>();
    for (const r of all) {
      if (!passes(r, f.key)) continue;
      const v = f.get(r);
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    if (values[f.key] && !counts.has(values[f.key]!)) counts.set(values[f.key]!, 0);
    return {
      key: f.key,
      label: f.label,
      value: values[f.key] ?? '',
      options: [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([value, count]) => ({ value, label: f.format ? f.format(value) : value, count })),
      onChange: (v: string) => setValues((s) => ({ ...s, [f.key]: v })),
    };
  });

  const toggles: ToggleFilter[] = (opts.toggles ?? []).map((t) => ({
    key: t.key,
    label: t.label,
    checked: !!on[t.key],
    onChange: (checked: boolean) => setOn((s) => ({ ...s, [t.key]: checked })),
  }));

  const clear = () => { setQuery(''); setValues({}); setOn({}); };

  return {
    rows: visible,
    total: all.length,
    sort,
    onSort: (key: string, firstDir: SortDir) => setSort((s) => nextSort(s, key, firstDir)),
    barProps: {
      search: opts.search ? { value: query, onChange: setQuery } : undefined,
      selects,
      toggles,
      onClear: clear,
      resultLabel: `${visible.length.toLocaleString('en-IN')} of ${all.length.toLocaleString('en-IN')}`,
    },
  };
}
