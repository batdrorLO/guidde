import type { AccountStatus, PortfolioSummary } from '../api/types';
import { TIER_LABEL, formatUsdCompact } from '../lib/format';
import { TIER_BAR, TIER_TEXT } from './HealthBadge';

const ORDER: AccountStatus[] = ['at_risk', 'watch', 'healthy', 'onboarding'];

/** One tile per status; clicking a tile filters the table to it. */
export function SummaryTiles({
  summary,
  active,
  onSelect,
}: {
  summary: PortfolioSummary;
  active?: AccountStatus;
  onSelect: (status: AccountStatus | undefined) => void;
}) {
  const unknown = summary.statuses.insufficient_data;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {ORDER.map((t) => {
        const { count, arr } = summary.statuses[t];
        const selected = active === t;
        const share = summary.totalArr ? Math.round((arr / summary.totalArr) * 100) : 0;
        return (
          <button
            key={t}
            type="button"
            onClick={() => onSelect(selected ? undefined : t)}
            className={`rounded-xl border bg-white p-4 text-left shadow-sm transition hover:border-slate-300 ${
              selected ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200'
            }`}
          >
            <div className="text-sm font-medium text-slate-500">
              {t === 'onboarding' ? 'Not scored yet' : TIER_LABEL[t]}
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className={`text-3xl font-semibold tabular-nums ${TIER_TEXT[t]}`}>{count}</span>
              <span className="text-sm text-slate-500">
                account{count === 1 ? '' : 's'} · {formatUsdCompact(arr)} ARR
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full ${TIER_BAR[t]}`} style={{ width: `${share}%` }} />
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {t === 'onboarding'
                ? `Under ${summary.settings.minimumTenureDays} days of tenure${unknown.count ? ` · ${unknown.count} more with not enough data` : ''}`
                : `${share}% of total ARR`}
            </div>
          </button>
        );
      })}
    </div>
  );
}
