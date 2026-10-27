'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/app/sidebar';
import { Topbar } from '@/components/app/topbar';
import { Assistant } from '@/components/app/assistant';
import { useAuth } from '@/components/app/auth-context';
import { LoadingBlock } from '@/components/ui/primitives';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [navOpen, setNavOpen] = React.useState(false);

  React.useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <LoadingBlock label="Loading your workspace" />
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Desktop rail */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Mobile drawer: the shop floor runs this on tablets. */}
      {navOpen ? (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setNavOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">
            {/* forceOpen: a tablet has no hover, so the drawer shows labels. */}
            <Sidebar forceOpen onNavigate={() => setNavOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenNav={() => setNavOpen(true)} />
        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-6">{children}</main>
      </div>

      <Assistant />
    </div>
  );
}
