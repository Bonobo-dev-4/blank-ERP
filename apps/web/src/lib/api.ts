'use client';

import type { ApiErrorBody, AuthenticatedUser, LoginResponse, Paginated } from '@dnd/contracts';

const TOKEN_KEY = 'dnd.accessToken';
const REFRESH_KEY = 'dnd.refreshToken';
const USER_KEY = 'dnd.user';

/**
 * Typed error carrying the API's machine-readable code and the actual numbers
 * that failed a check, so a form can show "requested 300, available 262.5"
 * rather than "something went wrong".
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly fieldErrors?: Record<string, string[]>,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when retrying the identical request could succeed. */
  get isRetryable(): boolean {
    return this.status >= 500 || this.code === 'REQUEST_IN_FLIGHT' || this.code === 'TRANSACTION_CONFLICT';
  }
}

export const tokenStore = {
  get: (): string | null => (typeof window === 'undefined' ? null : localStorage.getItem(TOKEN_KEY)),
  getRefresh: (): string | null => (typeof window === 'undefined' ? null : localStorage.getItem(REFRESH_KEY)),
  getUser: (): AuthenticatedUser | null => {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw) as AuthenticatedUser; } catch { return null; }
  },
  set: (res: LoginResponse): void => {
    localStorage.setItem(TOKEN_KEY, res.accessToken);
    localStorage.setItem(REFRESH_KEY, res.refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
  },
  clear: (): void => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

type Query = Record<string, string | number | boolean | null | undefined>;

export function qs(params: Query = {}): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Refresh the access token at most once, even if ten queries fail at the same
 * moment. Without the shared promise, a dashboard with eight panels would fire
 * eight refreshes and invalidate its own session.
 */
async function refreshOnce(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  const refreshToken = tokenStore.getRefresh();
  if (!refreshToken) return false;

  refreshInFlight = (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) { tokenStore.clear(); return false; }
      tokenStore.set((await res.json()) as LoginResponse);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: { retryOn401?: boolean; raw?: boolean; headers?: Record<string, string> } = {},
): Promise<T> {
  const token = tokenStore.get();
  const headers: Record<string, string> = { ...options.headers };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401 && options.retryOn401 !== false && (await refreshOnce())) {
    return request<T>(method, path, body, { ...options, retryOn401: false });
  }

  if (!res.ok) {
    let payload: Partial<ApiErrorBody> = {};
    try { payload = (await res.json()) as ApiErrorBody; } catch { /* non-JSON error body */ }
    if (res.status === 401) {
      tokenStore.clear();
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    throw new ApiError(
      res.status,
      payload.code ?? `HTTP_${res.status}`,
      payload.message ?? res.statusText ?? 'Request failed',
      payload.details,
      payload.fieldErrors as Record<string, string[]> | undefined,
      res.headers.get('x-request-id') ?? undefined,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', `${path}${qs(query)}`),
  post: <T>(path: string, body?: unknown, opts?: { headers?: Record<string, string> }) =>
    request<T>('POST', path, body, { headers: opts?.headers }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),

  /** Fetch a binary response (a label PDF) and hand back a blob URL. */
  async postForBlob(path: string, body: unknown): Promise<Blob> {
    const token = tokenStore.get();
    const res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let payload: Partial<ApiErrorBody> = {};
      try { payload = (await res.json()) as ApiErrorBody; } catch { /* ignore */ }
      throw new ApiError(res.status, payload.code ?? 'DOWNLOAD_FAILED', payload.message ?? 'Could not generate the file');
    }
    return res.blob();
  },

  async login(email: string, password: string): Promise<LoginResponse> {
    const res = await request<LoginResponse>('POST', '/auth/login', { email, password }, { retryOn401: false });
    tokenStore.set(res);
    return res;
  },

  async pinLogin(employeeCode: string, pin: string): Promise<LoginResponse> {
    const res = await request<LoginResponse>('POST', '/auth/pin-login', { employeeCode, pin }, { retryOn401: false });
    tokenStore.set(res);
    return res;
  },

  me: () => request<AuthenticatedUser>('GET', '/auth/me'),
};

export type { Paginated };
