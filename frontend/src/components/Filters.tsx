import { useEffect, useState } from 'react';

const select =
  'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-slate-400 focus:outline-none';

export interface FilterValues {
  q: string;
  status: string;
  plan: string;
  csm: string;
}

export function Filters({
  values,
  csms,
  onChange,
  onReset,
}: {
  values: FilterValues;
  csms: string[];
  onChange: (key: keyof FilterValues, value: string) => void;
  onReset: () => void;
}) {
  // Debounce the search box so typing doesn't refetch on every keystroke.
  const [q, setQ] = useState(values.q);
  useEffect(() => setQ(values.q), [values.q]);
  useEffect(() => {
    if (q === values.q) return;
    const t = setTimeout(() => onChange('q', q), 250);
    return () => clearTimeout(t);
  }, [q, values.q, onChange]);

  const active = values.q || values.status || values.plan || values.csm;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        placeholder="Search company or domain…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className={`${select} w-full sm:w-64`}
        aria-label="Search accounts"
      />
      <select className={select} value={values.status} onChange={(e) => onChange('status', e.target.value)} aria-label="Status">
        <option value="">All statuses</option>
        <option value="at_risk">At risk</option>
        <option value="watch">Watch</option>
        <option value="healthy">Healthy</option>
        <option value="onboarding">Onboarding (not scored)</option>
        <option value="insufficient_data">Not enough data</option>
      </select>
      <select className={select} value={values.plan} onChange={(e) => onChange('plan', e.target.value)} aria-label="Plan">
        <option value="">All plans</option>
        <option value="Enterprise">Enterprise</option>
        <option value="Pro">Pro</option>
        <option value="Free">Free</option>
      </select>
      <select className={select} value={values.csm} onChange={(e) => onChange('csm', e.target.value)} aria-label="CSM owner">
        <option value="">All CSMs</option>
        {csms.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      {active && (
        <button type="button" onClick={onReset} className="px-2 text-sm text-slate-500 hover:text-slate-900">
          Clear filters
        </button>
      )}
    </div>
  );
}
