'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, Eye, EyeOff, KeyRound, Loader2, ScanLine, TriangleAlert } from 'lucide-react';
import { ThemeSwitcher } from '@/components/theme/theme';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/components/app/auth-context';
import { ManufacturingCanvas, MiniFlow } from '@/components/auth/manufacturing-canvas';

/**
 * Where to go after signing in.
 *
 * A protected screen sends people here with `?next=/the/path`. Only a plain
 * in-app path is honoured — one leading slash, no scheme, no backslash, no
 * protocol-relative `//host` — so the parameter cannot be used to bounce a
 * freshly signed-in user to another site.
 */
function safeNext(): string {
  if (typeof window === 'undefined') return '/';
  const raw = new URLSearchParams(window.location.search).get('next');
  if (!raw) return '/';
  if (!/^\/(?![/\\])[^\s\\]*$/.test(raw)) return '/';
  if (raw === '/login' || raw.startsWith('/login?') || raw.startsWith('/login/')) return '/';
  return raw;
}

type Phase = 'idle' | 'submitting' | 'success';

/**
 * Two ways in, unchanged.
 *
 * Email and password for office staff, and employee code plus a short PIN for
 * shop-floor terminals — an operator at a cutting table cannot type a
 * passphrase. The PIN route is safe because of the permission matrix, not
 * because of the credential.
 *
 * The form is deliberately still. Motion lives in the canvas beside it; the
 * card only enters once, and the only thing that moves after that is a small
 * nudge on an error line.
 */
export default function LoginPage() {
  const router = useRouter();
  const { signIn, signInWithPin } = useAuth();
  const [mode, setMode] = React.useState<'password' | 'pin'>('password');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [employeeCode, setEmployeeCode] = React.useState('');
  const [pin, setPin] = React.useState('');
  const [reveal, setReveal] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const [phase, setPhase] = React.useState<Phase>('idle');

  const busy = phase !== 'idle';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return; // one request at a time — never a duplicate sign-in
    setError(null);
    setPhase('submitting');
    try {
      if (mode === 'password') await signIn(email, password);
      else await signInWithPin(employeeCode, pin);
      // Success is shown only once the server has accepted the credentials.
      setPhase('success');
      const next = safeNext();
      window.setTimeout(() => {
        // replace, not push: Back after signing in should not return here.
        router.replace(next);
      }, 300);
    } catch (err) {
      // The server's own message, unchanged — no new wording that could hint
      // whether an account exists.
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Check your connection and try again.');
      setAttempt((n) => n + 1);
      setPhase('idle');
    }
  };

  const switchMode = (m: 'password' | 'pin') => {
    if (busy) return;
    setMode(m);
    setError(null);
    setReveal(false);
  };

  const invalid = error ? true : undefined;

  return (
    <main className="login-root relative grid min-h-dvh md:h-dvh md:grid-cols-2 lg:grid-cols-[43fr_57fr]">
      {/* Theme — floating, top right, the same control as inside the app. */}
      <div className="login-theme absolute right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] z-30">
        <ThemeSwitcher className="glass-subtle !border-[var(--glass-border)]" />
      </div>

      {/* --- authentication --------------------------------------------------- */}
      <section
        className={cn(
          'relative flex items-center justify-center px-5 sm:px-8',
          'pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(4.5rem,env(safe-area-inset-top))] md:py-10',
          phase === 'success' && 'login-leaving',
        )}
      >
        <div className="w-full max-w-[420px]">
          <div className="md:hidden">
            <MiniFlow />
          </div>

          {/* Brand */}
          <div className="login-logo mb-7 flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-[12px] bg-ink text-[13px] font-bold tracking-tighter text-canvas shadow-[0_6px_18px_-6px_var(--glass-shadow)]">
              D·D
            </div>
            <div className="leading-tight">
              <p className="font-display text-[15px] font-semibold tracking-[-0.02em] text-ink">DASH AND DOT</p>
              <p className="text-[13px] text-ink-muted">Manufacturing ERP</p>
            </div>
          </div>

          {/* The card */}
          <div className="glass-elevated login-enter rounded-[20px] p-6 sm:p-8">
            <h1
              className="login-stagger font-display text-[28px] font-[650] leading-[1.18] tracking-[-0.035em] text-ink sm:text-[32px]"
              style={{ ['--i' as string]: 0 }}
            >
              Welcome back
            </h1>
            <p className="login-stagger mt-1.5 text-[14px] leading-[1.55] text-ink-muted" style={{ ['--i' as string]: 1 }}>
              Sign in to your manufacturing workspace.
            </p>

            {/* Mode */}
            <div
              role="group"
              aria-label="Sign-in method"
              className="login-stagger mt-6 grid grid-cols-2 gap-1 rounded-[12px] border border-line bg-surface-muted p-1"
              style={{ ['--i' as string]: 2 }}
            >
              {([
                ['password', 'Staff sign in', KeyRound],
                ['pin', 'Shop floor', ScanLine],
              ] as const).map(([value, label, Icon]) => {
                const active = mode === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => switchMode(value)}
                    className={cn(
                      // Explicit px: the app's 14px root makes rem sizes run small,
                      // and a phone needs a full 44px target.
                      'flex h-[44px] items-center justify-center gap-1.5 rounded-[9px] text-[13px] font-medium transition-colors duration-200 md:h-[38px]',
                      active ? 'glass-raised text-ink' : 'text-ink-muted hover:text-ink',
                    )}
                  >
                    <Icon className="size-4" />
                    {label}
                  </button>
                );
              })}
            </div>

            <form onSubmit={submit} className="mt-5 space-y-4">
              {mode === 'password' ? (
                <>
                  <div className="login-stagger space-y-1.5" style={{ ['--i' as string]: 3 }}>
                    <label htmlFor="login-email" className="block text-[13px] font-[550] text-ink-muted">
                      Email
                    </label>
                    <input
                      id="login-email"
                      name="email"
                      type="email"
                      inputMode="email"
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      autoFocus
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@dashanddot.local"
                      aria-invalid={invalid}
                      aria-describedby={error ? 'login-error' : undefined}
                      className="login-field"
                    />
                  </div>
                  <div className="login-stagger space-y-1.5" style={{ ['--i' as string]: 4 }}>
                    <label htmlFor="login-password" className="block text-[13px] font-[550] text-ink-muted">
                      Password
                    </label>
                    <div className="relative">
                      <input
                        id="login-password"
                        name="password"
                        type={reveal ? 'text' : 'password'}
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        aria-invalid={invalid}
                        aria-describedby={error ? 'login-error' : undefined}
                        className="login-field pr-12"
                      />
                      <RevealButton reveal={reveal} onToggle={() => setReveal((r) => !r)} what="password" />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="login-stagger space-y-1.5" style={{ ['--i' as string]: 3 }}>
                    <label htmlFor="login-code" className="block text-[13px] font-[550] text-ink-muted">
                      Employee code
                    </label>
                    <input
                      id="login-code"
                      name="employeeCode"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      autoFocus
                      required
                      value={employeeCode}
                      onChange={(e) => setEmployeeCode(e.target.value.toUpperCase())}
                      placeholder="OP-014"
                      aria-invalid={invalid}
                      aria-describedby={error ? 'login-error' : undefined}
                      className="login-field font-mono uppercase tracking-wide"
                    />
                  </div>
                  <div className="login-stagger space-y-1.5" style={{ ['--i' as string]: 4 }}>
                    <label htmlFor="login-pin" className="flex items-baseline justify-between text-[13px] font-[550] text-ink-muted">
                      PIN <span className="text-[12px] font-normal text-ink-subtle">4 to 8 digits</span>
                    </label>
                    <div className="relative">
                      <input
                        id="login-pin"
                        name="pin"
                        type={reveal ? 'text' : 'password'}
                        inputMode="numeric"
                        pattern="\d{4,8}"
                        autoComplete="off"
                        required
                        value={pin}
                        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                        aria-invalid={invalid}
                        aria-describedby={error ? 'login-error' : undefined}
                        className="login-field num pr-12 text-center text-[18px] tracking-[0.5em]"
                      />
                      <RevealButton reveal={reveal} onToggle={() => setReveal((r) => !r)} what="PIN" />
                    </div>
                  </div>
                </>
              )}

              {/* Errors: inline, readable, announced — and never hidden by motion. */}
              <div>
                {error ? (
                  <p
                    key={attempt}
                    id="login-error"
                    role="alert"
                    className="login-nudge flex items-start gap-2 rounded-[10px] border border-danger/35 bg-danger-soft px-3 py-2.5 text-[13px] font-medium text-ink"
                  >
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
                    <span>{error}</span>
                  </p>
                ) : null}
              </div>

              <div className="login-stagger pt-1" style={{ ['--i' as string]: 5 }}>
                <button type="submit" className="login-btn" disabled={busy} aria-busy={phase === 'submitting'}>
                  {phase === 'submitting' ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      <span>Signing in…</span>
                    </>
                  ) : phase === 'success' ? (
                    <>
                      <Check className="size-4" aria-hidden="true" />
                      <span>Signed in</span>
                    </>
                  ) : (
                    <span>Sign in</span>
                  )}
                </button>
                <p role="status" className="sr-only">
                  {phase === 'submitting' ? 'Signing in' : phase === 'success' ? 'Signed in, opening your workspace' : ''}
                </p>
              </div>
            </form>
          </div>

          <p className="login-stagger mt-5 text-center text-[13px] text-ink-subtle" style={{ ['--i' as string]: 6 }}>
            Accounts are created by an administrator. There is no self sign-up.
          </p>
        </div>
      </section>

      {/* --- the manufacturing motion canvas -------------------------------- */}
      <section
        aria-label="Dash and Dot manufacturing workflow illustration"
        className="login-canvas relative m-3 ml-0 hidden overflow-hidden rounded-[24px] border border-[var(--glass-border)] shadow-[inset_0_1px_0_var(--glass-highlight)] md:flex md:flex-col"
      >
        <div className="login-aurora" aria-hidden="true" />

        <div className="relative z-10 px-8 pt-16 lg:px-12 lg:pt-20">
          <p className="t-micro text-ink-subtle">Dash and Dot · Manufacturing ERP</p>
          <h2 className="mt-3 max-w-[520px] font-display text-[32px] font-[650] leading-[1.1] tracking-[-0.04em] text-ink lg:text-[40px]">
            From concept to creation.
          </h2>
          <p className="mt-3 max-w-[440px] text-[15px] leading-[1.55] text-ink-muted">
            One connected workspace for manufacturing operations.
          </p>
        </div>

        <div className="relative z-10 flex flex-1 items-center justify-center px-6 pb-6 lg:px-10">
          {/* Tablet gets the calmer composition; desktop gets the full one. */}
          <div className="w-full lg:hidden">
            <ManufacturingCanvas simplified />
          </div>
          <div className="hidden w-full lg:block">
            <ManufacturingCanvas />
          </div>
        </div>

        <ul className="relative z-10 flex flex-wrap gap-x-5 gap-y-1.5 border-t border-[var(--glass-border)] px-8 py-4 text-[12.5px] text-ink-muted lg:px-12">
          {[
            ['Production', 'var(--chart-release)'],
            ['Material', 'var(--chart-issue)'],
            ['Cutting', 'var(--chart-cutting)'],
            ['Quality', 'var(--chart-qc)'],
            ['Finished goods', 'var(--chart-completed)'],
          ].map(([label, colour]) => (
            <li key={label} className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full" style={{ background: colour }} />
              {label}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function RevealButton({ reveal, onToggle, what }: { reveal: boolean; onToggle: () => void; what: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={reveal}
      aria-label={reveal ? `Hide ${what}` : `Show ${what}`}
      className="absolute right-0 top-0 grid h-[46px] w-[46px] place-items-center rounded-r-[10px] text-ink-subtle transition-colors hover:text-ink focus-visible:outline-offset-[-2px]"
    >
      {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
    </button>
  );
}
