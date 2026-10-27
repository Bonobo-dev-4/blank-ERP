'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from '@/components/app/sidebar';
import { Topbar } from '@/components/app/topbar';
import { Assistant } from '@/components/app/assistant';
import { useAuth } from '@/components/app/auth-context';
import { LoadingBlock } from '@/components/ui/primitives';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = React.useState(false);

  React.useEffect(() => {
    // Carry where the person was going, so signing in returns them there.
    // The login page validates it as an in-app path before using it.
    if (!loading && !user) {
      router.replace(pathname && pathname !== '/' ? `/login?next=${encodeURIComponent(pathname)}` : '/login');
    }
  }, [loading, user, router, pathname]);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <LoadingBlock label="Loading your workspace" />
      </div>
    );
  }
  if (!user) return null;

  return (
    // The floating shell: navigation and top bar are panes of glass held
    // off the edges, so the environment behind them frames the whole app.
    <div className="flex h-dvh gap-3 overflow-hidden p-2 sm:p-3">
      {/* Desktop navigation */}
      <div className="hidden lg:flex">
        <Sidebar />
      </div>

      {/* Mobile drawer: the shop floor runs this on tablets. */}
      {navOpen ? (
        <div
          className="fixed inset-0 z-40 flex p-2.5 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
          onKeyDown={(e) => { if (e.key === 'Escape') setNavOpen(false); }}
        >
          <div
            className="absolute inset-0 bg-[var(--glass-scrim)] backdrop-blur-[4px]"
            onClick={() => setNavOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full animate-in slide-in-from-left-4 fade-in-0 duration-200">
            {/* forceOpen: a tablet has no hover, so the drawer shows labels. */}
            <Sidebar forceOpen onNavigate={() => setNavOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <Topbar onOpenNav={() => setNavOpen(true)} />
        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-2xl px-0.5 pb-8 pt-1 sm:px-2 lg:px-3">{children}</main>
      </div>

      <Assistant />
    </div>
  );
}
