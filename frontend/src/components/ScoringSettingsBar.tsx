import { useEffect, useState, type FormEvent } from 'react';
import { api, useApi } from '../api/client';
import { formatDate, formatDay } from '../lib/format';
import { useScoringSettings } from '../lib/settings';

const input =
  'w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm tabular-nums text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';

/**
 * The CSM's scoring controls: analysis period (presets or custom) and minimum tenure.
 * Presets, limits and defaults come from the API's scoring config, and the summary
 * echoes back the window the server actually used — the UI never computes scores.
 */
export function ScoringSettingsBar() {
  const { days, minTenure, query, update } = useScoringSettings();
  const cfg = useApi(api.methodology, 'methodology');
  const summary = useApi(() => api.summary(query), `settings-bar:${query}`);

  const lb = cfg.data?.lookback;
  const tn = cfg.data?.tenure;
  const activeDays = summary.data?.settings.lookbackDays ?? (days ? Number(days) : lb?.defaultDays);
  const activeTenure = summary.data?.settings.minimumTenureDays ?? (minTenure ? Number(minTenure) : tn?.defaultMinimumDays);
  // Only decide "custom vs preset" once both the config and the applied value are known.
  const isCustomValue = !!lb && activeDays !== undefined && !lb.presets.includes(activeDays);

  const [customOpen, setCustomOpen] = useState(false);
  const [customDays, setCustomDays] = useState('');
  const [tenureDraft, setTenureDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isCustomValue) {
      setCustomOpen(true);
      setCustomDays(String(activeDays));
    }
  }, [activeDays, isCustomValue]);
  useEffect(() => {
    if (activeTenure !== undefined) setTenureDraft(String(activeTenure));
  }, [activeTenure]);

  const validate = (raw: string, min: number, max: number, what: string): number | null => {
    if (!/^\d+$/.test(raw.trim())) {
      setError(`${what} must be a whole number of days.`);
      return null;
    }
    const n = Number(raw);
    if (n < min || n > max) {
      setError(`${what} must be between ${min} and ${max} days.`);
      return null;
    }
    setError(null);
    return n;
  };

  // Default values are left out of the URL to keep links short.
  const setDays = (n: number) => update({ days: n === lb?.defaultDays ? undefined : String(n) });

  const applyCustom = (e: FormEvent) => {
    e.preventDefault();
    if (!lb) return;
    const n = validate(customDays, lb.minDays, lb.maxDays, 'The analysis period');
    if (n !== null) setDays(n);
  };

  const applyTenure = (e?: FormEvent) => {
    e?.preventDefault();
    if (!tn) return;
    const n = validate(tenureDraft, tn.minDays, tn.maxDays, 'Minimum tenure');
    if (n !== null) update({ minTenure: n === tn.defaultMinimumDays ? undefined : String(n) });
  };

  if (cfg.error) return null; // the page itself shows the API error

  const w = summary.data?.window;
  const pill = (selected: boolean) =>
    `rounded-md px-2.5 py-1 text-sm font-medium tabular-nums ${
      selected ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
    }`;

  return (
    <div className="border-b border-slate-200 bg-white/70">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2 sm:px-6">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Analysis period">
          <span className="mr-1 text-xs font-medium uppercase tracking-wide text-slate-500">Analysis period</span>
          {lb?.presets.map((p) => (
            <button
              key={p}
              type="button"
              className={pill(!customOpen && activeDays === p)}
              aria-pressed={!customOpen && activeDays === p}
              onClick={() => {
                setCustomOpen(false);
                setError(null);
                setDays(p);
              }}
            >
              {p}d
            </button>
          ))}
          <button type="button" className={pill(customOpen)} aria-pressed={customOpen} onClick={() => setCustomOpen(true)}>
            Custom
          </button>
          {customOpen && lb && (
            <form onSubmit={applyCustom} noValidate className="ml-1 flex items-center gap-1">
              <input
                type="number"
                inputMode="numeric"
                min={lb.minDays}
                max={lb.maxDays}
                step={1}
                value={customDays}
                onChange={(e) => setCustomDays(e.target.value)}
                className={input}
                aria-label={`Custom analysis period in days (${lb.minDays}–${lb.maxDays})`}
                placeholder={`${lb.minDays}–${lb.maxDays}`}
              />
              <button type="submit" className="rounded-md border border-slate-300 px-2 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Apply
              </button>
            </form>
          )}
        </div>

        {tn && (
          <form onSubmit={applyTenure} noValidate className="flex items-center gap-2">
            <label htmlFor="min-tenure" className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Min. tenure
            </label>
            <input
              id="min-tenure"
              type="number"
              inputMode="numeric"
              min={tn.minDays}
              max={tn.maxDays}
              step={1}
              value={tenureDraft}
              onChange={(e) => setTenureDraft(e.target.value)}
              onBlur={() => applyTenure()}
              className={input}
            />
            <span className="text-sm text-slate-500">days</span>
          </form>
        )}

        <div className="text-sm text-slate-500 lg:ml-auto">
          {w ? (
            <>
              Scoring <strong className="font-medium text-slate-800">{formatDay(w.start)} – {formatDate(w.end)}</strong> ({w.lookbackDays} days
              {w.unobservableDays > 0 && `, ${w.observableDays} with data`}) · data as of {formatDate(w.referenceDate)}
            </>
          ) : summary.error?.code === 'invalid_setting' ? (
            <span className="text-rose-700">
              {summary.error.message}{' '}
              <button type="button" className="font-medium underline" onClick={() => update({ days: undefined, minTenure: undefined })}>
                Reset to defaults
              </button>
            </span>
          ) : null}
        </div>
        {error && (
          <p role="alert" className="w-full text-sm text-rose-700">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
