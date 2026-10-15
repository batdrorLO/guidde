import { ApiError } from '../api/client';

export function Loading() {
  return <div className="py-16 text-center text-sm text-slate-500">Loading…</div>;
}

const TITLES: Record<string, string> = {
  network_error: 'Can’t reach the server',
  api_unavailable: 'Can’t reach the server',
  timeout: 'The server is taking too long',
  account_not_found: 'Account not found',
  invalid_query: 'That filter isn’t valid',
  access_denied: 'No access',
};

/** Shows what went wrong, what to do about it, and a reference to find it in the server logs. */
export function ErrorBox({ error, onRetry, title }: { error: Error; onRetry?: () => void; title?: string }) {
  const api = error instanceof ApiError ? error : null;
  const heading =
    title ??
    (api && TITLES[api.code]) ??
    (api && api.status === 503 ? 'Account data is unavailable' : 'Couldn’t load this data');

  return (
    <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold">{heading}</div>
          <p className="mt-1">{error.message}</p>
          {api?.hint && <p className="mt-1 text-rose-800/90">{api.hint}</p>}
          {api && (api.requestId || api.status > 0) && (
            <p className="mt-2 font-mono text-xs text-rose-700/70">
              {api.code}
              {api.status > 0 && ` · HTTP ${api.status}`}
              {api.requestId && ` · ref ${api.requestId}`}
            </p>
          )}
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-sm font-medium text-rose-800 hover:bg-rose-100"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

export function Card({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      {title && <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>}
      {children}
    </section>
  );
}
