'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { ChevronRight, LogOut, Menu, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { ALL_NAV_ITEMS, BUILD_STATUS_SUMMARY, DELIVERED_PHASES } from '@dnd/contracts';
import { Badge, Button } from '@/components/ui/primitives';
import { useAuth } from './auth-context';

/**
 * How much of the roadmap is actually delivered.
 *
 * Read from the shared navigation map rather than written here, because a
 * hardcoded badge goes stale the moment a phase lands — and a badge that
 * misstates what the system can do is worse than no badge.
 */
const PHASE_BADGE = `Phase ${DELIVERED_PHASES[DELIVERED_PHASES.length - 1]}`;
const PHASE_BADGE_TITLE =
  `Phases ${DELIVERED_PHASES.join(', ')} delivered — ` +
  `${BUILD_STATUS_SUMMARY.built} screens built, ` +
  `${BUILD_STATUS_SUMMARY.partial} partial, ${BUILD_STATUS_SUMMARY.planned} planned`;

export function Topbar({ onOpenNav }: { onOpenNav: () => void }) {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = React.useState(false);

  const crumbs = React.useMemo(() => breadcrumbsFor(pathname), [pathname]);

  const refreshAll = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries();
    setRefreshing(false);
  };

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenNav} aria-label="Open navigation">
        <Menu />
      </Button>

      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1 text-[12.5px]">
        {crumbs.map((c, i) => (
          <React.Fragment key={c}>
            {i > 0 ? <ChevronRight className="size-3 shrink-0 text-ink-subtle" /> : null}
            <span className={i === crumbs.length - 1 ? 'truncate font-medium text-ink' : 'truncate text-ink-muted'}>
              {c}
            </span>
          </React.Fragment>
        ))}
      </nav>

      <div className="flex shrink-0 items-center gap-1.5">
        <span className="hidden sm:inline-flex" title={PHASE_BADGE_TITLE}>
          <Badge tone="outline">{PHASE_BADGE}</Badge>
        </span>
        <Button variant="ghost" size="icon" onClick={refreshAll} aria-label="Refresh data" title="Refresh all data">
          <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
        </Button>
        <div className="hidden min-w-0 items-center gap-2 border-l border-line pl-2 sm:flex">
          <span className="max-w-[160px] truncate text-[12px] text-ink-muted">{user?.email}</span>
          <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out" title="Sign out">
            <LogOut />
          </Button>
        </div>
      </div>
    </header>
  );
}

/** Build a breadcrumb trail from the navigation map, longest match first. */
function breadcrumbsFor(pathname: string): string[] {
  if (pathname === '/') return ['Dashboard'];

  const matches = ALL_NAV_ITEMS
    .filter((i) => i.href !== '/' && pathname.startsWith(i.href))
    .sort((a, b) => b.href.length - a.href.length);

  const best = matches[0];
  if (!best) return [titleCase(pathname.split('/').filter(Boolean).at(-1) ?? '')];

  const trail = [best.label];
  // A detail page under a list page gets a final "Detail" crumb rather than a
  // raw UUID, which tells the reader nothing.
  const rest = pathname.slice(best.href.length).split('/').filter(Boolean);
  if (rest.length > 0) trail.push(looksLikeId(rest[0]!) ? 'Detail' : titleCase(rest[0]!));
  return trail;
}

const looksLikeId = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(s);
const titleCase = (s: string) => s.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
