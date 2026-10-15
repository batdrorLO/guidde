import { useCallback, useEffect, useState } from 'react';
import type { AccountDetail, AccountHealth, AuthUser, DataQuality, PortfolioSummary, ScoringConfig } from './types';

const BASE = import.meta.env.VITE_API_URL ?? '/api';
const TIMEOUT_MS = 15_000;

/** Everything a failed request can tell the user. Mirrors the backend's ErrorBody. */
export class ApiError extends Error {
  constructor(
    /** HTTP status, or 0 when the server couldn't be reached at all. */
    readonly status: number,
    readonly code: string,
    message: string,
    readonly hint?: string,
    /** Matches the x-request-id in the server log, so a report can be traced. */
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Called when a data request comes back 401 (session expired, signed out elsewhere,
 * account removed), so the app can drop back to the sign-in screen with the reason.
 */
type SessionLostListener = (err: ApiError) => void;
const sessionLostListeners = new Set<SessionLostListener>();
export function onSessionLost(listener: SessionLostListener): () => void {
  sessionLostListeners.add(listener);
  return () => sessionLostListeners.delete(listener);
}

const UNREACHABLE_HINT = 'Make sure the backend is running (npm run dev starts it on port 3001), then retry.';

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const url = BASE + path;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      signal: controller.signal,
      // The session lives in an httpOnly cookie; "include" also sends it when the API is on another origin.
      credentials: 'include',
      headers: { accept: 'application/json', ...(body !== undefined && { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    const timedOut = controller.signal.aborted;
    const e = timedOut
      ? new ApiError(0, 'timeout', 'The server took too long to respond.', 'Try again in a moment.')
      : new ApiError(0, 'network_error', "Can't reach the Account Health API.", UNREACHABLE_HINT);
    console.error(`[api] ${method} ${url} failed: ${e.code}`, err);
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const requestId = res.headers.get('x-request-id') ?? undefined;
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const e = body?.message
      ? new ApiError(res.status, body.code ?? `http_${res.status}`, body.message, body.hint, body.requestId ?? requestId)
      : res.status >= 500
        ? // The Vite dev proxy answers with an empty 5xx when the backend is down.
          new ApiError(res.status, 'api_unavailable', "The Account Health API isn't responding.", UNREACHABLE_HINT, requestId)
        : new ApiError(res.status, `http_${res.status}`, `The request failed (HTTP ${res.status}).`, undefined, requestId);
    // A 401 on /auth/* is part of signing in (e.g. wrong password), not a lost session.
    if (res.status === 401 && !path.startsWith('/auth/')) {
      console.warn(`[api] ${method} ${url} → 401 ${e.code}: session lost`);
      sessionLostListeners.forEach((l) => l(e));
    } else if (path.startsWith('/auth/') && res.status < 500) {
      // Not signed in yet, wrong password, no access: expected outcomes shown in the UI, not bugs.
      console.info(`[api] ${method} ${url} → ${res.status} ${e.code}`);
    } else {
      console.error(`[api] ${method} ${url} → ${res.status} ${e.code}: ${e.message}`, { requestId: e.requestId });
    }
    throw e;
  }

  try {
    return (await res.json()) as T;
  } catch (err) {
    console.error(`[api] ${method} ${url}: response was not valid JSON`, err);
    throw new ApiError(res.status, 'bad_response', 'The server sent a response the app could not read.', 'Try again. If it keeps happening, report it.', requestId);
  }
}

const get = <T>(path: string) => request<T>('GET', path);

export const auth = {
  me: () => get<{ user: AuthUser }>('/auth/me'),
  login: (email: string, password: string) =>
    request<{ user: AuthUser; expiresAt: string }>('POST', '/auth/login', { email, password }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),
};

export const api = {
  accounts: (params: URLSearchParams) => get<AccountHealth[]>(`/accounts?${params}`),
  account: (slug: string) => get<AccountDetail>(`/accounts/${encodeURIComponent(slug)}`),
  summary: () => get<PortfolioSummary>('/summary'),
  dataQuality: () => get<DataQuality>('/data-quality'),
  methodology: () => get<ScoringConfig>('/methodology'),
};

export type Loadable<T> = {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  /** Re-run the request (e.g. from a "Try again" button). */
  retry: () => void;
};

/** Minimal fetch hook: refetches whenever `key` changes and ignores stale responses. */
export function useApi<T>(fetcher: () => Promise<T>, key: string): Loadable<T> {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Omit<Loadable<T>, 'retry'>>({ data: null, error: null, loading: true });

  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    fetcher()
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((err: unknown) => {
        if (!live) return;
        // Anything that isn't an ApiError is a bug in the client; still show something readable.
        const error =
          err instanceof ApiError
            ? err
            : new ApiError(0, 'client_error', 'Something went wrong in the app while loading this data.', 'Reload the page.');
        if (!(err instanceof ApiError)) console.error('[api] unexpected error', err);
        setState({ data: null, error, loading: false });
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
