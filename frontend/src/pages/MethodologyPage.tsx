import { api, useApi } from '../api/client';
import type { Severity } from '../api/types';
import { Card, ErrorBox, Loading } from '../components/Status';
import { formatDate } from '../lib/format';

const SEVERITY: Record<Severity, string> = {
  error: 'bg-rose-100 text-rose-800',
  warning: 'bg-amber-100 text-amber-800',
  info: 'bg-slate-100 text-slate-700',
};

/** The scoring rules and data issues, both read live from the API so they can't drift from the code. */
export function MethodologyPage() {
  const cfg = useApi(api.methodology, 'methodology');
  const dq = useApi(api.dataQuality, 'data-quality');

  if (cfg.error || dq.error) {
    const retry = () => {
      if (cfg.error) cfg.retry();
      if (dq.error) dq.retry();
    };
    return <ErrorBox error={(cfg.error ?? dq.error)!} onRetry={retry} />;
  }
  if (!cfg.data || !dq.data) return <Loading />;
  const c = cfg.data;
  const t = c.targets;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">How health is scored</h1>
        <p className="mt-1 text-sm text-slate-500">
          Data window {formatDate(dq.data.windowStart)} – {formatDate(dq.data.asOf)}. “Now” is the latest event in the export.
        </p>
      </div>

      <Card title="Definition">
        <p className="text-slate-700">
          <strong>A healthy account is one where people keep coming back, keep making and watching guides, the people who
          adopted it are still around, and usage isn’t fading.</strong> Each of those is a pillar, measured over the last{' '}
          {c.recentDays} days and compared to a target that scales with the plan. A bigger contract is held to a higher
          bar.
        </p>
        <table className="mt-4 w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="pb-2">Pillar</th>
              <th className="pb-2">Points</th>
              <th className="pb-2">Measures</th>
              <th className="pb-2">Full credit (Free / Pro / Ent.)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 align-top text-slate-700">
            <tr>
              <td className="py-2 font-medium">Activity</td>
              <td>{c.weights.activity}</td>
              <td className="pr-3">Distinct days with any event</td>
              <td>{t.activeDays.Free} / {t.activeDays.Pro} / {t.activeDays.Enterprise} days</td>
            </tr>
            <tr>
              <td className="py-2 font-medium">Value loop</td>
              <td>{c.weights.valueLoop}</td>
              <td className="pr-3">Half: guides created + shared. Half: guide views.</td>
              <td>
                {t.produced.Free}/{t.produced.Pro}/{t.produced.Enterprise} made · {t.consumed.Free}/{t.consumed.Pro}/
                {t.consumed.Enterprise} views
              </td>
            </tr>
            <tr>
              <td className="py-2 font-medium">User retention</td>
              <td>{c.weights.retention}</td>
              <td className="pr-3">Share of the 90-day user base still active</td>
              <td>≥ {Math.round(c.retention.fullCreditShare * 100)}%</td>
            </tr>
            <tr>
              <td className="py-2 font-medium">Momentum</td>
              <td>{c.weights.momentum}</td>
              <td className="pr-3">Events per day vs. the account’s own prior 60 days</td>
              <td>
                Flat or up (zero at −{Math.round((1 - c.momentum.zeroCreditRatio) * 100)}%)
              </td>
            </tr>
          </tbody>
        </table>
        <h3 className="mt-5 font-medium text-slate-900">Overrides</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>
            <strong>Plan downgrade</strong> (events show a lower plan than the contract): −{c.overrides.downgradePenalty}{' '}
            points, and the account can’t be Healthy.
          </li>
          <li>
            <strong>Dormant</strong> (no activity for more than {c.overrides.dormantDays} days): always At Risk.
          </li>
          <li>
            Onboarding (contract under {c.context.onboardingDays} days old), low signal (fewer than{' '}
            {c.context.lowSignalEvents} events) and multi-workspace are shown for context only and don’t change the score.
          </li>
        </ul>
        <h3 className="mt-5 font-medium text-slate-900">Tiers and priority</h3>
        <p className="mt-1 text-sm text-slate-700">
          Healthy ≥ {c.tiers.healthy} · Watch {c.tiers.watch}–{c.tiers.healthy - 1} · At risk &lt; {c.tiers.watch}. ARR is
          left out of the score on purpose: a $0 Free account can be perfectly healthy. ARR is used to rank the list
          instead, with priority = (100 − score) × log₁₀(ARR + 10).
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
