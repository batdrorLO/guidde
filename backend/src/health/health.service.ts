import { Injectable, Logger } from '@nestjs/common';
import { DAY_MS, weekStart } from '../common/dates';
import {
  EVENT_TYPES,
  HEALTH_TIERS,
  type AccountDetail,
  type AccountHealth,
  type DataQualityIssue,
  type Dataset,
  type EventType,
  type HealthTier,
  type PlanTier,
  type PortfolioSummary,
  type UsageEvent,
  type WeeklyActivity,
} from '../common/types';
import { DatasetService } from '../data/dataset.service';
import { scoreAccount } from './health-scoring';
import { SCORING } from './scoring.config';

export const SORT_KEYS = ['priority', 'score', 'arr', 'name', 'lastActivity'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export interface AccountQuery {
  tier?: HealthTier;
  plan?: PlanTier;
  csm?: string;
  q?: string;
  sort?: SortKey;
  order?: 'asc' | 'desc';
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  /** Scores for the currently loaded dataset; recomputed if the dataset is (re)loaded. */
  private scored: { dataset: Dataset; health: AccountHealth[]; issues: DataQualityIssue[] } | null = null;

  constructor(private readonly data: DatasetService) {}

  /**
   * Score lazily: if the data failed to load, `data.get()` throws a 503 that
   * explains why, instead of the whole API failing to start.
   */
  private get health(): AccountHealth[] {
    return this.ensureScored().health;
  }

  private ensureScored() {
    const ds = this.data.get();
    if (this.scored?.dataset === ds) return this.scored;

    const started = Date.now();
    const ctx = { asOf: ds.asOf, windowStart: ds.windowStart, gapDays: ds.gapDays };
    const health: AccountHealth[] = [];
    const issues: DataQualityIssue[] = [];
    // One account that trips a scoring bug shouldn't blank the dashboard for everyone else.
    for (const record of ds.records) {
      try {
        health.push(scoreAccount(record, ctx));
      } catch (err) {
        this.logger.error(
          `Failed to score "${record.account.companyName}": ${(err as Error).message}`,
          (err as Error).stack,
        );
        issues.push({
          code: 'scoring_failed',
          severity: 'error',
          message: `"${record.account.companyName}" could not be scored because of an internal error.`,
          handling: 'Left off the dashboard. Details are in the server log.',
          companyName: record.account.companyName,
        });
      }
    }
    this.logger.log(
      `Scored ${health.length}/${ds.records.length} accounts in ${Date.now() - started}ms` +
        (issues.length ? ` (${issues.length} failed)` : ''),
    );
    this.scored = { dataset: ds, health, issues };
    return this.scored;
  }

  /** Data-load issues plus any accounts that failed to score. */
  private allIssues(ds: Dataset): DataQualityIssue[] {
    return [...ds.issues, ...this.ensureScored().issues];
  }

  list(query: AccountQuery = {}): AccountHealth[] {
    const q = query.q?.trim().toLowerCase();
    const rows = this.health.filter(
      (a) =>
        (!query.tier || a.tier === query.tier) &&
        (!query.plan || a.planTier === query.plan) &&
        (!query.csm || a.csmOwner === query.csm) &&
        (!q || a.companyName.toLowerCase().includes(q) || a.domain.toLowerCase().includes(q)),
    );

    const sort = query.sort ?? 'priority';
    const defaultOrder = sort === 'score' || sort === 'name' ? 'asc' : 'desc';
    const dir = (query.order ?? defaultOrder) === 'asc' ? 1 : -1;
    const lastMs = (a: AccountHealth) => (a.stats.lastActivity ? Date.parse(a.stats.lastActivity) : 0);
    const cmp: Record<SortKey, (a: AccountHealth, b: AccountHealth) => number> = {
      priority: (a, b) => a.priority - b.priority || b.score - a.score,
      score: (a, b) => a.score - b.score || b.arrUsd - a.arrUsd,
      arr: (a, b) => a.arrUsd - b.arrUsd,
      name: (a, b) => a.companyName.localeCompare(b.companyName),
      lastActivity: (a, b) => lastMs(a) - lastMs(b),
    };
    return [...rows].sort((a, b) => dir * cmp[sort](a, b));
  }

  summary(): PortfolioSummary {
    const ds = this.data.get();
    const tiers = Object.fromEntries(
      HEALTH_TIERS.map((t) => {
        const rows = this.health.filter((a) => a.tier === t);
        return [t, { count: rows.length, arr: rows.reduce((s, a) => s + a.arrUsd, 0) }];
      }),
    ) as PortfolioSummary['tiers'];
    return {
      asOf: ds.asOf.toISOString(),
      windowStart: ds.windowStart.toISOString(),
      totalAccounts: this.health.length,
      totalArr: this.health.reduce((s, a) => s + a.arrUsd, 0),
      tiers,
      csms: [...new Set(this.health.map((a) => a.csmOwner))].sort(),
      dataIssueCount: this.allIssues(ds).filter((i) => i.severity !== 'info').length,
    };
  }

  dataQuality() {
    const ds = this.data.get();
    return {
      asOf: ds.asOf.toISOString(),
      windowStart: ds.windowStart.toISOString(),
      gapDays: ds.gapDays,
      issues: this.allIssues(ds),
    };
  }

  methodology() {
    return SCORING;
  }

  detail(slug: string): AccountDetail | null {
    const ds = this.data.get();
    const record = ds.records.find((r) => r.slug === slug);
    const health = this.health.find((a) => a.slug === slug);
    if (!record || !health) return null;
    const { events } = record;
    const recentStart = ds.asOf.getTime() - SCORING.recentDays * DAY_MS;
    const zeroCounts = () => Object.fromEntries(EVENT_TYPES.map((t) => [t, 0])) as Record<EventType, number>;

    // Monday-start weeks covering the whole window, including empty ones, so gaps are visible.
    const weeks = new Map<string, WeeklyActivity>();
    for (let t = Date.parse(weekStart(ds.windowStart)); t <= ds.asOf.getTime(); t += 7 * DAY_MS) {
      const k = new Date(t).toISOString().slice(0, 10);
      weeks.set(k, { weekStart: k, ...zeroCounts() });
    }
    for (const e of events) {
      const w = weeks.get(weekStart(e.timestamp));
      if (w) w[e.eventType]++;
    }

    const workspaceBreakdown = [...groupBy(events, (e) => e.workspaceId)]
      .map(([workspaceId, evs]) => ({
        workspaceId,
        events: evs.length,
        events30d: evs.filter((e) => e.timestamp.getTime() > recentStart).length,
        users: new Set(evs.map((e) => e.userId)).size,
        lastSeen: evs[evs.length - 1].timestamp.toISOString(),
      }))
      .sort((a, b) => b.events - a.events);

    const users = [...groupBy(events, (e) => e.userId)]
      .map(([userId, evs]) => {
        const counts = zeroCounts();
        for (const e of evs) counts[e.eventType]++;
        const last = evs[evs.length - 1].timestamp;
        return {
          userId,
          events: evs.length,
          lastSeen: last.toISOString(),
          active30d: last.getTime() > recentStart,
          topAction: (Object.entries(counts) as [EventType, number][]).sort((a, b) => b[1] - a[1])[0][0],
        };
      })
      .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));

    const recentEvents = events
      .slice(-20)
      .reverse()
      .map((e) => ({
        eventId: e.eventId,
        timestamp: e.timestamp.toISOString(),
        eventType: e.eventType,
        userId: e.userId,
        workspaceId: e.workspaceId,
        planTier: e.planTier,
      }));

    return {
      ...health,
      asOf: ds.asOf.toISOString(),
      weekly: [...weeks.values()],
      workspaceBreakdown,
      users,
      recentEvents,
    };
  }
}

function groupBy(events: UsageEvent[], key: (e: UsageEvent) => string): Map<string, UsageEvent[]> {
  const m = new Map<string, UsageEvent[]>();
  for (const e of events) {
    const k = key(e);
    const list = m.get(k);
    if (list) list.push(e);
    else m.set(k, [e]);
  }
  return m;
}
