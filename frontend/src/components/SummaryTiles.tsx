import type { HealthTier, PortfolioSummary } from '../api/types';
import { TIER_LABEL, formatUsdCompact } from '../lib/format';
import { TIER_TEXT } from './HealthBadge';

const ORDER: HealthTier[] = ['at_risk', 'watch', 'healthy'];

/** One tile per tier; clicking a tile filters the table to that tier. */
export function SummaryTiles({
  summary,
  active,
  onSelect,
}: {
  summary: PortfolioSummary;
  active?: HealthTier;
  onSelect: (tier: HealthTier | undefined) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {ORDER.map((t) => {
        const { count, arr } = summary.tiers[t];
        const selected = active === t;
        return (
          <button
            key={t}
            type="button"
            onClick={() => onSelect(selected ? undefined : t)}
            className={`rounded-xl border bg-white p-4 text-left shadow-sm transition hover:border-slate-300 ${
              selected ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200'
            }`}
          >
            <div className="text-sm font-medium text-slate-500">{TIER_LABEL[t]}</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className={`text-3xl font-semibold tabular-nums ${TIER_TEXT[t]}`}>{count}</span>
              <span className="text-sm text-slate-500">
                account{count === 1 ? '' : 's'} · {formatUsdCompact(arr)} ARR
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full ${t === 'healthy' ? 'bg-emerald-500' : t === 'watch' ? 'bg-amber-500' : 'bg-rose-500'}`}
                style={{ width: `${summary.totalArr ? (arr / summary.totalArr) * 100 : 0}%` }}
              />
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {summary.totalArr ? Math.round((arr / summary.totalArr) * 100) : 0}% of total ARR
            </div>
          </button>
        );
      })}
    </div>
  );
}
