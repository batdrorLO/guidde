import { api, useApi } from '../api/client';
import type { PlanTier, Severity } from '../api/types';
import { Card, ErrorBox, Loading } from '../components/Status';
import { formatDate, formatDay, formatPct } from '../lib/format';
import { useScoringSettings } from '../lib/settings';

const SEVERITY: Record<Severity, string> = {
  error: 'bg-rose-100 text-rose-800',
  warning: 'bg-amber-100 text-amber-800',
  info: 'bg-slate-100 text-slate-700',
};

const PLANS: PlanTier[] = ['Free', 'Pro', 'Enterprise'];

/** The scoring rules and data issues, both read live from the API so they can't drift from the code. */
export function MethodologyPage() {
  const { query } = useScoringSettings();
  const cfg = useApi(api.methodology, 'methodology');
  const dq = useApi(api.dataQuality, 'data-quality');
  const summary = useApi(() => api.summary(query), `summary:${query}`);

  const firstError = cfg.error ?? dq.error ?? summary.error;
  if (firstError) {
    const retry = () => {
      if (cfg.error) cfg.retry();
      if (dq.error) dq.retry();
      if (summary.error) summary.retry();
    };
    return <ErrorBox error={firstError} onRetry={retry} />;
  }
  if (!cfg.data || !dq.data || !summary.data) return <Loading />;
  const c = cfg.data;
  const { lookbackDays: N, minimumTenureDays } = summary.data.settings;
  const w = summary.data.window;
  const half = c.weights.valueLoop / 2;
  const scaled = (per30: number) => {
    const v = (per30 * N) / 30;
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">How health is scored</h1>
        <p className="mt-1 text-sm text-slate-500">
          Currently: the last <strong>{N} days</strong> ({formatDay(w.start)} – {formatDate(w.end)}), minimum tenure{' '}
          <strong>{minimumTenureDays} days</strong>. Change both with the filters on the Accounts page. Export covers {formatDate(dq.data.windowStart)} –{' '}
          {formatDate(dq.data.asOf)}.
        </p>
      </div>

      <Card title="Definition">
        <p className="text-slate-700">
          <strong>
            A healthy account is one where people keep coming back, keep making and watching guides, the people who adopted it are
            still around, and usage isn’t fading — measured against what its plan should be doing.
          </strong>
        </p>
        <h3 className="mt-4 font-medium text-slate-900">Reference date and analysis period</h3>
        <p className="mt-1 text-sm text-slate-700">
          “Now” is the latest event in the export ({formatDate(w.referenceDate)}), never today’s date. The analysis period is the{' '}
          {N} calendar days ending on that day, both ends included (default {c.lookback.defaultDays}; presets{' '}
          {c.lookback.presets.join(', ')}; or any whole number from {c.lookback.minDays} to {c.lookback.maxDays}). Days the export
          can’t show — before it starts, or days with no events from <em>any</em> account — are left out rather than counted as
          inactive{w.unobservableDays > 0 && `: ${w.unobservableDays} of the current ${N} days`}. A day with no events from
          anyone is treated as <strong>missing data</strong> (an ingestion gap), not as every customer going quiet at once: it
          doesn’t count toward Activity, Momentum or the dormancy count, affected accounts get a “Missing data” flag, and
          activity charts mark that week.
        </p>
        <h3 className="mt-4 font-medium text-slate-900">Minimum tenure</h3>
        <p className="mt-1 text-sm text-slate-700">
          Accounts whose contract started fewer than {minimumTenureDays} days before the reference date (default{' '}
          {c.tenure.defaultMinimumDays}) are shown as <strong>Onboarding</strong>: no score, no tier, not in the risk queue. An
          account whose start date can’t be read is shown as <strong>Not enough data</strong> instead of being assumed old enough.
        </p>
      </Card>

      <Card title="The four pillars (0–100)">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="pb-2">Pillar</th>
              <th className="pb-2">Max</th>
              <th className="pb-2">Formula</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 align-top text-slate-700">
            <tr>
              <td className="py-2 font-medium">Activity</td>
              <td>{c.weights.activity}</td>
              <td className="py-2">
                activity rate = active days ÷ observable days; points = {c.weights.activity} × min(rate ÷ plan full-credit rate, 1)
              </td>
            </tr>
            <tr>
              <td className="py-2 font-medium">Value loop</td>
              <td>{c.weights.valueLoop}</td>
              <td className="py-2">
                {half} × min(guides created + shared ÷ target, 1) + {half} × min(guide views ÷ target, 1). Targets are per 30 days,
                scaled × {N}/30. Logins and invites don’t count.
              </td>
            </tr>
            <tr>
              <td className="py-2 font-medium">User retention</td>
              <td>{c.weights.retention}</td>
              <td className="py-2">
                {c.weights.retention} × min((users active in the period ÷ all users in the export) ÷{' '}
                {formatPct(c.retention.fullCreditRate)}, 1). No users → 0, never “full retention”.
              </td>
            </tr>
            <tr>
              <td className="py-2 font-medium">Momentum</td>
              <td>{c.weights.momentum}</td>
              <td className="py-2">
                Events per observable day in the period vs. the {c.momentum.baselineMultiplier * N} days before it (they never
                overlap), +{c.momentum.smoothing} smoothing. Flat or up = full; down {Math.round((1 - c.momentum.zeroCreditRatio) * 100)}%
                or more = 0. If less than {formatPct(c.momentum.minBaselineCoverage)} of that earlier period is in the export,
                momentum is neutral ({c.momentum.insufficientBaselineCredit * c.weights.momentum}/{c.weights.momentum})
                {!w.baseline.sufficient && <strong> — which is the case for the current {N}-day period</strong>}.
              </td>
            </tr>
          </tbody>
        </table>
      </Card>

      <Card title="Plan expectations">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="pb-2">Plan</th>
              <th className="pb-2">Full activity credit</th>
              <th className="pb-2">At Risk below</th>
              <th className="pb-2">Made/shared ({N}d)</th>
              <th className="pb-2">Views ({N}d)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 tabular-nums text-slate-700">
            {PLANS.map((p) => {
              const e = c.planExpectations[p];
              return (
                <tr key={p}>
                  <td className="py-2 font-medium">{p}</td>
                  <td>{formatPct(e.fullCreditActivityRate)}</td>
                  <td className="font-medium text-rose-700">{formatPct(e.atRiskActivityRate)}</td>
                  <td>
                    {scaled(e.producedPer30Days)} <span className="text-slate-400">({e.producedPer30Days}/30d)</span>
                  </td>
                  <td>
                    {scaled(e.consumedPer30Days)} <span className="text-slate-400">({e.consumedPer30Days}/30d)</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-sm text-slate-600">
          Example: 10 active days out of 30 is 33.3%. That’s fine for Free (threshold 15%) but At Risk for Enterprise (threshold
          40%), even if every other pillar is perfect.
        </p>
      </Card>

      <Card title="Status rules, in order">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
          <li>Resolve plan, reference date, tenure and data coverage.</li>
          <li>Below minimum tenure → Onboarding; start date unusable → Not enough data. Neither is scored or ranked.</li>
          <li>Compute the four pillars.</li>
          <li>
            Plan downgrade (events show a lower plan than the contract): −{c.overrides.downgradePenalty} points, clamped to 0–100.
          </li>
          <li>
            Score tier: Healthy ≥ {c.tiers.healthy} · Watch {c.tiers.watch}–{c.tiers.healthy - 1} · At Risk &lt; {c.tiers.watch}.
          </li>
          <li>
            Hard rules, all reported when several apply: <strong>dormant</strong> (no activity for more than{' '}
            {c.overrides.dormantDays} days) → At Risk; <strong>activity below the plan threshold</strong> → At Risk;{' '}
            <strong>downgrade</strong> → can’t be Healthy. The numeric score is never changed to force a status.
          </li>
        </ol>
        <p className="mt-3 text-sm text-slate-700">
          <strong>Priority</strong> = (100 − score) × log₁₀(ARR + 10). ARR is never part of the score. The queue groups by status
          (At Risk, Watch, Healthy) and ranks by priority inside each group, so an account forced to At Risk by a rule sits with
          the other At Risk accounts. Onboarding accounts have no priority and come last. Context flags (onboarding under{' '}
          {c.context.onboardingDays} days, fewer than {c.context.lowSignalEvents} events, several workspaces) never change the
          score.
        </p>
        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          All targets and thresholds are initial business assumptions, not validated churn predictors. They need calibrating
          against real renewal and churn outcomes before anyone relies on them.
        </p>
      </Card>

      <Card title={`Data quality (${dq.data.issues.length} notes)`}>
        <ul className="space-y-3">
          {dq.data.issues.map((i, idx) => (
            <li key={idx} className="text-sm">
              <span className={`mr-2 rounded px-1.5 py-0.5 text-xs font-medium ${SEVERITY[i.severity]}`}>{i.severity}</span>
              <span className="text-slate-800">{i.message}</span>
              <p className="ml-1 mt-0.5 text-slate-500">→ {i.handling}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
