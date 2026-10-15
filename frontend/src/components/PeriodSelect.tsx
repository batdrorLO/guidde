import { useEffect, useState, type FormEvent } from 'react';
import { api, useApi } from '../api/client';
import { useScoringSettings } from '../lib/settings';

const control =
  'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-slate-400 focus:outline-none';

const CUSTOM = 'custom';

/**
 * Analysis period as a dropdown: the API's presets plus "Custom…", which reveals a
 * day-count input. Presets, limits and the default come from the scoring config, and
 * the selected value is the one the server reports it actually used.
 */
export function PeriodSelect() {
  const { days, query, update } = useScoringSettings();
  const cfg = useApi(api.methodology, 'methodology');
  const summary = useApi(() => api.summary(query), `summary:${query}`);

  const lb = cfg.data?.lookback;
  const activeDays = summary.data?.settings.lookbackDays ?? (days ? Number(days) : lb?.defaultDays);
  const isCustomValue = !!lb && activeDays !== undefined && !lb.presets.includes(activeDays);

  const [customOpen, setCustomOpen] = useState(false);
  const [customDays, setCustomDays] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isCustomValue) {
      setCustomOpen(true);
      setCustomDays(String(activeDays));
    }
  }, [activeDays, isCustomValue]);

  if (!lb) return null;

  // Default values are left out of the URL to keep links short.
  const setDays = (n: number) => update({ days: n === lb.defaultDays ? undefined : String(n) });

  const applyCustom = (e: FormEvent) => {
    e.preventDefault();
    const raw = customDays.trim();
    const n = Number(raw);
    if (!/^\d+$/.test(raw) || n < lb.minDays || n > lb.maxDays) {
      setError(`Enter a whole number from ${lb.minDays} to ${lb.maxDays}.`);
      return;
    }
    setError(null);
    setDays(n);
  };

  const value = customOpen ? CUSTOM : String(activeDays ?? lb.defaultDays);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className={control}
        value={value}
        aria-label="Analysis period"
        onChange={(e) => {
          setError(null);
          if (e.target.value === CUSTOM) {
            setCustomOpen(true);
            setCustomDays(String(activeDays ?? ''));
          } else {
            setCustomOpen(false);
            setDays(Number(e.target.value));
          }
        }}
      >
        {lb.presets.map((p) => (
          <option key={p} value={p}>
            Last {p} days{p === lb.defaultDays ? ' (default)' : ''}
          </option>
        ))}
        <option value={CUSTOM}>{isCustomValue ? `Custom: ${activeDays} days` : 'Custom…'}</option>
      </select>
      {customOpen && (
        <form onSubmit={applyCustom} noValidate className="flex items-center gap-1">
          <input
            type="number"
            inputMode="numeric"
            min={lb.minDays}
            max={lb.maxDays}
            step={1}
            value={customDays}
            onChange={(e) => setCustomDays(e.target.value)}
            className={`${control} w-24 tabular-nums`}
            aria-label={`Custom analysis period in days (${lb.minDays}–${lb.maxDays})`}
            aria-invalid={!!error}
            placeholder={`${lb.minDays}–${lb.maxDays}`}
          />
          <button type="submit" className={`${control} font-medium hover:bg-slate-50`}>
            Apply
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="w-full text-xs text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}
