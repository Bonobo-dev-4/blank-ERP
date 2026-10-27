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
 * The navigation panel — subtle glass, the quietest material in the shell.
 *
 * Hierarchy without decoration: areas of the business are small labels that
 * fold, screens inside them hang off a hairline guide, and exactly one item —
 * the one you are on — carries a fill and an accent. Nothing else is boxed,
 * because sixty outlined pills read as sixty buttons shouting at once.
 *
 * Collapsed, it becomes an icon rail: each area's icon carries a tooltip and
 * opens a keyboard-navigable flyout of its screens, so narrowing the panel
 * never makes anything unreachable.
 *
 * Permissions are applied before anything renders, and planned screens stay
 * visible but disabled — a link to an empty page is worse than an honest
 * "not yet".
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
        'glass-subtle flex h-full shrink-0 flex-col rounded-3xl',
        'transition-[width] duration-200 ease-out motion-reduce:transition-none',
        collapsed ? 'w-[68px]' : 'w-[240px]',
      )}
    >
      {/* Brand */}
      <div className={cn('flex h-14 shrink-0 items-center gap-2.5 px-4', collapsed && 'justify-center px-0')}>
        <Link
          href="/"
          onClick={onNavigate}
          aria-label="DASH AND DOT — dashboard"
          className="grid size-8 shrink-0 place-items-center rounded-lg bg-ink text-[11px] font-bold tracking-tighter text-canvas"
        >
          D·D
        </Link>
        {!collapsed ? (
          <div className="min-w-0 leading-tight">
            <p className="truncate font-display text-[14px] font-semibold tracking-[-0.02em] text-ink">DASH AND DOT</p>
            <p className="truncate text-[12px] text-ink-subtle">Manufacturing ERP</p>
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
              className="grid size-9 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
            >
              <Icons.Search className="size-4" />
            </button>
          </GlassTooltip>
        ) : (
          <div className="relative">
            <Icons.Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
              placeholder="Search screens"
              aria-label="Search screens"
              className={cn(
                'h-8 w-full rounded-lg border border-line bg-surface-muted pl-8 pr-2.5',
                'text-[13px] text-ink placeholder:text-ink-subtle',
                'transition-[border-color,box-shadow] duration-200',
                'focus-visible:border-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-soft',
              )}
            />
          </div>
        )}
      </div>

      {/* Destinations */}
      <div className={cn('min-h-0 flex-1 overflow-y-auto pb-3', collapsed ? 'px-0' : 'px-2.5')}>
        {collapsed ? (
          <ul className="flex flex-col items-center gap-0.5 pt-1">
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
              <p className="px-2 py-6 text-center text-[13px] text-ink-muted">
                No screen matches &ldquo;{query}&rdquo;.
              </p>
            ) : null}

            {shown.map((g) => {
              if (!g.label) {
                return (
                  <ul key="home" className="mb-1.5 space-y-px">
                    {g.items.map((item) => (
                      <li key={item.href}>
                        <NavLink item={item} activeHref={activeHref} onNavigate={onNavigate} />
                      </li>
                    ))}
                  </ul>
                );
              }

              // While searching every section is open: hiding a match behind
              // a folded heading would make the search look broken.
              const isOpen = results ? true : (openGroups[g.label] ?? g.label === activeGroup);
              const id = `nav-${g.label.replace(/\W+/g, '-').toLowerCase()}`;

              return (
                <section key={g.label} className="mt-1">
                  <button
                    onClick={() => setOpenGroups((s) => ({ ...s, [g.label]: !isOpen }))}
                    aria-expanded={isOpen}
                    aria-controls={id}
                    className="group flex h-7 w-full items-center gap-1.5 rounded-md px-2.5 text-left transition-colors hover:bg-surface-muted"
                  >
                    <span
                      className={cn(
                        't-micro flex-1 truncate transition-colors',
                        g.label === activeGroup ? 'text-ink-muted' : 'text-ink-subtle group-hover:text-ink-muted',
                      )}
                    >
                      {g.label}
                    </span>
                    <Icons.ChevronRight
                      className={cn(
                        'size-3.5 shrink-0 text-ink-subtle transition-transform duration-200 motion-reduce:transition-none',
                        isOpen && 'rotate-90',
                      )}
                    />
                  </button>

                  <div id={id} className="accordion" data-open={isOpen}>
                    <div>
                      <ul className="relative mb-1 ml-[15px] mt-0.5 space-y-px border-l border-line pl-1.5">
                        {g.items.map((item) => (
                          <li key={item.href}>
                            <NavLink item={item} activeHref={activeHref} onNavigate={onNavigate} nested tabbable={isOpen} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </section>
              );
            })}
          </>
        )}
      </div>

      {/* Footer: who is signed in, and the collapse control */}
      <div className={cn('border-t border-line px-3 py-2.5', collapsed && 'flex flex-col items-center gap-1.5 px-0')}>
        {user ? (
          collapsed ? (
            <GlassTooltip content={user.fullName} side="right">
              <span
                tabIndex={0}
                className="grid size-8 place-items-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand"
              >
                {initials}
              </span>
            </GlassTooltip>
          ) : (
            <div className="flex items-center gap-2.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand">
                {initials}
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-[13px] font-medium text-ink">{user.fullName}</p>
                <p className="truncate text-[11.5px] capitalize text-ink-subtle">
                  {user.roles.map((r) => r.replace(/_/g, ' ').toLowerCase()).join(', ')}
                </p>
              </div>
              {!forceOpen ? <CollapseButton collapsed={false} onClick={() => setCollapsed(true)} /> : null}
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
        className="grid size-7 shrink-0 place-items-center rounded-md text-ink-subtle transition-colors hover:bg-surface-muted hover:text-ink"
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
    'relative grid size-9 place-items-center rounded-lg transition-colors duration-150',
    active
      ? 'bg-[var(--nav-active)] text-ink ring-1 ring-inset ring-[var(--nav-active-border)]'
      : 'text-ink-subtle hover:bg-surface-muted hover:text-ink',
  );
  const indicator = active ? (
    <span aria-hidden="true" className="absolute -left-[13px] top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-brand" />
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
          <Icon name={icon} className="size-4" />
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
            <Icon name={icon} className="size-4" />
          </button>
        </DropdownMenu.Trigger>
      </GlassTooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="right"
          align="start"
          sideOffset={14}
          collisionPadding={12}
          className="glass-floating z-50 max-h-[70vh] w-[232px] overflow-y-auto rounded-xl p-1.5 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <DropdownMenu.Label className="t-micro px-2.5 pb-1 pt-1.5 text-ink-subtle">{label}</DropdownMenu.Label>
          {items.map((item) =>
            item.status === 'PLANNED' ? (
              <DropdownMenu.Item
                key={item.href}
                disabled
                className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-ink-subtle opacity-60 outline-none"
              >
                <Icon name={item.icon} className="size-4" />
                <span className="flex-1 truncate">{item.label}</span>
                <span className="text-[11px]">P{item.phase}</span>
              </DropdownMenu.Item>
            ) : (
              <DropdownMenu.Item key={item.href} asChild>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={item.href === activeHref ? 'page' : undefined}
                  className={cn(
                    'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium outline-none transition-colors',
                    'data-[highlighted]:bg-surface-muted',
                    item.href === activeHref ? 'text-ink' : 'text-ink-muted data-[highlighted]:text-ink',
                  )}
                >
                  <Icon name={item.icon} className={cn('size-4', item.href === activeHref ? 'text-brand' : 'text-ink-subtle')} />
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
  item, activeHref, onNavigate, nested, tabbable = true,
}: {
  item: NavItem;
  activeHref: string | null;
  onNavigate?: () => void;
  nested?: boolean;
  /** False while the section is folded, so hidden links are not tab stops. */
  tabbable?: boolean;
}) {
  const active = item.href === activeHref;
  const planned = item.status === 'PLANNED';

  const body = (
    <>
      {active ? (
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-brand',
            // On a nested item the accent sits on the guide line itself.
            nested ? '-left-[7.5px]' : 'left-0',
          )}
        />
      ) : null}
      <Icon
        name={item.icon}
        className={cn('size-4 shrink-0 transition-colors', active ? 'text-brand' : 'text-ink-subtle group-hover:text-ink-muted')}
      />
      <span className="flex-1 truncate">{item.label}</span>
      {planned ? (
        <span className="shrink-0 text-[11px] tabular-nums text-ink-subtle">P{item.phase}</span>
      ) : null}
      {item.status === 'PARTIAL' ? (
        <span
          className="size-1.5 shrink-0 rounded-full border border-ink-subtle"
          title={item.description ?? 'Partially implemented'}
        />
      ) : null}
    </>
  );

  const shared = 'group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors duration-150';

  if (planned) {
    return (
      <span
        aria-disabled="true"
        title={`${item.label} — not built yet, scheduled for phase ${item.phase}`}
        className={cn(shared, 'cursor-not-allowed text-ink-subtle opacity-55')}
      >
        {body}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      tabIndex={tabbable ? undefined : -1}
      aria-current={active ? 'page' : undefined}
      title={item.description}
      className={cn(
        shared,
        active
          ? 'bg-[var(--nav-active)] text-ink ring-1 ring-inset ring-[var(--nav-active-border)]'
          : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
      )}
    >
      {body}
    </Link>
  );
}
