'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { ChevronRight, LogOut, Menu, RefreshCw } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ALL_NAV_ITEMS, BUILD_STATUS_SUMMARY, DELIVERED_PHASES, NAVIGATION,
} from '@dnd/contracts';
import { api } from '@/lib/api';
import { cn, fmtRelative } from '@/lib/utils';
import { Button } from '@/components/ui/primitives';
import { GlassTooltip } from '@/components/ui/tooltip';
import { ThemeSwitcher } from '@/components/theme/theme';
import { useAuth } from './auth-context';
import { NotificationBell } from './notification-bell';

/**
 * How much of the roadmap is delivered, read from the shared navigation map
 * so it cannot go stale the moment a phase lands.
 */
const BUILD_LINE =
  `Phases ${DELIVERED_PHASES.join(', ')} delivered · ` +
  `${BUILD_STATUS_SUMMARY.built} screens built, ${BUILD_STATUS_SUMMARY.partial} partial`;

/**
 * The top bar — a floating pane of glass.
 *
 * Left: where you are (page heading over its breadcrumb). Right: the state of
 * the world (sync), the controls that act on the whole app (refresh, theme),
 * what needs you (notifications), and who you are.
 */
export function Topbar({ onOpenNav }: { onOpenNav: () => void }) {
  const pathname = usePathname();
  const { user, signOut, can } = useAuth();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = React.useState(false);

  const { group, crumbs } = React.useMemo(() => breadcrumbsFor(pathname), [pathname]);
  const heading = crumbs[crumbs.length - 1] ?? 'Dashboard';

  const refreshAll = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries();
    setRefreshing(false);
  };

  const initials = user?.fullName.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <header className="glass-subtle flex h-14 shrink-0 items-center gap-2 rounded-2xl px-2.5 sm:px-3.5">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenNav} aria-label="Open navigation">
        <Menu />
      </Button>

      <div className="min-w-0 flex-1">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-[12px] leading-tight text-ink-subtle">
          {[group, ...crumbs.slice(0, -1)].filter(Boolean).map((c, i) => (
            <React.Fragment key={`${c}-${i}`}>
              {i > 0 ? <ChevronRight className="size-3 shrink-0" /> : null}
              <span className="truncate">{c}</span>
            </React.Fragment>
          ))}
        </nav>
        <p className="truncate font-display text-[15px] font-semibold leading-tight tracking-[-0.02em] text-ink" aria-current="page">
          {heading}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
        {can('demand.read') ? <SyncPulse /> : null}

        <GlassTooltip content="Refresh all data">
          <Button variant="ghost" size="icon" onClick={refreshAll} aria-label="Refresh all data">
            <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
          </Button>
        </GlassTooltip>

        <ThemeSwitcher className="hidden sm:inline-flex" />

        <NotificationBell />

        {user ? (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                aria-label={`Account: ${user.fullName}`}
                className="ml-1 flex items-center gap-2 rounded-lg p-0.5 pr-0.5 transition-colors hover:bg-surface-muted md:pr-2"
              >
                <span className="grid size-7 place-items-center rounded-full bg-brand-soft text-[12px] font-semibold text-brand">
                  {initials}
                </span>
                <span className="hidden max-w-[140px] truncate text-[13px] font-medium text-ink md:inline">
                  {user.fullName}
                </span>
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={10}
                className="glass-floating z-50 w-[264px] rounded-xl p-1.5 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
              >
                <div className="px-3 pb-2.5 pt-2">
                  <p className="truncate text-[13.5px] font-semibold text-ink">{user.fullName}</p>
                  <p className="truncate text-[12px] text-ink-muted">{user.email}</p>
                  <p className="mt-1 truncate text-[12px] capitalize text-ink-subtle">
                    {user.roles.map((r) => r.replace(/_/g, ' ').toLowerCase()).join(', ')}
                  </p>
                </div>
                {/* The theme control lives here on small screens, where the bar has no room. */}
                <div className="flex items-center justify-between border-t border-line px-3 py-2.5 sm:hidden">
                  <span className="text-[12.5px] text-ink-muted">Theme</span>
                  <ThemeSwitcher />
                </div>
                <p className="border-t border-line px-3 py-2.5 text-[12px] text-ink-subtle">{BUILD_LINE}</p>
                <DropdownMenu.Item
                  onSelect={() => signOut()}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-ink outline-none data-[highlighted]:bg-surface-muted"
                >
                  <LogOut className="size-4 text-ink-muted" /> Sign out
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        ) : null}
      </div>
    </header>
  );
}

interface SyncPulseData {
  shopify: { lastImportedAt: string | null; lastUpdatedAt: string | null };
  unicommerce: { lastStatusSyncAt: string | null };
}

/**
 * When the ERP last heard from Shopify and Unicommerce.
 *
 * The dot is reinforced by a word — "Synced", "Stale", "No sync" — so the
 * state does not rest on colour, and the tooltip gives both times exactly.
 */
function SyncPulse() {
  const { data } = useQuery({
    queryKey: ['sync-pulse'],
    queryFn: () => api.get<SyncPulseData>('/dashboard/sync-pulse'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const shop = data?.shopify.lastUpdatedAt ?? null;
  const uc = data?.unicommerce.lastStatusSyncAt ?? null;
  const newest = [shop, uc].filter(Boolean).sort().at(-1) ?? null;
  const ageH = newest ? (Date.now() - new Date(newest).getTime()) / 3_600_000 : Infinity;

  // Fresh within two hours, stale within a day, out of date beyond that.
  const state = !data ? 'loading' : !newest ? 'none' : ageH <= 2 ? 'fresh' : ageH <= 24 ? 'stale' : 'old';
  const word =
    state === 'fresh' ? 'Synced'
    : state === 'stale' ? 'Stale'
    : state === 'old' ? 'Out of date'
    : state === 'none' ? 'Never synced'
    : 'Checking';
  const dot =
    state === 'fresh' ? 'bg-ok'
    : state === 'stale' ? 'bg-warn'
    : state === 'old' || state === 'none' ? 'bg-danger'
    : 'bg-ink-subtle';

  return (
    <GlassTooltip
      content={
        <div className="space-y-1">
          <p className="font-semibold">Commerce sync</p>
          <p className="text-ink-muted">
            Shopify orders: {shop ? `updated ${fmtRelative(shop)}` : 'nothing imported yet'}
          </p>
          <p className="text-ink-muted">
            Unicommerce status: {uc ? `checked ${fmtRelative(uc)}` : 'not checked yet'}
          </p>
        </div>
      }
    >
      <span
        tabIndex={0}
        className="hidden h-8 items-center gap-2 rounded-lg border border-line px-2.5 text-[12.5px] font-medium text-ink transition-colors hover:bg-surface-muted md:inline-flex"
      >
        <span className={cn('size-1.5 rounded-full', dot, state === 'fresh' && 'shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-ok)_22%,transparent)]')} aria-hidden="true" />
        {word}
        {newest ? <span className="font-normal text-ink-muted">{fmtRelative(newest)}</span> : null}
      </span>
    </GlassTooltip>
  );
}

/** Breadcrumbs from the navigation map, longest match first, with the area. */
function breadcrumbsFor(pathname: string): { group: string | null; crumbs: string[] } {
  if (pathname === '/') return { group: null, crumbs: ['Dashboard'] };

  const matches = ALL_NAV_ITEMS
    .filter((i) => i.href !== '/' && pathname.startsWith(i.href))
    .sort((a, b) => b.href.length - a.href.length);

  const best = matches[0];
  if (!best) return { group: null, crumbs: [titleCase(pathname.split('/').filter(Boolean).at(-1) ?? '')] };

  const group = NAVIGATION.find((g) => g.items.some((i) => i.href === best.href))?.label || null;
  const trail = [best.label];
  // A detail page under a list page gets a final "Detail" crumb rather than a
  // raw UUID, which tells the reader nothing.
  const rest = pathname.slice(best.href.length).split('/').filter(Boolean);
  if (rest.length > 0) trail.push(looksLikeId(rest[0]!) ? 'Detail' : titleCase(rest[0]!));
  return { group, crumbs: trail };
}

const looksLikeId = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(s);
const titleCase = (s: string) => s.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
