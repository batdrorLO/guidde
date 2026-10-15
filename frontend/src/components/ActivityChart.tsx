import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { EVENT_TYPES, type WeeklyActivity } from '../api/types';
import { EVENT_COLOR, EVENT_LABEL } from '../lib/format';

const shortDate = (iso: string) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * Weekly events stacked by type, with a marker at the week the scoring window starts.
 * Weeks that include a day missing from the export are marked with * so a short bar
 * isn't read as a drop in usage.
 */
export function ActivityChart({
  weekly,
  windowStartWeek,
  windowLabel = 'scoring window →',
}: {
  weekly: WeeklyActivity[];
  windowStartWeek?: string;
  windowLabel?: string;
}) {
  // Only draw the marker if that week is on the chart (a long window can start before the export does).
  const marker = windowStartWeek && weekly.some((w) => w.weekStart === windowStartWeek) ? windowStartWeek : undefined;
  const missingByWeek = new Map(weekly.filter((w) => w.missingDays.length).map((w) => [w.weekStart, w.missingDays]));
  const allMissing = [...missingByWeek.values()].flat();
  return (
    <div className="w-full">
      <div className="h-64 w-full">
        <ResponsiveContainer>
          <BarChart data={weekly} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid vertical={false} stroke="#e2e8f0" />
            <XAxis
              dataKey="weekStart"
              tickFormatter={(d: string) => shortDate(d) + (missingByWeek.has(d) ? '*' : '')}
              tick={{ fontSize: 11, fill: '#64748b' }}
              tickLine={false}
            />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
            <Tooltip
              labelFormatter={(l) => {
                const missing = missingByWeek.get(String(l));
                return `Week of ${shortDate(String(l))}${missing ? ` · no data for ${missing.map(shortDate).join(', ')}` : ''}`;
              }}
              formatter={(v, name) => [v, EVENT_LABEL[name as keyof typeof EVENT_LABEL] ?? name]}
              cursor={{ fill: '#f1f5f9' }}
            />
            <Legend
              formatter={(v) => <span className="text-xs text-slate-600">{EVENT_LABEL[v as keyof typeof EVENT_LABEL]}</span>}
            />
            {marker && (
              <ReferenceLine
                x={marker}
                stroke="#334155"
                strokeDasharray="4 3"
                label={{ value: windowLabel, position: 'insideTopLeft', fontSize: 11, fill: '#334155' }}
              />
            )}
            {EVENT_TYPES.map((t) => (
              <Bar key={t} dataKey={t} stackId="a" fill={EVENT_COLOR[t]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {allMissing.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          * The export has no data for {allMissing.map(shortDate).join(', ')}. That week’s bar is missing a day of data; it
          doesn’t mean usage dropped.
        </p>
      )}
    </div>
  );
}
