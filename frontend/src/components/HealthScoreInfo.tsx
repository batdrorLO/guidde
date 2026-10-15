import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi } from '../api/client';
import { useScoringSettings } from '../lib/settings';

/** An "i" button that opens a short explanation of the health score. Numbers come from the API's scoring config. */
export function HealthScoreInfo() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const { link } = useScoringSettings();
  const cfg = useApi(api.methodology, 'methodology');
  const c = cfg.data;

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        aria-label="How the health score is calculated"
        className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 text-xs font-semibold text-slate-500 hover:border-slate-400 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        i
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label="How the health score is calculated"
          className="absolute left-0 top-8 z-20 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-4 text-sm font-normal text-slate-700 shadow-lg sm:left-1/2 sm:-translate-x-1/2"
        >
          <p className="font-medium text-slate-900">How the health score works</p>
          <p className="mt-1">
            Each account gets a score from 0 to 100, based on its usage in the selected analysis period and measured against what
            its plan should be doing.
          </p>
          <ul className="mt-2 space-y-1">
            <li>
              <strong>Activity</strong>{c && ` (${c.weights.activity} pts)`}: how many days people were active
            </li>
            <li>
              <strong>Value loop</strong>{c && ` (${c.weights.valueLoop} pts)`}: guides created, shared and viewed
            </li>
            <li>
              <strong>User retention</strong>{c && ` (${c.weights.retention} pts)`}: share of users still active
            </li>
            <li>
              <strong>Momentum</strong>{c && ` (${c.weights.momentum} pts)`}: usage trend vs. the period before
            </li>
          </ul>
          {c && (
            <p className="mt-2">
              Healthy ≥ {c.tiers.healthy} · Watch {c.tiers.watch}–{c.tiers.healthy - 1} · At Risk &lt; {c.tiers.watch}. Dormant
              accounts and activity below the plan threshold are always At Risk.
            </p>
          )}
          <Link to={link('/methodology')} className="mt-3 inline-block font-medium text-indigo-600 hover:text-indigo-800">
            Full methodology →
          </Link>
        </div>
      )}
    </div>
  );
}
