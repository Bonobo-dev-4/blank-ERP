'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TabDef<T extends string> {
  value: T;
  label: string;
  count?: number;
  icon?: React.ComponentType<{ className?: string }>;
}

/**
 * The tab strip.
 *
 * The same sliding slab the navigation rail uses, turned on its side. One
 * mechanism in two places is what makes a monochrome system feel designed
 * rather than merely colourless — you learn it once in the menu and already
 * know it here.
 *
 * The slab is measured from the DOM instead of computed from an index, so it
 * stays correct when a label is long, a count changes width, or the strip
 * wraps on a phone.
 */
export function Tabs<T extends string>({
  tabs, value, onChange, className, size = 'md',
}: {
  tabs: readonly TabDef<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [slab, setSlab] = React.useState<{ left: number; width: number } | null>(null);

  React.useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const measure = () => {
      const el = root.querySelector<HTMLElement>('[data-active="true"]');
      if (!el) { setSlab(null); return; }
      setSlab({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    for (const child of Array.from(root.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [value, tabs]);

  const onKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.value === value);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = e.key === 'ArrowRight'
        ? tabs[(i + 1) % tabs.length]
        : tabs[(i - 1 + tabs.length) % tabs.length];
      if (next) onChange(next.value);
    }
  };

  return (
    <div
      ref={ref}
      role="tablist"
      onKeyDown={onKey}
      className={cn(
        'slab-track ruled-baseline relative flex flex-wrap items-stretch gap-0.5 pb-px',
        className,
      )}
    >
      {slab ? (
        <span
          aria-hidden="true"
          // Sits on the baseline rule, the way a cursor sits on a ruler.
          className="slab bottom-0 h-[2.5px]"
          style={{ transform: `translateX(${slab.left}px)`, width: slab.width }}
        />
      ) : null}

      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            role="tab"
            aria-selected={active}
            data-active={active || undefined}
            onClick={() => onChange(t.value)}
            className={cn(
              'relative inline-flex items-center gap-1.5 whitespace-nowrap rounded-t-lg transition-colors duration-200',
              size === 'sm' ? 'px-3 py-1.5 text-[12.5px]' : 'px-3.5 py-2.5 text-[13.5px]',
              active ? 'font-semibold text-ink' : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
            )}
          >
            {t.icon ? <t.icon className="size-3.5" /> : null}
            {t.label}
            {t.count !== undefined ? (
              <span
                className={cn(
                  'num rounded-full px-2 py-px text-[11.5px] font-semibold tabular-nums',
                  // The count inverts on the active tab: the number you are
                  // looking at should be the heaviest mark in the strip.
                  active ? 'bg-ink text-canvas' : 'bg-surface-muted text-ink-muted',
                )}
              >
                {t.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
