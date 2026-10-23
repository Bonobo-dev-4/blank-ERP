'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { AuthenticatedUser, LoginResponse } from '@dnd/contracts';
import { api, tokenStore } from '@/lib/api';

interface AuthState {
  user: AuthenticatedUser | null;
  loading: boolean;
  /** True when the signed-in user holds this permission. */
  can: (permission: string) => boolean;
  /** True when the user holds every one of these permissions. */
  canAll: (...permissions: string[]) => boolean;
  /**
   * Sign in and adopt the resulting identity in one step.
   *
   * Sign-in lives here rather than on the login page because this provider is
   * mounted in the root layout and therefore does NOT remount on the
   * navigation to `/`. A page that only wrote the token and pushed would leave
   * `user` null, and the authenticated layout would bounce straight back to
   * `/login` - a silent redirect loop that looks exactly like a wrong password.
   */
  signIn: (email: string, password: string) => Promise<void>;
  signInWithPin: (employeeCode: string, pin: string) => Promise<void>;
  signOut: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = React.createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = React.useState<AuthenticatedUser | null>(() => tokenStore.getUser());
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    if (!tokenStore.get()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await api.me());
    } catch {
      tokenStore.clear();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // The login response already carries the full identity, so adopting it costs
  // no extra round trip - which matters on the single-connection dev database.
  const adopt = React.useCallback((res: LoginResponse) => {
    setUser(res.user);
    setLoading(false);
  }, []);

  const permissions = React.useMemo(() => new Set(user?.permissions ?? []), [user]);

  const value = React.useMemo<AuthState>(
    () => ({
      user,
      loading,
      // The UI uses this to hide what a user cannot do. It is a usability
      // measure, not a security one: the server checks every request
      // independently, so a hidden button is not a protected button.
      can: (permission: string) => permissions.has(permission),
      canAll: (...required: string[]) => required.every((p) => permissions.has(p)),
      signIn: async (email: string, password: string) => {
        adopt(await api.login(email, password));
      },
      signInWithPin: async (employeeCode: string, pin: string) => {
        adopt(await api.pinLogin(employeeCode, pin));
      },
      signOut: () => {
        tokenStore.clear();
        setUser(null);
        router.push('/login');
      },
      refresh: load,
    }),
    [user, loading, permissions, router, load, adopt],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
