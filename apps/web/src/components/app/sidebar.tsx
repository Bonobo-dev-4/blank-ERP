'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as Icons from 'lucide-react';
import { NAVIGATION, type NavItem } from '@dnd/contracts';
import { cn } from '@/lib/utils';
import { useAuth } from './auth-context';

function Icon({ name, className }: { name: string; className?: string }) {
  const Cmp = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[name];
  const Fallback = Icons.Circle;
  const C = Cmp ?? Fallback;
  return <C className={className} />;
}

/**
 * The navigation rail.
 *
 * A single white slab marks where you are and SLIDES to the item you pick,
 * rather than blinking on and off. In a monochrome system that movement is
 * what tells you the two places are related — the same slab runs along the
 * tab strips elsewhere, so the menu and the tabs read as one mechanism.
 *
 * Items for modules that are not built yet are rendered DISABLED with the
 * phase they are due in, not as links to an empty page. An operator who
 * clicks three dead links stops trusting the whole interface.
 */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user, can } = useAuth();
  const listRef = React.useRef<HTMLDivElement>(null);
  const [slab, setSlab] = React.useState<{ top: number; height: number } | null>(null);

  // Measure the active row and move the slab onto it. Measured from the DOM
  // rather than computed, so it stays right when a group is hidden by
  // permissions or the label wraps on a narrow rail.
  React.useLayoutEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const measure = () => {
      const el = root.querySelector<HTMLElement>('[data-active="true"]');
      if (!el) { setSlab(null); return; }
      // Measured from rects, not offsetTop: the rows sit inside a positioned
      // <ul>, so offsetTop would be relative to that rather than to the
      // track, and the slab would park near the top of the rail.
      const a = el.getBoundingClientRect();
      const b = root.getBoundingClientRect();
      setSlab({ top: a.top - b.top + root.scrollTop, height: a.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    root.addEventListener('scroll', measure, { passive: true });
    return () => {
      ro.disconnect();
      root.removeEventListener('scroll', measure);
    };
  }, [pathname, can]);

  /**
   * The ONE item that is active, chosen as the longest href the path matches.
   *
   * A plain `startsWith` makes both /orders and /orders/fulfilment active at
   * once. With a highlight on each that merely looked untidy; with a single
   * slab it is wrong, because the slab can only be in one place and silently
   * picked whichever row came first.
   */
  const activeHref = React.useMemo(() => {
    const candidates = NAVIGATION.flatMap((g) => g.items)
      .filter((i) => i.status !== 'PLANNED')
      .map((i) => i.href)
      .filter((href) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)));
    return candidates.sort((a, b) => b.length - a.length)[0] ?? null;
  }, [pathname]);

  const visibleGroups = React.useMemo(
    () =>
      NAVIGATION.map((group) => ({
        ...group,
        items: group.items.filter((item) => !item.permission || can(item.permission)),
      })).filter((group) => group.items.length > 0),
    [can],
  );

  return (
    <nav className="flex h-full w-60 shrink-0 flex-col border-r border-line bg-rail/80 text-rail-ink backdrop-blur-2xl">
      <div className="flex items-center gap-2.5 px-4 py-3.5">
        <div className="flex size-7 items-center justify-center rounded-md bg-ink text-[11px] font-bold tracking-tighter text-canvas">
          D·D
        </div>
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold leading-tight text-ink">DASH AND DOT</p>
          <p className="truncate text-[10.5px] leading-tight text-rail-ink-muted">Manufacturing ERP</p>
        </div>
      </div>

      <div ref={listRef} className="slab-track flex-1 overflow-y-auto px-2 pb-4">
        {slab ? (
          <span
            aria-hidden="true"
            className="slab slab-invert left-2 right-2 rounded"
            style={{ transform: `translateY(${slab.top}px)`, height: slab.height }}
          />
        ) : null}
        {visibleGroups.map((group, gi) => (
          <div key={group.label || `g${gi}`} className="mb-1">
            {group.label ? (
              <p className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-rail-ink-muted">
                {group.label}
              </p>
            ) : null}
            <ul className="space-y-px">
              {group.items.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} activeHref={activeHref} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {user ? (
        <div className="border-t border-line px-3 py-2.5">
          <p className="truncate text-[12px] font-medium text-ink">{user.fullName}</p>
          <p className="truncate text-[10.5px] text-rail-ink-muted">
            {user.roles.map((r) => r.replace(/_/g, ' ').toLowerCase()).join(', ')}
          </p>
        </div>
      ) : null}
    </nav>
  );
}

function NavLink({
  item,
  activeHref,
  onNavigate,
}: {
  item: NavItem;
  activeHref: string | null;
  onNavigate?: () => void;
}) {
  const active = item.href === activeHref;
  const planned = item.status === 'PLANNED';

  const content = (
    <>
      <Icon name={item.icon} className="size-[15px] shrink-0" />
      <span className="flex-1 truncate">{item.label}</span>
      {planned ? (
        <span
          className="shrink-0 rounded-sm bg-surface-muted px-1 py-px text-[9.5px] font-medium tabular-nums text-rail-ink-muted"
          title={`Planned for phase ${item.phase}`}
        >
          P{item.phase}
        </span>
      ) : null}
      {item.status === 'PARTIAL' ? (
        <span
          // A hollow ring, not a filled dot: on a dark rail an ink dot would
          // vanish, and on the white slab a white one would.
          className={cn(
            'size-1.5 shrink-0 rounded-full border',
            active ? 'border-canvas' : 'border-rail-ink-muted',
          )}
          title={item.description ?? 'Partially implemented'}
        />
      ) : null}
    </>
  );

  if (planned) {
    return (
      <span
        aria-disabled="true"
        title={`Not built yet - scheduled for phase ${item.phase}`}
        className="flex cursor-not-allowed items-center gap-2 rounded px-2 py-1.5 text-[12.5px] text-rail-ink-muted/55"
      >
        {content}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={item.description}
      data-active={active || undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        // `relative` lifts the label above the slab, which is painted behind.
        'relative flex items-center gap-2 rounded px-2 py-1.5 text-[12.5px] transition-colors duration-150',
        active
          // Ink on the white slab. The slab itself supplies the background.
          ? 'font-semibold text-canvas'
          : 'text-rail-ink hover:bg-rail-hover hover:text-ink',
      )}
    >
      {content}
    </Link>
  );
}
