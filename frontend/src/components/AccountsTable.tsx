import { Link } from 'react-router-dom';
import type { AccountHealth, SortKey } from '../api/types';
import { daysAgo, formatUsd } from '../lib/format';
import { HealthBadge, ScoreCell } from './HealthBadge';

interface Column {
  label: string;
  sort?: SortKey;
  className?: string;
}

const COLUMNS: Column[] = [
  { label: 'Account', sort: 'name' },
  { label: 'Health', sort: 'score' },
  { label: 'Why', className: 'hidden lg:table-cell' },
  { label: 'ARR', sort: 'arr', className: 'text-right' },
  { label: 'Last active', sort: 'lastActivity', className: 'hidden md:table-cell' },
  { label: 'CSM', className: 'hidden md:table-cell' },
];

export function AccountsTable({
  rows,
  sort,
  order,
  onSort,
}: {
  rows: AccountHealth[];
  sort: SortKey;
  order: 'asc' | 'desc' | undefined;
  onSort: (key: SortKey) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
        No accounts match these filters.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
          <tr>
            {COLUMNS.map((c) => (
              <th key={c.label} scope="col" className={`px-4 py-3 ${c.className ?? ''}`}>
                {c.sort ? (
                  <button
                    type="button"
                    onClick={() => onSort(c.sort!)}
                    className="inline-flex items-center gap-1 uppercase hover:text-slate-900"
                  >
                    {c.label}
                    {sort === c.sort && <span aria-hidden>{arrow(c.sort, order)}</span>}
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((a) => (
            <tr key={a.slug} className="group hover:bg-slate-50">
              <td className="px-4 py-3">
                <Link to={`/accounts/${a.slug}`} className="font-medium text-slate-900 group-hover:text-indigo-600">
                  {a.companyName}
                </Link>
                <div className="text-xs text-slate-500">
                  {a.planTier}
                  {a.observedPlanTier && a.observedPlanTier !== a.planTier && (
                    <span className="ml-1 text-rose-600">→ {a.observedPlanTier}</span>
                  )}{' '}
                  · {a.domain}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-col gap-1">
                  <ScoreCell score={a.score} tier={a.tier} />
                  <HealthBadge tier={a.tier} />
                </div>
              </td>
              <td className="hidden max-w-sm px-4 py-3 text-slate-600 lg:table-cell">{a.summary}</td>
              <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatUsd(a.arrUsd)}</td>
              <td className="hidden px-4 py-3 text-slate-600 md:table-cell">{daysAgo(a.stats.daysSinceLastActivity)}</td>
              <td className="hidden px-4 py-3 text-slate-600 md:table-cell">{a.csmOwner}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function arrow(key: SortKey, order: 'asc' | 'desc' | undefined): string {
  const effective = order ?? (key === 'score' || key === 'name' ? 'asc' : 'desc');
  return effective === 'asc' ? '↑' : '↓';
}
