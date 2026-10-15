import type { HealthTier } from '../api/types';
import { TIER_LABEL } from '../lib/format';

const STYLES: Record<HealthTier, string> = {
  healthy: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  watch: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  at_risk: 'bg-rose-50 text-rose-700 ring-rose-600/20',
};

const DOT: Record<HealthTier, string> = {
  healthy: 'bg-emerald-500',
  watch: 'bg-amber-500',
  at_risk: 'bg-rose-500',
};

export function HealthBadge({ tier }: { tier: HealthTier }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[tier]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[tier]}`} />
      {TIER_LABEL[tier]}
    </span>
  );
}

export const TIER_TEXT: Record<HealthTier, string> = {
  healthy: 'text-emerald-600',
  watch: 'text-amber-600',
  at_risk: 'text-rose-600',
};

export const TIER_BAR: Record<HealthTier, string> = {
  healthy: 'bg-emerald-500',
  watch: 'bg-amber-500',
  at_risk: 'bg-rose-500',
};

/** Compact score with a mini bar, for table cells. */
export function ScoreCell({ score, tier }: { score: number; tier: HealthTier }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-7 text-right font-semibold tabular-nums ${TIER_TEXT[tier]}`}>{score}</span>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${TIER_BAR[tier]}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}
