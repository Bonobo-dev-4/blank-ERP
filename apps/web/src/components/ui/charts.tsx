'use client';

import * as React from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { cn } from '@/lib/utils';

/**
 * Charts, monochrome.
 *
 * With no hue, a chart distinguishes series by FILL and WEIGHT: the series
 * being read is solid white, everything else is a translucent wash. That is
 * also the honest limit — these are built for one or two series. A monochrome
 * chart with six series is a chart nobody can read, and the right answer there
 * is a table, not more shades of grey.
 *
 * Axes and grid sit at low alpha so the data is the brightest thing in the
 * frame; a grid competing with the bars is a grid drawn for its own sake.
 */

// Amber reads the series you are meant to look at — the reference's orange —
// and a warm grey wash reads the rest. Still two fills, not six.
const JADE = 'oklch(0.63 0.14 55)';
const MUTED = 'oklch(0.4 0.03 60 / 0.4)';
const FAINT = 'oklch(0.35 0.03 60 / 0.14)';

const axis = {
  stroke: 'transparent',
  tick: { fill: 'oklch(0.5 0.025 278)', fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

function ChartTooltip({ active, payload, label, unit }: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; dataKey?: string }[];
  label?: string;
  unit?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-raised rounded-md px-2.5 py-1.5 text-[11.5px] shadow-lg">
      {label ? <p className="mb-0.5 font-medium text-ink">{label}</p> : null}
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="num text-ink-muted">
          {p.name ? `${p.name}: ` : ''}
          <span className="font-semibold text-ink">{p.value}</span>
          {unit ? ` ${unit}` : ''}
        </p>
      ))}
    </div>
  );
}

export interface SeriesPoint {
  label: string;
  value: number;
  /** Marks the bar as the one to look at — drawn solid rather than washed. */
  emphasis?: boolean;
}

/**
 * Bars.
 *
 * `highlightMax` solid-fills the tallest bar and washes the rest, which is the
 * monochrome way of saying "this is the one" without an arrow or a caption.
 */
export function BarSeries({
  data, height = 160, unit, highlightMax = true, className,
}: {
  data: SeriesPoint[];
  height?: number;
  unit?: string;
  highlightMax?: boolean;
  className?: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 0);
  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
          <CartesianGrid vertical={false} stroke={FAINT} />
          <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
          <YAxis {...axis} width={44} />
          <Tooltip
            cursor={{ fill: 'oklch(0.35 0.03 60 / 0.07)' }}
            content={<ChartTooltip unit={unit} />}
          />
          <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={34}>
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={d.emphasis ?? (highlightMax && d.value === max && max > 0) ? JADE : MUTED}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** A filled trend. One series only — see the note at the top of this file. */
export function TrendSeries({
  data, height = 160, unit, className,
}: {
  data: SeriesPoint[];
  height?: number;
  unit?: string;
  className?: string;
}) {
  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="dnd-trend" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={JADE} stopOpacity={0.28} />
              <stop offset="100%" stopColor={JADE} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={FAINT} />
          <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
          <YAxis {...axis} width={44} />
          <Tooltip cursor={{ stroke: MUTED }} content={<ChartTooltip unit={unit} />} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={JADE}
            strokeWidth={1.75}
            fill="url(#dnd-trend)"
            dot={false}
            activeDot={{ r: 3, fill: JADE, stroke: 'none' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * A horizontal share bar — how a total splits, in one line.
 *
 * Segments are told apart by descending opacity and are always labelled
 * underneath, because opacity alone is not a legend anyone can read.
 */
export function ShareBar({
  segments, className,
}: {
  segments: { label: string; value: number }[];
  className?: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total <= 0) {
    return <p className={cn('text-[12px] text-ink-subtle', className)}>Nothing to show yet.</p>;
  }
  return (
    <div className={className}>
      <div className="flex h-2.5 w-full overflow-hidden bg-surface-muted">
        {segments.map((s, i) => (
          s.value > 0 ? (
            <div
              key={s.label}
              className="h-full"
              style={{
                width: `${(s.value / total) * 100}%`,
                background: i === 0
                  ? 'oklch(0.63 0.14 55)'
                  : `oklch(0.38 0.03 60 / ${Math.max(0.16, 0.5 - (i - 1) * 0.16)})`,
              }}
              title={`${s.label}: ${s.value}`}
            />
          ) : null
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((s, i) => (
          <li key={s.label} className="flex items-center gap-1.5 text-[11.5px]">
            <span
              className="size-2 shrink-0 rounded-sm"
              style={{
                background: i === 0
                  ? 'oklch(0.63 0.14 55)'
                  : `oklch(0.38 0.03 60 / ${Math.max(0.16, 0.5 - (i - 1) * 0.16)})`,
              }}
            />
            <span className="text-ink-muted">{s.label}</span>
            <span className="num font-medium text-ink">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
