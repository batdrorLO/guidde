import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, auth, onSessionLost } from '../api/client';
import type { AuthUser } from '../api/types';

type AuthState =
  | { status: 'checking' }
  | { status: 'signedIn'; user: AuthUser }
  /** `notice` explains why they're on the sign-in screen (expired, signed out, removed…). */
  | { status: 'signedOut'; notice?: ApiError | string }
  /** Couldn't even ask the API (it's down): show that, not a sign-in form. */
  | { status: 'unreachable'; error: ApiError };

interface AuthContextValue {
  state: AuthState;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  recheck(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'checking' });

  const recheck = useCallback(() => {
    setState({ status: 'checking' });
    auth
      .me()
      .then(({ user }) => setState({ status: 'signedIn', user }))
      .catch((err: ApiError) => {
        if (err.status === 401) setState({ status: 'signedOut' });
        // 403: signed in, but their role was taken away since.
        else if (err.status === 403) setState({ status: 'signedOut', notice: err });
        else setState({ status: 'unreachable', error: err });
      });
  }, []);

  useEffect(recheck, [recheck]);

  // Any data request that comes back 401 drops the user to the sign-in screen with the reason.
  useEffect(
    () => onSessionLost((err) => setState((s) => (s.status === 'signedIn' ? { status: 'signedOut', notice: err } : s))),
    [],
  );

  const signIn = useCallback(async (email: string, password: string) => {
    const { user } = await auth.login(email, password); // errors are shown by the form
    setState({ status: 'signedIn', user });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await auth.logout();
    } catch (err) {
      // The cookie may not have been cleared server-side; still leave the signed-in UI.
      console.error('[auth] sign-out request failed', err);
    }
    setState({ status: 'signedOut', notice: 'You have been signed out.' });
  }, []);

  return <AuthContext.Provider value={{ state, signIn, signOut, recheck }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
