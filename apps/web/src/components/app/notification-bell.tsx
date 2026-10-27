'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface AttentionItem {
  kind: string; title: string; detail: string; href: string;
  count: number; severity: 'critical' | 'attention';
}
interface Feed { items: AttentionItem[]; total: number }

/**
 * The bell: what needs a human right now.
 *
 * A live reading rather than a stored inbox, refreshed every minute. Each
 * item links to the screen where it gets fixed, because a notification you
 * cannot act on from where it drops you is just a worry.
 */
export function NotificationBell() {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ['attention'],
    queryFn: () => api.get<Feed>('/notifications/attention'),
    refetchInterval: 60_000,
  });

  React.useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const total = data?.total ?? 0;
  const critical = data?.items.some((i) => i.severity === 'critical') ?? false;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={total > 0 ? `${total} things need attention` : 'Nothing needs attention'}
        aria-expanded={open}
        className="relative grid size-9 place-items-center rounded-xl text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
      >
        <Bell className="size-4" />
        {total > 0 ? (
          <span
            className={cn(
              'num absolute -right-1 -top-1 grid min-w-[18px] place-items-center rounded-full px-1 text-[10px] font-bold leading-[18px]',
              critical ? 'bg-danger text-canvas' : 'bg-warn text-canvas',
            )}
          >
            {total > 99 ? '99+' : total}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="glass-elevated absolute right-0 top-12 z-40 w-[340px] overflow-hidden rounded-2xl">
          <p className="border-b border-line px-4 py-3 text-[13px] font-semibold text-ink">
            Needs attention
          </p>
          {data && data.items.length === 0 ? (
            <p className="px-3.5 py-5 text-center text-[12px] text-ink-muted">
              Nothing is waiting on anyone. Rare — enjoy it.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {(data?.items ?? []).map((i) => (
                <li key={i.kind}>
                  <Link
                    href={i.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'block px-3.5 py-2.5 transition-colors hover:bg-surface-muted',
                      i.severity === 'critical' && 'row-flag',
                    )}
                  >
                    <p className="text-[13px] font-medium text-ink">{i.title}</p>
                    <p className="mt-0.5 text-[12px] text-ink-muted">{i.detail}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-line px-4 py-2.5 text-[11.5px] text-ink-subtle">
            Live reading, refreshed each minute. Only shows what you can act on.
          </p>
        </div>
      ) : null}
    </div>
  );
}
