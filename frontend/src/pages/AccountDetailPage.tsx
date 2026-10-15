import { Link, useParams } from 'react-router-dom';
import { ApiError, api, useApi } from '../api/client';
import type { AccountDetail, ActivityMetrics } from '../api/types';
import { ActivityChart } from '../components/ActivityChart';
import { FlagList } from '../components/FlagList';
import { HealthBadge, TIER_TEXT } from '../components/HealthBadge';
import { PillarBreakdown } from '../components/PillarBreakdown';
import { Card, ErrorBox, Loading } from '../components/Status';
import { EVENT_LABEL, TIER_LABEL, daysAgo, formatDate, formatDateTime, formatDay, formatPct, formatUsd } from '../lib/format';
import { useScoringSettings } from '../lib/settings';

export function AccountDetailPage() {
  const { slug = '' } = useParams();
  const { query, link } = useScoringSettings();
  // Re-fetched (and so re-scored by the API) whenever the settings change.
  const { data, error, retry } = useApi(() => api.account(slug, query), `${slug}?${query}`);

  if (error instanceof ApiError && error.status === 404) {
    return (
      <div className="py-16 text-center">
        <p className="text-slate-600">{error.message}</p>
        <Link to={link('/')} className="mt-3 inline-block text-sm text-indigo-600 hover:underline">
          ← Back to all accounts
        </Link>
      </div>
    );
  }
  if (error) return <ErrorBox error={error} onRetry={retry} />;
  if (!data) return <Loading />;
  return <Detail a={data} back={link('/')} />;
}

function Detail({ a, back }: { a: AccountDetail; back: string }) {
  const w = a.window;
  const penalty = a.baseScore !== null && a.score !== null ? a.baseScore - a.score : 0;

  return (
    <div className="space-y-6">
      <Link to={back} className="text-sm text-slate-500 hover:text-slate-900">
        ← All accounts
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="min-w-0 max-w-3xl">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-slate-900">{a.companyName}</h1>
            <HealthBadge tier={a.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {a.domain} · {a.planTier}
            {a.observedPlanTier && a.observedPlanTier !== a.planTier && (
              <span className="text-rose-600"> (events show {a.observedPlanTier})</span>
            )}{' '}
            · {formatUsd(a.arrUsd)} ARR · CSM {a.csmOwner} · customer since {formatDate(a.contractStartDate)}
            {a.tenureDays !== null && ` (${a.tenureDays} days)`}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Scored over {formatDay(w.start)} – {formatDate(w.end)} ({w.lookbackDays} days
            {w.unobservableDays > 0 && `, ${w.observableDays} with data`})
            {w.missingDataDays.length > 0 && ` · no data in the export for ${w.missingDataDays.map(formatDay).join(', ')}`} · data as of{' '}
            {formatDate(w.referenceDate)}
          </p>
          <p className="mt-3 text-slate-700">{a.summary}</p>
        </div>
        <div className="text-right">
          {a.score === null ? (
            <>
              <div className="text-2xl font-semibold text-slate-400">Not scored</div>
              <div className="text-sm text-slate-500">{TIER_LABEL[a.status]}</div>
            </>
          ) : (
            <>
              <div className={`text-5xl font-semibold tabular-nums ${TIER_TEXT[a.status]}`}>{a.score}</div>
              <div className="text-sm text-slate-500">health score / 100</div>
              {penalty > 0 && (
                <div className="mt-1 text-xs text-slate-500">
                  {a.baseScore} from usage − {penalty} penalty
                </div>
              )}
              {a.scoreTier && a.scoreTier !== a.status && (
                <div className="mt-1 text-xs text-slate-500">
                  Score alone: {TIER_LABEL[a.scoreTier]} → {TIER_LABEL[a.status]} by rule
                </div>
              )}
            </>
          )}
        </div>
      </header>

      {a.eligible ? (
        <>
          {a.overrides.length > 0 && (
            <div role="status" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
              <div className="font-semibold">
                {a.scoreTier !== a.status
                  ? `Why this account is ${TIER_LABEL[a.status]} even though its score says ${TIER_LABEL[a.scoreTier!]}`
                  : 'Status rules that apply'}
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {a.overrides.map((o) => (
                  <li key={o.code}>{o.reason}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Why this score" className="lg:col-span-2">
              <PillarBreakdown pillars={a.pillars} />
            </Card>
            <div className="space-y-6">
              {a.activity && (
                <Card title={`Activity vs. ${a.planTier} plan`}>
                  <ActivityGauge m={a.activity} plan={a.planTier} />
                </Card>
              )}
              <Card title="Flags">
                <FlagList flags={a.flags} />
              </Card>
              <WindowStats a={a} />
            </div>
          </div>
        </>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="Not scored" className="lg:col-span-2">
            <p className="text-slate-700">{a.exclusion?.message}</p>
            <p className="mt-2 text-sm text-slate-500">
              Accounts are excluded from health scoring and the risk queue until they have enough tenure, so a new
              customer is never labelled Healthy or At Risk just for being new. Lower the minimum tenure in the settings
              above to score it anyway.
            </p>
          </Card>
          <div className="space-y-6">
            <Card title="Flags">
              <FlagList flags={a.flags} />
            </Card>
            <WindowStats a={a} />
          </div>
        </div>
      )}

      <Card title="Weekly activity (whole export)">
        <ActivityChart weekly={a.weekly} windowStartWeek={mondayOf(w.start)} windowLabel={`last ${w.lookbackDays} days →`} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Users (${a.users.length})`}>
          <SimpleTable
            head={['User', 'Events', 'Mostly', 'Last seen']}
            rows={a.users.map((u) => [
              <span className={u.activeInWindow ? 'text-slate-900' : 'text-slate-400'}>
                {u.userId}
                {!u.activeInWindow && <span className="ml-1 text-xs">(inactive {w.lookbackDays}d)</span>}
              </span>,
              u.events,
              EVENT_LABEL[u.topAction],
              formatDate(u.lastSeen),
            ])}
          />
        </Card>
        <Card title={`Workspaces (${a.workspaceBreakdown.length})`}>
          <SimpleTable
            head={['Workspace', 'Events', `Last ${w.lookbackDays}d`, 'Users', 'Last seen']}
            rows={a.workspaceBreakdown.map((ws) => [ws.workspaceId, ws.events, ws.eventsInWindow, ws.users, formatDate(ws.lastSeen)])}
          />
        </Card>
      </div>

      <Card title="Most recent events">
        <SimpleTable
          head={['When (UTC)', 'Event', 'User', 'Workspace', 'Plan on event']}
          rows={a.recentEvents.map((e) => [
            formatDateTime(e.timestamp),
            EVENT_LABEL[e.eventType],
            e.userId,
            e.workspaceId,
            <span className={e.planTier !== a.planTier ? 'font-medium text-rose-600' : ''}>{e.planTier}</span>,
          ])}
        />
      </Card>
    </div>
  );
}

/** The account's activity rate on a 0–100% track, with its plan's At Risk threshold and full-credit mark. */
function ActivityGauge({ m, plan }: { m: ActivityMetrics; plan: string }) {
  const rate = m.rate ?? 0;
  const below = rate < m.atRiskRate;
  return (
    <div className="text-sm">
      <div className="flex items-baseline justify-between">
        <span className={`text-2xl font-semibold tabular-nums ${below ? 'text-rose-600' : 'text-slate-900'}`}>{formatPct(m.rate)}</span>
        <span className="text-slate-500">
          {m.activeDays} of {m.observableDays} days active
        </span>
      </div>
      <div className="relative mt-3 h-2 rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${below ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(rate, 1) * 100}%` }} />
        <Marker at={m.atRiskRate} className="bg-rose-600" />
        <Marker at={m.fullCreditRate} className="bg-emerald-700" />
      </div>
      <ul className="mt-3 space-y-1 text-slate-600">
        <li>
          <span className="mr-1.5 inline-block h-2 w-0.5 bg-rose-600 align-middle" />
          At Risk below <strong>{formatPct(m.atRiskRate)}</strong> for {plan}
        </li>
        <li>
          <span className="mr-1.5 inline-block h-2 w-0.5 bg-emerald-700 align-middle" />
          Full Activity credit at <strong>{formatPct(m.fullCreditRate)}</strong>
        </li>
      </ul>
      <p className={`mt-2 ${below ? 'font-medium text-rose-700' : 'text-slate-600'}`}>
        {below
          ? `Below the ${plan} threshold, so this account is At Risk regardless of its score.`
          : `Above the ${plan} At Risk threshold.`}
      </p>
    </div>
  );
}

function Marker({ at, className }: { at: number; className: string }) {
  return <span className={`absolute -top-1 h-4 w-0.5 ${className}`} style={{ left: `${Math.min(at, 1) * 100}%` }} aria-hidden />;
}

function WindowStats({ a }: { a: AccountDetail }) {
  return (
    <Card title={`Last ${a.window.lookbackDays} days`}>
      <dl className="grid grid-cols-2 gap-y-3 text-sm">
        <Stat label="Last activity" value={daysAgo(a.stats.daysSinceLastActivity)} />
        <Stat label="Events" value={`${a.stats.eventsInWindow} (of ${a.stats.totalEvents} total)`} />
        <Stat label="Active days" value={`${a.stats.activeDaysInWindow} of ${a.window.observableDays}`} />
        <Stat label="Active users" value={`${a.stats.activeUsersInWindow} of ${a.stats.totalUsers}`} />
        <Stat label="Workspaces" value={a.stats.workspaces} />
      </dl>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium tabular-nums text-slate-900">{value}</dd>
    </>
  );
}

function SimpleTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="max-h-80 overflow-auto">
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 bg-white text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {head.map((h) => (
              <th key={h} className="pb-2 pr-4 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="py-1.5 pr-4 text-slate-700">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Monday (UTC) of the week containing a YYYY-MM-DD day, matching the chart's week buckets. */
function mondayOf(day: string): string {
  const d = new Date(day + 'T00:00:00Z');
  const offset = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - offset)).toISOString().slice(0, 10);
}
