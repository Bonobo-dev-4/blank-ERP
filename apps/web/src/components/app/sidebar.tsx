'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as Icons from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { NAVIGATION, type NavItem } from '@dnd/contracts';
import { cn } from '@/lib/utils';
import { GlassTooltip } from '@/components/ui/tooltip';
import { useAuth } from './auth-context';

function Icon({ name, className }: { name: string; className?: string }) {
  const Cmp = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[name];
  const C = Cmp ?? Icons.Circle;
  return <C className={className} />;
}

/**
 * One icon per GROUP, not per screen: the collapsed rail names areas of the
 * business, and the expanded panel names the screens inside one.
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

const COLLAPSE_KEY = 'dnd.navCollapsed';

/**
 * The navigation panel — a floating pane of glass.
 *
 * Sixty-odd destinations is too many for a flat list, so the panel keeps the
 * business's own grouping as category headings that fold, the section you are
 * in opens itself, and search cuts straight through when you know the name.
 *
 * Collapsed, it becomes an icon rail: each area's icon carries a tooltip with
 * its name and opens a flyout of its screens, so nothing becomes unreachable
 * by narrowing the panel.
 *
 * Permissions are applied before anything renders — a screen you cannot open
 * is not shown — and planned screens stay visible but disabled, because a
 * link to an empty page is worse than an honest "not yet".
 */
export function Sidebar({ onNavigate, forceOpen }: { onNavigate?: () => void; forceOpen?: boolean }) {
  const pathname = usePathname();
  const { user, can } = useAuth();
  const [collapsedPref, setCollapsedPref] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({});
  const searchRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    try { setCollapsedPref(localStorage.getItem(COLLAPSE_KEY) === '1'); } catch { /* private mode */ }
  }, []);

  const collapsed = !forceOpen && collapsedPref;

  const setCollapsed = (next: boolean) => {
    setCollapsedPref(next);
    try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* private mode */ }
  };

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

  // The section you are in opens itself.
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

  const initials = user?.fullName
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <nav
      aria-label="Main navigation"
      className={cn(
        'glass flex h-full shrink-0 flex-col rounded-3xl',
        'transition-[width] duration-200 ease-out motion-reduce:transition-none',
        collapsed ? 'w-[76px]' : 'w-[244px]',
      )}
    >
      {/* Brand */}
      <div className={cn('flex items-center gap-3 px-4 pb-3 pt-4', collapsed && 'justify-center px-0')}>
        <Link
          href="/"
          onClick={onNavigate}
          aria-label="DASH AND DOT — dashboard"
          className="grid size-10 shrink-0 place-items-center rounded-2xl bg-ink text-[12px] font-bold tracking-tighter text-canvas shadow-sm"
        >
          D·D
        </Link>
        {!collapsed ? (
          <div className="min-w-0">
            <p className="truncate text-[14px] font-bold leading-tight tracking-tight text-ink">DASH AND DOT</p>
            <p className="truncate text-[11.5px] leading-tight text-ink-subtle">Manufacturing ERP</p>
          </div>
        ) : null}
      </div>

      {/* Search */}
      <div className={cn('px-3 pb-2', collapsed && 'flex justify-center px-0')}>
        {collapsed ? (
          <GlassTooltip content="Search screens" side="right">
            <button
              onClick={() => { setCollapsed(false); window.setTimeout(() => searchRef.current?.focus(), 220); }}
              aria-label="Search screens"
              className="grid size-10 place-items-center rounded-xl text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
            >
              <Icons.Search className="size-[18px]" />
            </button>
          </GlassTooltip>
        ) : (
          <div className="relative">
            <Icons.Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
              placeholder="Search screens"
              aria-label="Search screens"
              className={cn(
                'h-9 w-full rounded-xl border border-line bg-surface-muted pl-9 pr-3',
                'text-[13px] text-ink placeholder:text-ink-subtle',
                'transition-[border-color,box-shadow] duration-200',
                'focus-visible:border-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-soft',
              )}
            />
          </div>
        )}
      </div>

      {/* Destinations */}
      <div className={cn('min-h-0 flex-1 overflow-y-auto pb-3', collapsed ? 'px-0' : 'px-3')}>
        {collapsed ? (
          <ul className="flex flex-col items-center gap-1 pt-1">
            {groups.map((g) => (
              <li key={g.label || 'home'}>
                <CollapsedGroup
                  label={g.label || 'Dashboard'}
                  icon={GROUP_ICON[g.label] ?? 'Circle'}
                  items={g.items}
                  active={g.label === activeGroup}
                  activeHref={activeHref}
                  onNavigate={onNavigate}
                />
              </li>
            ))}
          </ul>
        ) : (
          <>
            {results && matchCount === 0 ? (
              <p className="px-2 py-6 text-center text-[12.5px] text-ink-muted">
                No screen matches &ldquo;{query}&rdquo;.
              </p>
            ) : null}

            {shown.map((g) => {
              // While searching every section is open: hiding a match behind
              // a folded heading would make the search look broken.
              const isOpen = results ? true : (openGroups[g.label] ?? g.label === activeGroup);
              const hasActive = g.label === activeGroup;

              if (!g.label) {
                return (
                  <ul key="home" className="mb-2 space-y-0.5">
                    {g.items.map((item) => (
                      <li key={item.href}>
                        <NavLink item={item} activeHref={activeHref} onNavigate={onNavigate} />
                      </li>
                    ))}
                  </ul>
                );
              }

              return (
                <section key={g.label} className="mb-1">
                  <button
                    onClick={() => setOpenGroups((s) => ({ ...s, [g.label]: !isOpen }))}
                    aria-expanded={isOpen}
                    className={cn(
                      'group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors duration-150',
                      'hover:bg-surface-muted',
                    )}
                  >
                    <Icon
                      name={GROUP_ICON[g.label] ?? 'Circle'}
                      className={cn('size-4 shrink-0', hasActive ? 'text-brand' : 'text-ink-subtle group-hover:text-ink-muted')}
                    />
                    <span
                      className={cn(
                        'flex-1 truncate text-[11.5px] font-semibold uppercase tracking-[0.08em]',
                        hasActive ? 'text-ink' : 'text-ink-subtle group-hover:text-ink-muted',
                      )}
                    >
                      {g.label}
                    </span>
                    <Icons.ChevronDown
                      className={cn(
                        'size-3.5 shrink-0 text-ink-subtle transition-transform duration-200 motion-reduce:transition-none',
                        !isOpen && '-rotate-90',
                      )}
                    />
                  </button>

                  {isOpen ? (
                    <ul className="mb-1 mt-0.5 space-y-0.5">
                      {g.items.map((item) => (
                        <li key={item.href}>
                          <NavLink item={item} activeHref={activeHref} onNavigate={onNavigate} nested />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              );
            })}
          </>
        )}
      </div>

      {/* Footer: who is signed in, and the collapse control */}
      <div className={cn('border-t border-line p-3', collapsed && 'flex flex-col items-center gap-2 px-0')}>
        {user ? (
          collapsed ? (
            <GlassTooltip content={user.fullName} side="right">
              <span
                tabIndex={0}
                className="grid size-9 place-items-center rounded-full bg-brand-soft text-[12px] font-semibold text-brand"
              >
                {initials}
              </span>
            </GlassTooltip>
          ) : (
            <div className="flex items-center gap-2.5 px-1">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-[12px] font-semibold text-brand">
                {initials}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-ink">{user.fullName}</p>
                <p className="truncate text-[11.5px] text-ink-subtle">
                  {user.roles.map((r) => r.replace(/_/g, ' ').toLowerCase()).join(', ')}
                </p>
              </div>
              {!forceOpen ? (
                <CollapseButton collapsed={false} onClick={() => setCollapsed(true)} />
              ) : null}
            </div>
          )
        ) : null}
        {collapsed ? <CollapseButton collapsed onClick={() => setCollapsed(false)} /> : null}
      </div>
    </nav>
  );
}

function CollapseButton({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
  const label = collapsed ? 'Expand navigation' : 'Collapse navigation';
  return (
    <GlassTooltip content={label} side="right">
      <button
        onClick={onClick}
        aria-label={label}
        className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-subtle transition-colors hover:bg-surface-muted hover:text-ink"
      >
        {collapsed ? <Icons.PanelLeftOpen className="size-4" /> : <Icons.PanelLeftClose className="size-4" />}
      </button>
    </GlassTooltip>
  );
}

/**
 * An area of the business on the collapsed rail: a tooltip names it, and a
 * click opens a keyboard-navigable flyout of its screens.
 */
function CollapsedGroup({
  label, icon, items, active, activeHref, onNavigate,
}: {
  label: string;
  icon: string;
  items: readonly NavItem[];
  active: boolean;
  activeHref: string | null;
  onNavigate?: () => void;
}) {
  const buttonClass = cn(
    'relative grid size-10 place-items-center rounded-xl transition-colors duration-150',
    active
      ? 'border border-[var(--glass-border)] bg-[var(--glass-surface-elevated)] text-ink shadow-sm'
      : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
  );
  const indicator = active ? (
    <span aria-hidden="true" className="absolute -left-[13px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-brand" />
  ) : null;

  // A single-screen area (the dashboard) is just a link.
  if (items.length === 1 && items[0]!.status !== 'PLANNED') {
    const item = items[0]!;
    return (
      <GlassTooltip content={item.label} side="right">
        <Link
          href={item.href}
          onClick={onNavigate}
          aria-label={item.label}
          aria-current={item.href === activeHref ? 'page' : undefined}
          className={buttonClass}
        >
          {indicator}
          <Icon name={icon} className="size-[18px]" />
        </Link>
      </GlassTooltip>
    );
  }

  return (
    <DropdownMenu.Root>
      <GlassTooltip content={label} side="right">
        <DropdownMenu.Trigger asChild>
          <button aria-label={label} className={buttonClass}>
            {indicator}
            <Icon name={icon} className="size-[18px]" />
          </button>
        </DropdownMenu.Trigger>
      </GlassTooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="right"
          align="start"
          sideOffset={14}
          collisionPadding={12}
          className="glass-elevated z-50 max-h-[70vh] w-[240px] overflow-y-auto rounded-2xl p-1.5 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <DropdownMenu.Label className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
            {label}
          </DropdownMenu.Label>
          {items.map((item) =>
            item.status === 'PLANNED' ? (
              <DropdownMenu.Item
                key={item.href}
                disabled
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-ink-subtle opacity-60 outline-none"
              >
                <Icon name={item.icon} className="size-4" />
                <span className="flex-1 truncate">{item.label}</span>
                <span className="text-[10.5px]">P{item.phase}</span>
              </DropdownMenu.Item>
            ) : (
              <DropdownMenu.Item key={item.href} asChild>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={item.href === activeHref ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] outline-none transition-colors',
                    'data-[highlighted]:bg-surface-muted',
                    item.href === activeHref ? 'font-semibold text-ink' : 'text-ink-muted data-[highlighted]:text-ink',
                  )}
                >
                  <Icon name={item.icon} className={cn('size-4', item.href === activeHref && 'text-brand')} />
                  <span className="flex-1 truncate">{item.label}</span>
                </Link>
              </DropdownMenu.Item>
            ),
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function NavLink({
  item, activeHref, onNavigate, nested,
}: {
  item: NavItem;
  activeHref: string | null;
  onNavigate?: () => void;
  nested?: boolean;
}) {
  const active = item.href === activeHref;
  const planned = item.status === 'PLANNED';

  const body = (
    <>
      {active ? (
        <span aria-hidden="true" className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-brand" />
      ) : null}
      <Icon name={item.icon} className={cn('size-4 shrink-0', active ? 'text-brand' : 'text-ink-subtle')} />
      <span className="flex-1 truncate">{item.label}</span>
      {planned ? (
        <span className="shrink-0 rounded-full border border-line px-1.5 py-px text-[10px] font-medium tabular-nums">
          P{item.phase}
        </span>
      ) : null}
      {item.status === 'PARTIAL' ? (
        <span
          className="size-1.5 shrink-0 rounded-full border border-ink-subtle"
          title={item.description ?? 'Partially implemented'}
        />
      ) : null}
    </>
  );

  const shared = cn(
    'relative flex items-center gap-2.5 rounded-xl py-2 pr-2.5 text-[13px] transition-colors duration-150',
    nested ? 'pl-4' : 'pl-2.5',
  );

  if (planned) {
    return (
      <span
        aria-disabled="true"
        title={`${item.label} — not built yet, scheduled for phase ${item.phase}`}
        className={cn(shared, 'cursor-not-allowed text-ink-subtle opacity-60')}
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
        active
          ? 'border border-[var(--glass-border)] bg-[var(--glass-surface-elevated)] font-semibold text-ink shadow-sm'
          : 'border border-transparent text-ink-muted hover:bg-surface-muted hover:text-ink',
      )}
    >
      {body}
    </Link>
  );
}
