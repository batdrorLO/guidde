import { z } from 'zod';
import {
  EVENT_TYPES,
  PLAN_TIERS,
  type Account,
  type DataQualityIssue,
  type UsageEvent,
} from '../common/types';
import { DataLoadError } from '../common/errors';

const accountRow = z.object({
  company_name: z.string().trim().min(1),
  domain: z.string().trim(),
  plan_tier: z.enum(PLAN_TIERS),
  contract_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  arr_usd: z.number().nonnegative(),
  csm_owner: z.string().trim(),
});

const eventRow = z.object({
  event_id: z.string().min(1),
  workspace_id: z.string().min(1),
  company_name: z.string().trim().min(1),
  event_type: z.enum(EVENT_TYPES),
  user_id: z.string().min(1),
  timestamp: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'invalid timestamp'),
  plan_tier: z.enum(PLAN_TIERS),
});

/** A row that failed validation, with the reason (for logs). */
export interface RejectedRow {
  file: 'accounts.json' | 'usage_events.json';
  index: number;
  reason: string;
}

/** Keep at most this many rejected-row details, so a badly broken file can't flood the logs. */
export const MAX_REJECTED_DETAILS = 20;

export interface ParsedInput {
  accounts: Account[];
  events: UsageEvent[];
  issues: DataQualityIssue[];
  rejected: RejectedRow[];
}

function reason(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || '(row)'}: ${i.message}`).join('; ');
}

/**
 * Validate raw export rows. The export is treated as untrusted: bad rows are
 * dropped and reported rather than crashing the service, and duplicate
 * event_ids are collapsed so retried deliveries don't inflate usage.
 */
export function parseRaw(rawAccounts: unknown, rawEvents: unknown): ParsedInput {
  const issues: DataQualityIssue[] = [];
  const rejected: RejectedRow[] = [];
  const reject = (file: RejectedRow['file'], index: number, err: z.ZodError) => {
    if (rejected.length < MAX_REJECTED_DETAILS) rejected.push({ file, index, reason: reason(err) });
  };

  const accounts: Account[] = [];
  let badAccounts = 0;
  for (const [index, row] of asArray(rawAccounts, 'accounts.json').entries()) {
    const r = accountRow.safeParse(row);
    if (!r.success) {
      badAccounts++;
      reject('accounts.json', index, r.error);
      continue;
    }
    accounts.push({
      companyName: r.data.company_name,
      domain: r.data.domain,
      planTier: r.data.plan_tier,
      contractStartDate: r.data.contract_start_date,
      arrUsd: r.data.arr_usd,
      csmOwner: r.data.csm_owner,
    });
  }
  if (badAccounts) {
    issues.push({
      code: 'invalid_account_rows',
      severity: 'error',
      message: `${badAccounts} account row(s) failed validation.`,
      handling: 'Dropped; those accounts are not on the dashboard.',
    });
  }

  const events: UsageEvent[] = [];
  const seen = new Set<string>();
  let badEvents = 0;
  let duplicates = 0;
  for (const [index, row] of asArray(rawEvents, 'usage_events.json').entries()) {
    const r = eventRow.safeParse(row);
    if (!r.success) {
      badEvents++;
      reject('usage_events.json', index, r.error);
      continue;
    }
    if (seen.has(r.data.event_id)) {
      duplicates++;
      continue;
    }
    seen.add(r.data.event_id);
    events.push({
      eventId: r.data.event_id,
      workspaceId: r.data.workspace_id,
      companyName: r.data.company_name,
      eventType: r.data.event_type,
      userId: r.data.user_id,
      timestamp: new Date(r.data.timestamp),
      planTier: r.data.plan_tier,
    });
  }
  if (badEvents) {
    issues.push({
      code: 'invalid_event_rows',
      severity: 'warning',
      message: `${badEvents} event row(s) failed validation (missing field, unknown type or bad timestamp).`,
      handling: 'Dropped from scoring.',
    });
  }
  if (duplicates) {
    issues.push({
      code: 'duplicate_events',
      severity: 'warning',
      message: `${duplicates} duplicate event_id(s).`,
      handling: 'Kept the first occurrence only.',
    });
  }

  events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return { accounts, events, issues, rejected };
}

function asArray(v: unknown, name: string): unknown[] {
  if (!Array.isArray(v)) {
    throw new DataLoadError(
      'data_file_wrong_shape',
      `The data file "${name}" isn't in the expected format: it should be a list of rows.`,
      `${name} must contain a JSON array ([ {...}, {...} ]); found ${v === null ? 'null' : typeof v}.`,
    );
  }
  return v;
}
