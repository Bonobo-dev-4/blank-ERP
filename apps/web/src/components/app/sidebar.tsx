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
  const C = Cmp ?? Icons.Circle;
  return <C className={className} />;
}

const PIN_KEY = 'dnd.railPinned';

/**
 * The icon rail.
 *
 * Collapsed to icons by default, expanding on hover and pinnable open.
 *
 * An icon-only rail is the look that was asked for, and on its own it would
 * not survive this app: there are 63 destinations, and nobody finds "Material
 * Consumption" by pictogram. Hover-to-expand keeps the narrow resting state
 * while leaving every label one gesture away, and the pin is there for anyone
 * who would rather not play that game all day.
 *
 * A jade slab marks where you are and SLIDES to what you pick — the same slab
 * that underlines the tab strips, so the menu and the tabs read as one
 * mechanism.
 */
export function Sidebar({ onNavigate, forceOpen }: { onNavigate?: () => void; forceOpen?: boolean }) {
  const pathname = usePathname();
  const { user, can } = useAuth();
  const listRef = React.useRef<HTMLDivElement>(null);
  const [slab, setSlab] = React.useState<{ top: number; height: number } | null>(null);
  const [hovered, setHovered] = React.useState(false);
  const [pinned, setPinned] = React.useState(false);

  React.useEffect(() => {
    try { setPinned(localStorage.getItem(PIN_KEY) === '1'); } catch { /* private mode */ }
  }, []);

  const open = forceOpen || pinned || hovered;

  /**
   * The ONE active item: the longest href the path matches.
   *
   * A plain `startsWith` makes both /orders and /orders/fulfilment active at
   * once. With a highlight on each that merely looked untidy; with a single
   * slab it is wrong, because the slab can only be in one place.
   */
  const activeHref = React.useMemo(() => {
    const matches = NAVIGATION.flatMap((g) => g.items)
      .filter((i) => i.status !== 'PLANNED')
      .map((i) => i.href)
      .filter((href) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)));
    return matches.sort((a, b) => b.length - a.length)[0] ?? null;
  }, [pathname]);

  const groups = React.useMemo(
    () =>
      NAVIGATION.map((group) => ({
        ...group,
        items: group.items.filter((item) => !item.permission || can(item.permission)),
      })).filter((group) => group.items.length > 0),
    [can],
  );

  React.useLayoutEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const measure = () => {
      const el = root.querySelector<HTMLElement>('[data-active="true"]');
      if (!el) { setSlab(null); return; }
      // Measured from rects: the rows sit inside nested lists, so offsetTop
      // would be relative to those rather than to the track.
      const a = el.getBoundingClientRect();
      const b = root.getBoundingClientRect();
      setSlab({ top: a.top - b.top + root.scrollTop, height: a.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    root.addEventListener('scroll', measure, { passive: true });
    return () => { ro.disconnect(); root.removeEventListener('scroll', measure); };
  }, [pathname, can, open]);

  const togglePin = () => {
    setPinned((p) => {
      const next = !p;
      try { localStorage.setItem(PIN_KEY, next ? '1' : '0'); } catch { /* private mode */ }
      return next;
    });
  };

  return (
    <nav
      aria-label="Main"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        'flex h-full shrink-0 flex-col rounded-r-2xl bg-rail text-rail-ink',
        'transition-[width] duration-200 ease-out',
        open ? 'w-60' : 'w-[62px]',
      )}
    >
      <div className="flex h-12 items-center gap-2.5 px-3.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand text-[11px] font-bold tracking-tighter text-white">
          D·D
        </div>
        {open ? (
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-semibold leading-tight text-white">DASH AND DOT</p>
            <p className="truncate text-[10.5px] leading-tight text-rail-ink-muted">Manufacturing ERP</p>
          </div>
        ) : null}
        {open && !forceOpen ? (
          <button
            onClick={togglePin}
            aria-pressed={pinned}
            title={pinned ? 'Unpin the menu' : 'Keep the menu open'}
            className="shrink-0 rounded-md p-1 text-rail-ink-muted transition-colors hover:bg-rail-hover hover:text-white"
          >
            {pinned ? <Icons.PinOff className="size-3.5" /> : <Icons.Pin className="size-3.5" />}
          </button>
        ) : null}
      </div>

      <div ref={listRef} className="slab-track flex-1 overflow-y-auto overflow-x-hidden px-2 pb-4">
        {slab ? (
          <span
            aria-hidden="true"
            className="slab left-2 right-2 rounded-lg"
            style={{ transform: `translateY(${slab.top}px)`, height: slab.height }}
          />
        ) : null}

        {groups.map((group, gi) => (
          <div key={group.label || `g${gi}`} className="mb-1">
            {group.label ? (
              open ? (
                <p className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-rail-ink-muted">
                  {group.label}
                </p>
              ) : (
                // Collapsed, the group name cannot fit, so the grouping is
                // kept as a rule. Losing it entirely would turn 63 icons into
                // one undifferentiated column.
                <div className="mx-2 my-2.5 h-px bg-white/10" aria-hidden="true" />
              )
            ) : null}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} activeHref={activeHref} open={open} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {user ? (
        <div className="flex items-center gap-2.5 border-t border-white/10 px-3 py-2.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-semibold text-white">
            {user.fullName.slice(0, 1).toUpperCase()}
          </div>
          {open ? (
            <div className="min-w-0">
              <p className="truncate text-[12px] font-medium text-white">{user.fullName}</p>
              <p className="truncate text-[10.5px] text-rail-ink-muted">
                {user.roles.map((r) => r.replace(/_/g, ' ').toLowerCase()).join(', ')}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}

function NavLink({
  item, activeHref, open, onNavigate,
}: {
  item: NavItem;
  activeHref: string | null;
  open: boolean;
  onNavigate?: () => void;
}) {
  const active = item.href === activeHref;
  const planned = item.status === 'PLANNED';

  const body = (
    <>
      <span className="grid size-[22px] shrink-0 place-items-center">
        <Icon name={item.icon} className="size-[16px]" />
      </span>
      {open ? (
        <>
          <span className="flex-1 truncate">{item.label}</span>
          {planned ? (
            <span className="shrink-0 rounded bg-white/10 px-1 py-px text-[9.5px] font-medium tabular-nums">
              P{item.phase}
            </span>
          ) : null}
          {item.status === 'PARTIAL' ? (
            <span
              className={cn('size-1.5 shrink-0 rounded-full border', active ? 'border-white' : 'border-rail-ink-muted')}
              title={item.description ?? 'Partially implemented'}
            />
          ) : null}
        </>
      ) : null}
    </>
  );

  const shared = cn(
    'relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] transition-colors duration-150',
    !open && 'justify-center px-0',
  );

  if (planned) {
    return (
      <span
        aria-disabled="true"
        title={`${item.label} — not built yet, scheduled for phase ${item.phase}`}
        className={cn(shared, 'cursor-not-allowed text-rail-ink-muted/50')}
      >
        {body}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      data-active={active || undefined}
      aria-current={active ? 'page' : undefined}
      // The label is the accessible name when collapsed, and the hover
      // tooltip for a mouse. Icons alone name nothing.
      title={open ? item.description : item.label}
      aria-label={item.label}
      className={cn(
        shared,
        active ? 'font-semibold text-white' : 'text-rail-ink hover:bg-rail-hover hover:text-white',
      )}
    >
      {body}
    </Link>
  );
}
