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
 * The dark navigation rail.
 *
 * Items for modules that are not built yet are rendered DISABLED with the
 * phase they are due in, not as links to an empty page. The specification is
 * explicit that every visible action must either work or be clearly marked
 * unavailable, and an operator who clicks three dead links stops trusting the
 * whole interface.
 */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user, can } = useAuth();

  const visibleGroups = React.useMemo(
    () =>
      NAVIGATION.map((group) => ({
        ...group,
        items: group.items.filter((item) => !item.permission || can(item.permission)),
      })).filter((group) => group.items.length > 0),
    [can],
  );

  return (
    <nav className="flex h-full w-60 shrink-0 flex-col bg-rail text-rail-ink">
      <div className="flex items-center gap-2.5 px-4 py-3.5">
        <div className="flex size-7 items-center justify-center rounded bg-white/95 text-[11px] font-bold tracking-tighter text-rail">
          D·D
        </div>
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold leading-tight text-white">DASH AND DOT</p>
          <p className="truncate text-[10.5px] leading-tight text-rail-ink-muted">Manufacturing ERP</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
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
                  <NavLink item={item} pathname={pathname} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {user ? (
        <div className="border-t border-white/10 px-3 py-2.5">
          <p className="truncate text-[12px] font-medium text-white">{user.fullName}</p>
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
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
  const planned = item.status === 'PLANNED';

  const content = (
    <>
      <Icon name={item.icon} className="size-[15px] shrink-0" />
      <span className="flex-1 truncate">{item.label}</span>
      {planned ? (
        <span
          className="shrink-0 rounded-sm bg-white/8 px-1 py-px text-[9.5px] font-medium tabular-nums text-rail-ink-muted"
          title={`Planned for phase ${item.phase}`}
        >
          P{item.phase}
        </span>
      ) : null}
      {item.status === 'PARTIAL' ? (
        <span
          className="size-1.5 shrink-0 rounded-full bg-warn"
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
      className={cn(
        'flex items-center gap-2 rounded px-2 py-1.5 text-[12.5px] transition-colors',
        active ? 'bg-rail-active font-medium text-white' : 'text-rail-ink hover:bg-rail-hover hover:text-white',
      )}
    >
      {content}
    </Link>
  );
}
