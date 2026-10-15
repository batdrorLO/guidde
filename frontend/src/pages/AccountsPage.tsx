import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, useApi } from '../api/client';
import type { HealthTier, SortKey } from '../api/types';
import { AccountsTable } from '../components/AccountsTable';
import { Filters, type FilterValues } from '../components/Filters';
import { ErrorBox, Loading } from '../components/Status';
import { SummaryTiles } from '../components/SummaryTiles';
import { formatDate, formatUsdCompact } from '../lib/format';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'priority', label: 'Priority (risk × ARR)' },
  { value: 'score', label: 'Health score' },
  { value: 'arr', label: 'ARR' },
  { value: 'lastActivity', label: 'Last active' },
  { value: 'name', label: 'Name' },
];

export function AccountsPage() {
  // All list state lives in the URL so a filtered view can be bookmarked or shared.
  const [params, setParams] = useSearchParams();
  const summary = useApi(api.summary, 'summary');
  const accounts = useApi(() => api.accounts(params), params.toString());

  const sort = (params.get('sort') as SortKey) || 'priority';
  const order = (params.get('order') as 'asc' | 'desc' | null) ?? undefined;
  const filters: FilterValues = {
    q: params.get('q') ?? '',
    tier: params.get('tier') ?? '',
    plan: params.get('plan') ?? '',
    csm: params.get('csm') ?? '',
  };

  const setParam = useCallback(
    (key: string, value: string | undefined) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set(key, value);
          else next.delete(key);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const onSort = (key: SortKey) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (prev.get('sort') === key || (!prev.get('sort') && key === 'priority')) {
          const current = prev.get('order') ?? (key === 'score' || key === 'name' ? 'asc' : 'desc');
          next.set('order', current === 'asc' ? 'desc' : 'asc');
        } else {
          next.delete('order');
        }
        next.set('sort', key);
        return next;
      },
      { replace: true },
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Account health</h1>
          <p className="mt-1 text-sm text-slate-500">
            Where to focus this week. Sorted by priority: unhealthy accounts with the most ARR first.
          </p>
        </div>
        {summary.data && (
          <p className="text-sm text-slate-500">
            {summary.data.totalAccounts} accounts · {formatUsdCompact(summary.data.totalArr)} ARR · data as of{' '}
            {formatDate(summary.data.asOf)}
          </p>
        )}
      </div>

      {/* If both requests fail for the same reason (API down, data broken), show it once. */}
      {summary.error && !(accounts.error && accounts.error.code === summary.error.code) && (
        <ErrorBox error={summary.error} onRetry={summary.retry} />
      )}
      {summary.data && (
        <SummaryTiles
          summary={summary.data}
          active={(filters.tier || undefined) as HealthTier | undefined}
          onSelect={(t) => setParam('tier', t)}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Filters
          values={filters}
          csms={summary.data?.csms ?? []}
          onChange={setParam}
          onReset={() => setParams(sort === 'priority' ? {} : { sort }, { replace: true })}
        />
        <label className="flex items-center gap-2 text-sm text-slate-500">
          Sort by
          <select
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm"
            value={sort}
            onChange={(e) =>
              setParams(
                (prev) => {
                  const next = new URLSearchParams(prev);
                  next.set('sort', e.target.value);
                  next.delete('order');
                  return next;
                },
                { replace: true },
              )
            }
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {accounts.error ? (
        <ErrorBox
          error={accounts.error}
          onRetry={() => {
            accounts.retry();
            if (summary.error) summary.retry();
          }}
        />
      ) : accounts.data ? (
        <div className={accounts.loading ? 'opacity-60 transition-opacity' : ''}>
          <AccountsTable rows={accounts.data} sort={sort} order={order} onSort={onSort} />
          <p className="mt-2 text-xs text-slate-400">
            Showing {accounts.data.length} of {summary.data?.totalAccounts ?? '…'} accounts. Click a row to see why it scored that way.
          </p>
        </div>
      ) : (
        <Loading />
      )}
    </div>
  );
}
