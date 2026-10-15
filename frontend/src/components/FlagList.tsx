import type { HealthFlag, Severity } from '../api/types';

const STYLE: Record<Severity, string> = {
  error: 'border-rose-200 bg-rose-50 text-rose-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  info: 'border-slate-200 bg-slate-50 text-slate-700',
};

export function FlagList({ flags }: { flags: HealthFlag[] }) {
  if (flags.length === 0) return <p className="text-sm text-slate-500">No flags.</p>;
  return (
    <ul className="space-y-2">
      {flags.map((f) => (
        <li key={f.code} className={`rounded-lg border px-3 py-2 text-sm ${STYLE[f.severity]}`}>
          <div className="flex items-center justify-between gap-2 font-medium">
            {f.title}
            {f.penalty > 0 && <span className="text-xs font-semibold">−{f.penalty} pts</span>}
          </div>
          <p className="mt-0.5 opacity-90">{f.detail}</p>
        </li>
      ))}
    </ul>
  );
}
