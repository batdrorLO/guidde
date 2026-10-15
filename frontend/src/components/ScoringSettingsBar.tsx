import { api, useApi } from '../api/client';
import { formatDate, formatDay } from '../lib/format';
import { useScoringSettings } from '../lib/settings';

/**
 * The scoring window currently in effect, as echoed back by the server. The analysis
 * period and minimum tenure are set with the filters on the accounts page
 * (PeriodSelect, TenureInput) — the UI never computes scores.
 */
export function ScoringSettingsBar() {
  const { query, update } = useScoringSettings();
  const summary = useApi(() => api.summary(query), `settings-bar:${query}`);

  const w = summary.data?.window;
  const s = summary.data?.settings;
  if (!w && summary.error?.code !== 'invalid_setting') return null;

  return (
    <div className="border-b border-slate-200 bg-white/70">
      <div className="mx-auto max-w-7xl px-4 py-2 text-sm text-slate-500 sm:px-6">
        {w ? (
          <>
            Scoring <strong className="font-medium text-slate-800">{formatDay(w.start)} – {formatDate(w.end)}</strong> ({w.lookbackDays} days
            {w.unobservableDays > 0 && `, ${w.observableDays} with data`})
            {s && ` · min. tenure ${s.minimumTenureDays} days`} · data as of {formatDate(w.referenceDate)}
          </>
        ) : (
          <span className="text-rose-700">
            {summary.error?.message}{' '}
            <button type="button" className="font-medium underline" onClick={() => update({ days: undefined, minTenure: undefined })}>
              Reset to defaults
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
