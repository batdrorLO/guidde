import { Link, useParams } from 'react-router-dom';
import { ApiError, api, useApi } from '../api/client';
import type { AccountDetail } from '../api/types';
import { ActivityChart } from '../components/ActivityChart';
import { FlagList } from '../components/FlagList';
import { HealthBadge, TIER_TEXT } from '../components/HealthBadge';
import { PillarBreakdown } from '../components/PillarBreakdown';
import { Card, ErrorBox, Loading } from '../components/Status';
import { EVENT_LABEL, daysAgo, formatDate, formatDateTime, formatUsd } from '../lib/format';

const DAY_MS = 86_400_000;

export function AccountDetailPage() {
  const { slug = '' } = useParams();
  const { data, error, retry } = useApi(() => api.account(slug), slug);

  if (error instanceof ApiError && error.status === 404) {
    return (
      <div className="py-16 text-center">
        <p className="text-slate-600">{error.message}</p>
        <Link to="/" className="mt-3 inline-block text-sm text-indigo-600 hover:underline">
          ← Back to all accounts
        </Link>
      </div>
    );
  }
  if (error) return <ErrorBox error={error} onRetry={retry} />;
  if (!data) return <Loading />;
  return <Detail a={data} />;
}

function Detail({ a }: { a: AccountDetail }) {
  const windowStartWeek = mondayOf(new Date(Date.parse(a.asOf) - 30 * DAY_MS));
  const penalty = a.baseScore - a.score;

  return (
    <div className="space-y-6">
      <Link to="/" className="text-sm text-slate-500 hover:text-slate-900">
        ← All accounts
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-slate-900">{a.companyName}</h1>
            <HealthBadge tier={a.tier} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {a.domain} · {a.planTier}
            {a.observedPlanTier && a.observedPlanTier !== a.planTier && (
              <span className="text-rose-600"> (events show {a.observedPlanTier})</span>
            )}{' '}
            · {formatUsd(a.arrUsd)} ARR · CSM {a.csmOwner} · customer since {formatDate(a.contractStartDate)}
          </p>
          <p className="mt-3 text-slate-700">{a.summary}</p>
          {a.tierReason && <p className="mt-1 text-sm font-medium text-rose-700">{a.tierReason}</p>}
        </div>
        <div className="text-right">
          <div className={`text-5xl font-semibold tabular-nums ${TIER_TEXT[a.tier]}`}>{a.score}</div>
          <div className="text-sm text-slate-500">health score / 100</div>
          {penalty > 0 && (
            <div className="mt-1 text-xs text-slate-500">
              {a.baseScore} from usage − {penalty} penalty
            </div>
          )}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Why this score" className="lg:col-span-2">
          <PillarBreakdown pillars={a.pillars} />
        </Card>
        <div className="space-y-6">
          <Card title="Flags">
            <FlagList flags={a.flags} />
          </Card>
          <Card title="Last 30 days">
            <dl className="grid grid-cols-2 gap-y-3 text-sm">
              <Stat label="Last activity" value={daysAgo(a.stats.daysSinceLastActivity)} />
              <Stat label="Events" value={`${a.stats.events30d} (of ${a.stats.totalEvents} in 90d)`} />
              <Stat label="Active days" value={a.stats.activeDays30d} />
              <Stat label="Active users" value={`${a.stats.activeUsers30d} of ${a.stats.totalUsers}`} />
              <Stat label="Workspaces" value={a.stats.workspaces} />
            </dl>
          </Card>
        </div>
      </div>

      <Card title="Weekly activity (90 days)">
        <ActivityChart weekly={a.weekly} windowStartWeek={windowStartWeek} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Users (${a.users.length})`}>
          <SimpleTable
            head={['User', 'Events', 'Mostly', 'Last seen']}
            rows={a.users.map((u) => [
              <span className={u.active30d ? 'text-slate-900' : 'text-slate-400'}>
                {u.userId}
                {!u.active30d && <span className="ml-1 text-xs">(inactive 30d)</span>}
              </span>,
              u.events,
              EVENT_LABEL[u.topAction],
              formatDate(u.lastSeen),
            ])}
          />
        </Card>
        <Card title={`Workspaces (${a.workspaceBreakdown.length})`}>
          <SimpleTable
            head={['Workspace', 'Events', 'Last 30d', 'Users', 'Last seen']}
            rows={a.workspaceBreakdown.map((w) => [w.workspaceId, w.events, w.events30d, w.users, formatDate(w.lastSeen)])}
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

function mondayOf(d: Date): string {
  const offset = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - offset)).toISOString().slice(0, 10);
}
