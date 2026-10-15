import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

const input =
  'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';

/** Shown in place of any page while signed out, so after signing in the user lands where they were going. */
export function LoginPage({ notice }: { notice?: ApiError | string }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err
          : new ApiError(0, 'client_error', 'Something went wrong while signing in.', 'Reload the page and try again.'),
      );
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  };

  // Show the sign-in error if there is one; otherwise why they ended up here.
  const banner = error ?? notice;
  const isInfo = !error && (typeof notice === 'string' || notice?.code === 'session_expired');

  return (
    <div className="mx-auto mt-12 max-w-sm">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Sign in</h1>
        <p className="mt-1 text-sm text-slate-500">The Account Health dashboard is for the Customer Success team.</p>

        {banner && (
          <div
            role={isInfo ? 'status' : 'alert'}
            className={`mt-4 rounded-lg border p-3 text-sm ${
              isInfo ? 'border-slate-200 bg-slate-50 text-slate-700' : 'border-rose-200 bg-rose-50 text-rose-900'
            }`}
          >
            {typeof banner === 'string' ? (
              banner
            ) : (
              <>
                <div className="font-medium">{banner.message}</div>
                {banner.hint && <div className="mt-0.5">{banner.hint}</div>}
              </>
            )}
          </div>
        )}

        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <label className="block text-sm font-medium text-slate-700">
            Work email
            <input
              type="email"
              autoComplete="username"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={input}
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={input}
            />
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
