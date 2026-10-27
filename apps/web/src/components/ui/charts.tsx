'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { cn } from '@/lib/utils';
import type { Accent } from './primitives';

/**
 * Charts — semantic colour, both themes.
 *
 * Every colour is a CSS variable (`--chart-release`, `--chart-rejected` …)
 * defined per theme in globals.css, so a chart re-themes with the app and a
 * colour MEANS the same thing on every screen: blue is release, red is
 * rejected, emerald is completed. Series are never coloured at random, and
 * every chart also carries labels, so colour is never the only signal.
 */

export const accentVar = (a: Accent) => `var(--chart-${a})`;

/** Which semantic colour a production stage takes, from its own name. */
export function stageAccent(name: string, code = '', index = 0): Accent {
  const s = `${name} ${code}`.toLowerCase();
  if (/release/.test(s)) return 'release';
  if (/issue|material/.test(s)) return 'issue';
  if (/cut/.test(s)) return 'cutting';
  if (/stitch|sew|embroider/.test(s)) return 'stitching';
  if (/finish|press|iron|wash|pack/.test(s)) return 'finishing';
  if (/qc|quality|inspect/.test(s)) return 'qc';
  if (/rework/.test(s)) return 'rework';
  if (/dispatch|ready|handover|complete/.test(s)) return 'completed';
  const fallback: Accent[] = ['release', 'issue', 'cutting', 'stitching', 'finishing', 'qc', 'completed'];
  return fallback[index % fallback.length]!;
}

const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

const axis = {
  stroke: 'var(--chart-grid)',
  tick: { fill: 'var(--chart-axis)', fontSize: 12, fontFamily: 'var(--font-numeric)' },
  tickLine: false,
  axisLine: false,
} as const;

/* ------------------------------------------------------------- tooltip */

interface TipRow { name?: string; value?: number | string; dataKey?: string | number; color?: string; payload?: Record<string, unknown> }

export function ChartTooltip({
  active, payload, label, unit, labelFormatter,
}: {
  active?: boolean;
  payload?: TipRow[];
  label?: string | number;
  unit?: string;
  labelFormatter?: (l: string) => string;
}) {
  if (!active || !payload?.length) return null;
  const heading = label !== undefined ? (labelFormatter ? labelFormatter(String(label)) : String(label)) : null;
  return (
    <div className="glass-floating min-w-[150px] rounded-lg px-3 py-2 text-[12.5px]">
      {heading ? <p className="mb-1 font-semibold text-ink">{heading}</p> : null}
      <ul className="space-y-0.5">
        {payload.map((p) => {
          const colour = (p.payload?.fill as string | undefined) ?? p.color;
          return (
            <li key={String(p.dataKey ?? p.name)} className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: colour }} />
              <span className="flex-1 text-ink-muted">{p.name}</span>
              <span className="num font-semibold text-ink">
                {typeof p.value === 'number' ? fmt(p.value) : p.value}
                {unit ? <span className="ml-1 font-normal text-ink-subtle">{unit}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------- category bars */

export interface CategoryPoint {
  label: string;
  value: number;
  accent: Accent;
  href?: string;
}

/**
 * Rounded bars, one semantic colour per category, with a soft vertical
 * gradient so they read as lit glass rather than flat paint.
 */
export function CategoryBars({
  data, height = 220, unit, layout = 'vertical-bars', onSelect, className,
}: {
  data: CategoryPoint[];
  height?: number;
  unit?: string;
  /** 'vertical-bars' stands bars up; 'horizontal-bars' lays them down for long labels. */
  layout?: 'vertical-bars' | 'horizontal-bars';
  onSelect?: (p: CategoryPoint) => void;
  className?: string;
}) {
  const uid = React.useId().replace(/:/g, '');
  const horizontal = layout === 'horizontal-bars';
  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout={horizontal ? 'vertical' : 'horizontal'}
          margin={horizontal ? { top: 4, right: 16, bottom: 4, left: 4 } : { top: 8, right: 8, bottom: 0, left: -12 }}
          barCategoryGap={horizontal ? '28%' : '22%'}
        >
          <defs>
            {data.map((d, i) => (
              <linearGradient
                key={i}
                id={`${uid}-g${i}`}
                x1="0" y1="0"
                x2={horizontal ? '1' : '0'} y2={horizontal ? '0' : '1'}
              >
                <stop offset="0%" stopColor={accentVar(d.accent)} stopOpacity={horizontal ? 0.75 : 1} />
                <stop offset="100%" stopColor={accentVar(d.accent)} stopOpacity={horizontal ? 1 : 0.62} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid
            vertical={horizontal}
            horizontal={!horizontal}
            stroke="var(--chart-grid)"
            strokeDasharray="3 4"
          />
          {horizontal ? (
            <>
              <XAxis type="number" {...axis} allowDecimals={false} />
              <YAxis type="category" dataKey="label" {...axis} width={118} />
            </>
          ) : (
            <>
              <XAxis dataKey="label" {...axis} interval={0} />
              <YAxis {...axis} width={48} allowDecimals={false} />
            </>
          )}
          <Tooltip
            cursor={{ fill: 'var(--chart-cursor)', radius: 10 } as never}
            content={<ChartTooltip unit={unit} />}
          />
          <Bar
            dataKey="value"
            name={unit ? unit.replace(/^./, (c) => c.toUpperCase()) : 'Value'}
            radius={horizontal ? [0, 6, 6, 0] : [8, 8, 3, 3]}
            maxBarSize={horizontal ? 18 : 48}
            onClick={onSelect ? (_: unknown, i: number) => onSelect(data[i]!) : undefined}
            style={onSelect ? { cursor: 'pointer' } : undefined}
            isAnimationActive={false}
          >
            {data.map((d, i) => (
              <Cell key={i} fill={`url(#${uid}-g${i})`} stroke={accentVar(d.accent)} strokeOpacity={0.5} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------------------------------------------------- trend lines */

export interface TrendSeriesDef {
  key: string;
  label: string;
  accent: Accent;
}

/**
 * Multi-series trend: a clear stroke per series over a transparent gradient
 * fill. The legend is interactive — click a series to hide or show it —
 * and is keyboard operable.
 */
export function TrendChart({
  data, series, height = 260, unit, xFormatter, className,
}: {
  data: Record<string, number | string>[];
  series: TrendSeriesDef[];
  height?: number;
  unit?: string;
  xFormatter?: (v: string) => string;
  className?: string;
}) {
  const uid = React.useId().replace(/:/g, '');
  const [hidden, setHidden] = React.useState<Record<string, boolean>>({});
  const toggle = (k: string) => setHidden((h) => ({ ...h, [k]: !h[k] }));

  return (
    <div className={className}>
      <ul className="mb-3 flex flex-wrap gap-2" aria-label="Series">
        {series.map((s) => {
          const off = hidden[s.key];
          return (
            <li key={s.key}>
              <button
                type="button"
                aria-pressed={!off}
                onClick={() => toggle(s.key)}
                className={cn(
                  'inline-flex h-7 items-center gap-2 rounded-md px-2.5 text-[12.5px] font-medium transition-colors',
                  off ? 'text-ink-subtle line-through decoration-1 hover:text-ink-muted' : 'bg-surface-muted text-ink hover:bg-[var(--glass-surface-hover)]',
                )}
              >
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: off ? 'transparent' : accentVar(s.accent), boxShadow: `inset 0 0 0 2px ${accentVar(s.accent)}` }}
                />
                {s.label}
              </button>
            </li>
          );
        })}
      </ul>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
            <defs>
              {series.map((s) => (
                <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accentVar(s.accent)} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={accentVar(s.accent)} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 4" />
            <XAxis
              dataKey="date"
              {...axis}
              tickFormatter={xFormatter}
              minTickGap={24}
            />
            <YAxis {...axis} width={48} allowDecimals={false} />
            <Tooltip
              cursor={{ stroke: 'var(--chart-axis)', strokeDasharray: '3 3', strokeOpacity: 0.6 }}
              content={<ChartTooltip unit={unit} labelFormatter={xFormatter} />}
            />
            {series.map((s) =>
              hidden[s.key] ? null : (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={accentVar(s.accent)}
                  strokeWidth={2}
                  fill={`url(#${uid}-${s.key})`}
                  dot={false}
                  activeDot={{ r: 4.5, fill: accentVar(s.accent), stroke: 'var(--color-canvas)', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              ),
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- donut */

export interface Segment {
  label: string;
  value: number;
  accent: Accent;
  href?: string;
}

/**
 * Donut with the total in the centre and a legend that carries the
 * quantities, so the chart is readable without hovering anything.
 */
export function Donut({
  segments, centerLabel, size = 184, unit, className,
}: {
  segments: Segment[];
  centerLabel: string;
  size?: number;
  unit?: string;
  className?: string;
}) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  const shown = segments.filter((s) => s.value > 0);
  return (
    <div className={cn('flex flex-col items-center gap-5 sm:flex-row sm:items-center', className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip content={<ChartTooltip unit={unit} />} />
            <Pie
              data={shown.length ? shown : [{ label: 'None', value: 1, accent: 'neutral' as Accent }]}
              dataKey="value"
              nameKey="label"
              innerRadius="76%"
              outerRadius="100%"
              paddingAngle={shown.length > 1 ? 2 : 0}
              cornerRadius={4}
              stroke="none"
              isAnimationActive={false}
            >
              {(shown.length ? shown : [{ accent: 'neutral' as Accent }]).map((s, i) => (
                <Cell key={i} fill={accentVar(s.accent)} fillOpacity={shown.length ? 0.92 : 0.25} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="t-kpi text-ink">{fmt(total)}</span>
          <span className="mt-0.5 text-[12.5px] text-ink-subtle">{centerLabel}</span>
        </div>
      </div>
      <Legend segments={segments} total={total} className="w-full sm:flex-1" />
    </div>
  );
}

function Legend({ segments, total, className }: { segments: Segment[]; total: number; className?: string }) {
  return (
    <ul className={cn('space-y-1.5', className)}>
      {segments.map((s) => {
        const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
        const row = (
          <>
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: accentVar(s.accent) }} />
            <span className="flex-1 truncate text-ink-muted">{s.label}</span>
            <span className="num font-semibold text-ink">{fmt(s.value)}</span>
            <span className="num w-10 text-right text-ink-subtle">{pct}%</span>
          </>
        );
        return (
          <li key={s.label}>
            {s.href ? (
              <Link
                href={s.href}
                className="flex items-center gap-2.5 rounded-lg px-2 py-1 text-[13px] transition-colors hover:bg-surface-muted"
              >
                {row}
              </Link>
            ) : (
              <div className="flex items-center gap-2.5 px-2 py-1 text-[13px]">{row}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------------------------------------------------- segment bar */

/**
 * How a total splits, in one line — a stacked bar with a labelled legend
 * underneath, because a segment colour alone is not a legend.
 */
export function SegmentBar({
  segments, className, emptyText = 'Nothing to show yet.',
}: {
  segments: Segment[];
  className?: string;
  emptyText?: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total <= 0) {
    return <p className={cn('text-[12.5px] text-ink-subtle', className)}>{emptyText}</p>;
  }
  return (
    <div className={className}>
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-surface-muted">
        {segments.map((s) =>
          s.value > 0 ? (
            <div
              key={s.label}
              className="bar-grow h-full first:rounded-l-full last:rounded-r-full"
              style={{
                width: `${(s.value / total) * 100}%`,
                background: `linear-gradient(180deg, ${accentVar(s.accent)}, color-mix(in srgb, ${accentVar(s.accent)} 72%, transparent))`,
              }}
              title={`${s.label}: ${fmt(s.value)}`}
            />
          ) : null,
        )}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {segments.map((s) => {
          const body = (
            <>
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: accentVar(s.accent) }} />
              <span className="flex-1 truncate text-ink-muted">{s.label}</span>
              <span className="num font-semibold text-ink">{fmt(s.value)}</span>
            </>
          );
          return (
            <li key={s.label}>
              {s.href ? (
                <Link href={s.href} className="flex items-center gap-2 rounded-md text-[12.5px] hover:underline">
                  {body}
                </Link>
              ) : (
                <div className="flex items-center gap-2 text-[12.5px]">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------ radial progress */

/**
 * A single ratio as a ring — used where the number that matters is a rate,
 * such as first-pass yield. The value is drawn in the ring's own colour and
 * also printed in the centre, so the ring is never the only signal.
 */
export function RadialProgress({
  value, accent, label, size = 112, stroke = 9,
}: {
  /** 0–100 */
  value: number;
  accent: Accent;
  label: string;
  size?: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${pct.toFixed(1)}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--chart-grid)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={accentVar(accent)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * c} ${c}`}
          style={{ filter: `drop-shadow(0 0 6px color-mix(in srgb, ${accentVar(accent)} 45%, transparent))` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num text-[22px] font-semibold leading-none tracking-[-0.03em] text-ink">
          {pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1)}%
        </span>
        <span className="mt-1 text-[11.5px] text-ink-subtle">{label}</span>
      </div>
    </div>
  );
}
