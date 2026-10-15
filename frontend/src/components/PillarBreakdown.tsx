import type { PillarScore } from '../api/types';

function barColor(ratio: number) {
  if (ratio >= 0.8) return 'bg-emerald-500';
  if (ratio >= 0.5) return 'bg-amber-500';
  return 'bg-rose-500';
}

/** Each pillar as a bar of points earned out of its weight, with the plain-English reason underneath. */
export function PillarBreakdown({ pillars }: { pillars: PillarScore[] }) {
  return (
    <ul className="space-y-5">
      {pillars.map((p) => (
        <li key={p.key}>
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <span className="font-medium text-slate-900">{p.label}</span>
              <span className="ml-2 text-sm text-slate-500">{p.measured}</span>
            </div>
            <span className="tabular-nums text-sm text-slate-700">
              <span className="font-semibold">{Math.round(p.points)}</span>
              <span className="text-slate-400"> / {p.weight}</span>
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${barColor(p.ratio)}`} style={{ width: `${p.ratio * 100}%` }} />
          </div>
          <p className="mt-1.5 text-sm text-slate-600">{p.explanation}</p>
        </li>
      ))}
    </ul>
  );
}
