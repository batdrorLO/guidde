import { useEffect, useState, type FormEvent } from 'react';
import { api, useApi } from '../api/client';
import { useScoringSettings } from '../lib/settings';

const control =
  'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-slate-400 focus:outline-none';

/**
 * Minimum tenure, styled to sit with the list filters. Limits and the default come from
 * the scoring config; the shown value is the one the server reports it actually used.
 */
export function TenureInput() {
  const { minTenure, query, update } = useScoringSettings();
  const cfg = useApi(api.methodology, 'methodology');
  const summary = useApi(() => api.summary(query), `summary:${query}`);

  const tn = cfg.data?.tenure;
  const activeTenure = summary.data?.settings.minimumTenureDays ?? (minTenure ? Number(minTenure) : tn?.defaultMinimumDays);

  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (activeTenure !== undefined) setDraft(String(activeTenure));
  }, [activeTenure]);

  if (!tn) return null;

  const apply = (e?: FormEvent) => {
    e?.preventDefault();
    const raw = draft.trim();
    const n = Number(raw);
    if (!/^\d+$/.test(raw) || n < tn.minDays || n > tn.maxDays) {
      setError(`Min. tenure must be a whole number from ${tn.minDays} to ${tn.maxDays}.`);
      return;
    }
    setError(null);
    // Default values are left out of the URL to keep links short.
    update({ minTenure: n === tn.defaultMinimumDays ? undefined : String(n) });
  };

  return (
    <form onSubmit={apply} noValidate className="flex flex-wrap items-center gap-2">
      <label className={`${control} flex items-center gap-2 py-0 pr-2 focus-within:border-slate-400`}>
        <span className="whitespace-nowrap text-slate-500">Min. tenure</span>
        <input
          type="number"
          inputMode="numeric"
          min={tn.minDays}
          max={tn.maxDays}
          step={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => apply()}
          aria-invalid={!!error}
          className="w-14 border-0 bg-transparent py-2 text-sm tabular-nums text-slate-700 focus:outline-none"
        />
        <span className="text-slate-500">days</span>
      </label>
      {error && (
        <p role="alert" className="w-full text-xs text-rose-700">
          {error}
        </p>
      )}
    </form>
  );
}
