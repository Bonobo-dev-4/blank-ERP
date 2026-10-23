'use client';

import * as React from 'react';
import { Button, Input, Label } from '@/components/ui/primitives';

export interface Window { from: string; to: string }

/** The last N days, as ISO dates. */
export function lastDays(n: number): Window {
  const to = new Date();
  const from = new Date(to.getTime() - n * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

const PRESETS: { label: string; days: number }[] = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
];

/**
 * The date window every report shares.
 *
 * Presets first, because "last 30 days" is what someone actually wants and
 * typing two dates to get it is friction. The exact inputs stay for the case
 * presets cannot express - a specific season, or one week being argued about.
 */
export function ReportWindow({
  value, onChange, children,
}: {
  value: Window;
  onChange: (w: Window) => void;
  children?: React.ReactNode;
}) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);

  const active = (days: number): boolean => {
    const p = lastDays(days);
    return p.from === value.from && p.to === value.to;
  };

  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2 rounded-lg border border-line bg-surface px-3 py-2.5">
      <div className="flex gap-1.5" role="group" aria-label="Date range presets">
        {PRESETS.map((p) => (
          <Button
            key={p.days}
            variant={active(p.days) ? 'primary' : 'default'}
            size="sm"
            onClick={() => onChange(lastDays(p.days))}
          >
            {p.label}
          </Button>
        ))}
      </div>

      <div className="flex items-end gap-2">
        <div>
          <Label htmlFor="rw-from" className="text-[11px]">From</Label>
          <Input
            id="rw-from" type="date" value={draft.from} className="h-8 w-[140px]"
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="rw-to" className="text-[11px]">To</Label>
          <Input
            id="rw-to" type="date" value={draft.to} className="h-8 w-[140px]"
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </div>
        <Button
          size="sm"
          variant="default"
          disabled={draft.from === value.from && draft.to === value.to}
          onClick={() => onChange(draft)}
        >
          Apply
        </Button>
      </div>

      {children ? <div className="ml-auto flex items-end gap-2">{children}</div> : null}
    </div>
  );
}

/** A number cell that reads as "nothing recorded" rather than a confident zero. */
export function Figure({ value, suffix }: { value: string | null; suffix?: string }) {
  if (value === null || value === undefined) {
    return <span className="text-ink-subtle">not recorded</span>;
  }
  return <span className="num">{value}{suffix ?? ''}</span>;
}
