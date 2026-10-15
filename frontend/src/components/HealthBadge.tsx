import type { AccountStatus } from '../api/types';
import { TIER_LABEL } from '../lib/format';

const STYLES: Record<AccountStatus, string> = {
  healthy: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  watch: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  at_risk: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  onboarding: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  insufficient_data: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

const DOT: Record<AccountStatus, string> = {
  healthy: 'bg-emerald-500',
  watch: 'bg-amber-500',
  at_risk: 'bg-rose-500',
  onboarding: 'bg-sky-500',
  insufficient_data: 'bg-slate-400',
};

export function HealthBadge({ tier }: { tier: AccountStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[tier]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[tier]}`} />
      {TIER_LABEL[tier]}
    </span>
  );
}

export const TIER_TEXT: Record<AccountStatus, string> = {
  healthy: 'text-emerald-600',
  watch: 'text-amber-600',
  at_risk: 'text-rose-600',
  onboarding: 'text-sky-600',
  insufficient_data: 'text-slate-500',
};

export const TIER_BAR: Record<AccountStatus, string> = {
  healthy: 'bg-emerald-500',
  watch: 'bg-amber-500',
  at_risk: 'bg-rose-500',
  onboarding: 'bg-sky-500',
  insufficient_data: 'bg-slate-400',
};

/** Compact score with a mini bar, for table cells. Unscored accounts show a dash, never 0. */
export function ScoreCell({ score, tier }: { score: number | null; tier: AccountStatus }) {
  if (score === null) {
    return <span className="text-slate-400" title="Not scored">—</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <span className={`w-7 text-right font-semibold tabular-nums ${TIER_TEXT[tier]}`}>{score}</span>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${TIER_BAR[tier]}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}
