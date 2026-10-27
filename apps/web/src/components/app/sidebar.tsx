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

/**
 * One icon per GROUP, not per screen.
 *
 * Nine icons a person can learn; sixty-three they cannot. The rail names
 * areas of the business, and the panel names the screens inside one.
 */
const GROUP_ICON: Record<string, string> = {
  '': 'LayoutDashboard',
  'Orders & Demand': 'ShoppingCart',
  'Raw Materials': 'Boxes',
  Purchasing: 'ClipboardList',
  'BOM & MRP': 'Network',
  Production: 'Factory',
  'Barcode Operations': 'ScanLine',
  'Finished Goods': 'PackageCheck',
  Intelligence: 'LineChart',
  Administration: 'Settings',
};

const PIN_KEY = 'dnd.railPinned';

/**
 * The navigation rail.
 *
 * A narrow strip of group icons, and a panel that opens beside it with a
 * search box and collapsible sections.
 *
 * Sixty-three destinations is too many for a flat list and far too many for
 * icons alone — nobody finds "Material Consumption" by pictogram. So the rail
 * carries the nine areas of the business, the panel carries the screens inside
 * one, and search cuts straight through both when you already know the name.
 *
 * Opening the panel does not navigate. Picking an area to look through is a
 * different act from going somewhere, and collapsing the two would make every
 * browse a page load.
 */
export function Sidebar({ onNavigate, forceOpen }: { onNavigate?: () => void; forceOpen?: boolean }) {
  const pathname = usePathname();
  const { user, can } = useAuth();
  const [pinned, setPinned] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({});
  const searchRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    try { setPinned(localStorage.getItem(PIN_KEY) === '1'); } catch { /* private mode */ }
  }, []);

  const open = forceOpen || pinned || hovered;

  const groups = React.useMemo(
    () =>
      NAVIGATION.map((g) => ({
        ...g,
        items: g.items.filter((i) => !i.permission || can(i.permission)),
      })).filter((g) => g.items.length > 0),
    [can],
  );

  /** The ONE active item: the longest href the path matches. */
  const activeHref = React.useMemo(() => {
    const matches = groups
      .flatMap((g) => g.items)
      .filter((i) => i.status !== 'PLANNED')
      .map((i) => i.href)
      .filter((h) => (h === '/' ? pathname === '/' : pathname === h || pathname.startsWith(`${h}/`)));
    return matches.sort((a, b) => b.length - a.length)[0] ?? null;
  }, [pathname, groups]);

  const activeGroup = React.useMemo(
    () => groups.find((g) => g.items.some((i) => i.href === activeHref))?.label ?? null,
    [groups, activeHref],
  );

  // The section you are in opens itself. Arriving at a screen and finding its
  // own section collapsed makes the panel feel like it has lost you.
  React.useEffect(() => {
    if (activeGroup !== null) setOpenGroups((s) => ({ ...s, [activeGroup]: true }));
  }, [activeGroup]);

  const q = query.trim().toLowerCase();
  const results = React.useMemo(() => {
    if (!q) return null;
    return groups
      .map((g) => ({ ...g, items: g.items.filter((i) => i.label.toLowerCase().includes(q)) }))
      .filter((g) => g.items.length > 0);
  }, [groups, q]);

  const shown = results ?? groups;
  const matchCount = results?.reduce((n, g) => n + g.items.length, 0) ?? 0;

  const togglePin = () => {
    setPinned((p) => {
      const next = !p;
      try { localStorage.setItem(PIN_KEY, next ? '1' : '0'); } catch { /* private mode */ }
      return next;
    });
  };

  return (
    <div
      className="flex h-full shrink-0"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setQuery(''); }}
    >
      {/* The rail: nine areas of the business. */}
      <nav
        aria-label="Sections"
        className="flex w-[58px] shrink-0 flex-col items-center gap-1 bg-rail py-2.5"
      >
        <div className="mb-1.5 grid size-9 place-items-center rounded-xl bg-white text-[11px] font-bold tracking-tighter text-rail">
          D·D
        </div>

        {groups.map((g) => {
          const isActive = g.label === activeGroup;
          return (
            <button
              key={g.label || 'home'}
              onClick={() => {
                if (!open) { setHovered(true); return; }
                setOpenGroups((s) => ({ ...s, [g.label]: !s[g.label] }));
              }}
              title={g.label || 'Dashboard'}
              aria-label={g.label || 'Dashboard'}
              className={cn(
                'grid size-9 place-items-center rounded-xl transition-colors',
                isActive
                  ? 'bg-white/14 text-white'
                  : 'text-rail-ink-muted hover:bg-white/8 hover:text-white',
              )}
            >
              <Icon name={GROUP_ICON[g.label] ?? 'Circle'} className="size-[17px]" />
            </button>
          );
        })}

        <div className="mt-auto">
          {user ? (
            <div
              className="grid size-8 place-items-center rounded-full bg-white/12 text-[11px] font-semibold text-white"
              title={user.fullName}
            >
              {user.fullName.slice(0, 1).toUpperCase()}
            </div>
          ) : null}
        </div>
      </nav>

      {/* The panel: search, then the screens inside each area. */}
      <div
        className={cn(
          'flex flex-col overflow-hidden bg-rail text-rail-ink',
          'transition-[width,opacity] duration-200 ease-out',
          open ? 'w-[228px] opacity-100' : 'w-0 opacity-0',
        )}
      >
        <div className="flex items-center gap-1.5 px-3 pb-2 pt-3">
          <div className="relative flex-1">
            <Icons.Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-rail-ink-muted" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
              placeholder="Search screens"
              aria-label="Search screens"
              className={cn(
                'h-8 w-full rounded-lg border border-white/12 bg-white/8 pl-8 pr-2',
                'text-[12.5px] text-white placeholder:text-rail-ink-muted',
                'outline-none focus-visible:border-white/35',
              )}
            />
          </div>
          {!forceOpen ? (
            <button
              onClick={togglePin}
              aria-pressed={pinned}
              title={pinned ? 'Unpin the menu' : 'Keep the menu open'}
              className="shrink-0 rounded-md p-1.5 text-rail-ink-muted transition-colors hover:bg-white/8 hover:text-white"
            >
              {pinned ? <Icons.PinOff className="size-3.5" /> : <Icons.Pin className="size-3.5" />}
            </button>
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {results && matchCount === 0 ? (
            <p className="px-2 py-6 text-center text-[12px] text-rail-ink-muted">
              No screen matches &ldquo;{query}&rdquo;.
            </p>
          ) : null}

          {shown.map((g) => {
            const label = g.label || 'Dashboard';
            // While searching every section is open: hiding a match behind a
            // collapsed heading would make the search look broken.
            const isOpen = results ? true : (openGroups[g.label] ?? g.label === activeGroup);
            return (
              <section key={g.label || 'home'} className="mb-0.5">
                {g.label ? (
                  <button
                    onClick={() => setOpenGroups((s) => ({ ...s, [g.label]: !isOpen }))}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-rail-ink-muted transition-colors hover:text-white"
                  >
                    {label}
                    <Icons.ChevronDown
                      className={cn('size-3 transition-transform duration-200', !isOpen && '-rotate-90')}
                    />
                  </button>
                ) : null}

                {isOpen ? (
                  <ul className="space-y-px pb-1">
                    {g.items.map((item) => (
                      <li key={item.href}>
                        <NavLink item={item} activeHref={activeHref} onNavigate={onNavigate} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          })}
        </div>

        {user ? (
          <div className="border-t border-white/10 px-3 py-2.5">
            <p className="truncate text-[12px] font-medium text-white">{user.fullName}</p>
            <p className="truncate text-[10.5px] text-rail-ink-muted">
              {user.roles.map((r) => r.replace(/_/g, ' ').toLowerCase()).join(', ')}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function NavLink({
  item, activeHref, onNavigate,
}: {
  item: NavItem;
  activeHref: string | null;
  onNavigate?: () => void;
}) {
  const active = item.href === activeHref;
  const planned = item.status === 'PLANNED';

  const body = (
    <>
      <Icon name={item.icon} className="size-[15px] shrink-0" />
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
  );

  const shared = 'flex items-center gap-2 rounded-lg py-1.5 pl-3 pr-2 text-[12.5px] transition-colors duration-150';

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
      aria-current={active ? 'page' : undefined}
      title={item.description}
      className={cn(
        shared,
        active ? 'bg-white/16 font-semibold text-white' : 'text-rail-ink hover:bg-white/8 hover:text-white',
      )}
    >
      {body}
    </Link>
  );
}
