import { DAY_MS, isoDay, startOfUtcDay } from '../common/dates';
import type { Account, AccountRecord, DataQualityIssue, Dataset, UsageEvent } from '../common/types';

/** Join key for company names: case-, whitespace- and punctuation-insensitive ("&" == "and"). */
export function companyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function slugify(name: string): string {
  return companyKey(name).replace(/ /g, '-');
}

/**
 * Join events to accounts (company name is the only shared key), roll every
 * workspace up to its account, and record anything that looks off.
 */
export function buildDataset(
  accounts: Account[],
  events: UsageEvent[],
  upstreamIssues: DataQualityIssue[] = [],
): Dataset {
  if (events.length === 0) throw new Error('No valid usage events to score.');
  const issues = [...upstreamIssues];
  const asOf = events[events.length - 1].timestamp;
  const windowStart = startOfUtcDay(events[0].timestamp);

  const byKey = new Map<string, AccountRecord>();
  for (const account of accounts) {
    const key = companyKey(account.companyName);
    if (byKey.has(key)) {
      issues.push({
        code: 'duplicate_account',
        severity: 'warning',
        message: `"${account.companyName}" appears more than once in accounts.json.`,
        handling: 'Kept the first row.',
        companyName: account.companyName,
      });
      continue;
    }
    byKey.set(key, { slug: slugify(account.companyName), account, events: [] });
  }

  const orphans = new Map<string, number>();
  for (const e of events) {
    const rec = byKey.get(companyKey(e.companyName));
    if (rec) rec.events.push(e);
    else orphans.set(e.companyName, (orphans.get(e.companyName) ?? 0) + 1);
  }
  for (const [name, count] of orphans) {
    issues.push({
      code: 'event_without_account',
      severity: 'warning',
      message: `${count} event(s) for "${name}", which has no row in accounts.json.`,
      handling: 'Excluded: with no ARR or CSM owner there is nobody to act on it. Fix upstream.',
      companyName: name,
    });
  }

  const records = [...byKey.values()];
  for (const { account, events: evs } of records) {
    if (evs.length === 0) {
      issues.push({
        code: 'account_without_events',
        severity: 'warning',
        message: `"${account.companyName}" has no events in the export window.`,
        handling: 'Kept and scored as fully inactive (At Risk).',
        companyName: account.companyName,
      });
      continue;
    }

    const workspaces = [...new Set(evs.map((e) => e.workspaceId))];
    if (workspaces.length > 1) {
      issues.push({
        code: 'multi_workspace',
        severity: 'info',
        message: `"${account.companyName}" runs ${workspaces.length} workspaces (${workspaces.join(', ')}).`,
        handling: 'Rolled up into one account for scoring; per-workspace breakdown is in the drill-down.',
        companyName: account.companyName,
      });
    }

    const mismatched = evs.filter((e) => e.planTier !== account.planTier);
    if (mismatched.length > 0) {
      const tiers = [...new Set(mismatched.map((e) => e.planTier))].join('/');
      issues.push({
        code: 'plan_tier_mismatch',
        severity: 'warning',
        message: `"${account.companyName}": ${mismatched.length} event(s) tagged ${tiers} since ${isoDay(mismatched[0].timestamp)}, but accounts.json says ${account.planTier}.`,
        handling:
          'accounts.json stays the contract of record (ARR, targets). A drop to a lower tier on events is scored as a downgrade risk.',
        companyName: account.companyName,
      });
    }
  }

  const gapDays = findGapDays(events, windowStart, asOf);
  if (gapDays.length > 0) {
    issues.push({
      code: 'missing_days',
      severity: 'warning',
      message: `Missing data on ${gapDays.join(', ')}: the export has no events at all for ${gapDays.length === 1 ? 'that day' : 'those days'}, from any account.`,
      handling:
        'Treated as missing data.',
    });
  }

  records.sort((a, b) => a.account.companyName.localeCompare(b.account.companyName));
  return { asOf, windowStart, gapDays, records, issues };
}

function findGapDays(events: UsageEvent[], start: Date, end: Date): string[] {
  const active = new Set(events.map((e) => isoDay(e.timestamp)));
  const gaps: string[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) {
    const d = isoDay(new Date(t));
    if (!active.has(d)) gaps.push(d);
  }
  return gaps;
}
