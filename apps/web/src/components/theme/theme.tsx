'use client';

import * as React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ThemePreference = 'system' | 'day' | 'night';
export type ResolvedTheme = 'day' | 'night';

/** Where the preference lives. Read by the pre-paint script in the root layout. */
export const THEME_KEY = 'dnd.theme';

/**
 * Runs before first paint, inline in <head>, so the page never flashes the
 * wrong theme. Kept tiny and dependency-free: it is a string, not a module.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var p=localStorage.getItem('${THEME_KEY}');if(p!=='day'&&p!=='night')p='system';var r=p==='system'?(window.matchMedia('(prefers-color-scheme: light)').matches?'day':'night'):p;document.documentElement.setAttribute('data-theme',r);}catch(e){document.documentElement.setAttribute('data-theme','night');}})();`;

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'night';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'day' : 'night';
}

function readPreference(): ThemePreference {
  try {
    const p = localStorage.getItem(THEME_KEY);
    return p === 'day' || p === 'night' ? p : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Applies a theme with a short, global colour transition — only while the
 * switch happens, so ordinary hovers keep their own timing.
 */
function apply(theme: ResolvedTheme, animate: boolean) {
  const root = document.documentElement;
  if (root.getAttribute('data-theme') === theme) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (animate && !reduce) {
    root.classList.add('theme-transition');
    window.setTimeout(() => root.classList.remove('theme-transition'), 260);
  }
  root.setAttribute('data-theme', theme);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Start from what the boot script already put on <html>, so the first
  // client render agrees with the painted page.
  const [preference, setPref] = React.useState<ThemePreference>('system');
  const [resolved, setResolved] = React.useState<ResolvedTheme>('night');

  React.useEffect(() => {
    const p = readPreference();
    setPref(p);
    const attr = document.documentElement.getAttribute('data-theme');
    setResolved(attr === 'day' ? 'day' : 'night');
  }, []);

  // Follow the operating system while the preference is "system".
  React.useEffect(() => {
    if (preference !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      const next = systemTheme();
      apply(next, true);
      setResolved(next);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [preference]);

  const setPreference = React.useCallback((p: ThemePreference) => {
    try { localStorage.setItem(THEME_KEY, p); } catch { /* private mode: still applies for this tab */ }
    const next = p === 'system' ? systemTheme() : p;
    apply(next, true);
    setPref(p);
    setResolved(next);
  }, []);

  const value = React.useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}

const OPTIONS: { value: ThemePreference; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'day', label: 'Day', icon: Sun },
  { value: 'night', label: 'Night', icon: Moon },
];

/**
 * Compact segmented control: System / Day / Night.
 *
 * A radiogroup, so arrow keys move between options the way an operator using
 * a keyboard expects, and the selected option is announced.
 */
export function ThemeSwitcher({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = (i + (e.key === 'ArrowRight' ? 1 : OPTIONS.length - 1)) % OPTIONS.length;
    setPreference(OPTIONS[next]!.value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn('glass-raised inline-flex items-center gap-0.5 rounded-full p-0.5', className)}
    >
      {OPTIONS.map((o, i) => {
        const active = preference === o.value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            ref={(el) => { refs.current[i] = el; }}
            role="radio"
            aria-checked={active}
            aria-label={`${o.label} theme`}
            title={`${o.label} theme`}
            tabIndex={active ? 0 : -1}
            onClick={() => setPreference(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'grid size-7 place-items-center rounded-full transition-colors duration-200',
              active
                ? 'bg-ink text-canvas shadow-sm'
                : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
            )}
          >
            <Icon className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
