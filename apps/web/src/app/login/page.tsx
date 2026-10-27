'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, ScanLine } from 'lucide-react';
import { ThemeSwitcher } from '@/components/theme/theme';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/components/app/auth-context';
import { Button, Card, ErrorPanel, Field, Input } from '@/components/ui/primitives';

/**
 * Two ways in.
 *
 * Email and password for office staff, and employee code plus a short PIN for
 * shop-floor terminals - an operator at a cutting table cannot type a
 * passphrase. The PIN route is safe because of the permission matrix, not
 * because of the credential: a BARCODE_OPERATOR can record stage quantities
 * and nothing else.
 */
export default function LoginPage() {
  const router = useRouter();
  const { signIn, signInWithPin } = useAuth();
  const [mode, setMode] = React.useState<'password' | 'pin'>('password');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [employeeCode, setEmployeeCode] = React.useState('');
  const [pin, setPin] = React.useState('');
  const [error, setError] = React.useState<unknown>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'password') await signIn(email, password);
      else await signInWithPin(employeeCode, pin);
      // replace, not push: the back button after signing in should not return
      // to a login form the user has already satisfied.
      router.replace('/');
    } catch (err) {
      setError(err instanceof ApiError ? err : new Error('Could not sign in'));
      setBusy(false);
    }
  };

  return (
    <main className="relative flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeSwitcher />
      </div>
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-ink text-[14px] font-bold tracking-tighter text-canvas shadow-sm">
            D·D
          </div>
          <div>
            <h1 className="text-[18px] font-bold tracking-tight text-ink">DASH AND DOT</h1>
            <p className="text-[13px] text-ink-muted">Manufacturing ERP</p>
          </div>
        </div>

        <Card className="rounded-3xl p-6">
          <div className="mb-5 flex rounded-full border border-line bg-surface-muted p-1">
            {([
              ['password', 'Staff sign in', KeyRound],
              ['pin', 'Shop floor', ScanLine],
            ] as const).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => { setMode(value); setError(null); }}
                className={
                  'flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-medium transition-colors ' +
                  (mode === value ? 'glass-raised text-ink' : 'text-ink-muted hover:text-ink')
                }
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === 'password' ? (
              <>
                <Field label="Email" required>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="username"
                    autoFocus
                    required
                    placeholder="you@dashanddot.local"
                  />
                </Field>
                <Field label="Password" required>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label="Employee code" required>
                  <Input
                    value={employeeCode}
                    onChange={(e) => setEmployeeCode(e.target.value.toUpperCase())}
                    autoComplete="off"
                    autoFocus
                    required
                    placeholder="OP-014"
                    className="font-mono uppercase"
                  />
                </Field>
                <Field label="PIN" required hint="4 to 8 digits">
                  <Input
                    type="password"
                    inputMode="numeric"
                    pattern="\d{4,8}"
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                    autoComplete="off"
                    required
                    className="num text-center text-[18px] tracking-[0.5em]"
                  />
                </Field>
              </>
            )}

            {error ? <ErrorPanel error={error} /> : null}

            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
              Sign in
            </Button>
          </form>
        </Card>

        <p className="mt-4 text-center text-[12px] text-ink-subtle">
          Credentials are created by an administrator. There is no self sign-up.
        </p>
      </div>
    </main>
  );
}
