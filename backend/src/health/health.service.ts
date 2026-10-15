import { Injectable, Logger } from '@nestjs/common';
import { isoDay, weekStart } from '../common/dates';
import {
  ACCOUNT_STATUSES,
  EVENT_TYPES,
  type AccountDetail,
  type AccountHealth,
  type AccountStatus,
  type AnalysisWindow,
  type DataQualityIssue,
  type Dataset,
  type EventType,
  type PlanTier,
  type PortfolioSummary,
  type UsageEvent,
  type WeeklyActivity,
} from '../common/types';
import { DatasetService } from '../data/dataset.service';
import { buildWindow, scoreAccount } from './health-scoring';
import { DEFAULT_SETTINGS, SCORING, type ScoringSettings } from './scoring.config';

export const SORT_KEYS = ['priority', 'score', 'arr', 'name', 'lastActivity'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export interface AccountQuery {
  status?: AccountStatus;
  plan?: PlanTier;
  csm?: string;
  q?: string;
  sort?: SortKey;
  order?: 'asc' | 'desc';
}

/**
 * Work-queue order: the effective status decides the group (so an account forced to
 * At Risk by a hard rule sits with the other At Risk accounts), then priority within it.
 * Accounts that aren't scored come last.
 */
const STATUS_ORDER: Record<AccountStatus, number> = {
  at_risk: 0,
  watch: 1,
  healthy: 2,
  onboarding: 3,
  insufficient_data: 4,
};

interface Scored {
  window: AnalysisWindow;
  health: AccountHealth[];
  issues: DataQualityIssue[];
}

/** Max distinct (period, tenure) combinations kept in memory. */
const CACHE_LIMIT = 32;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private cacheFor: Dataset | null = null;
  private readonly cache = new Map<string, Scored>();

  constructor(private readonly data: DatasetService) {}

  /**
   * Score lazily per settings: if the data failed to load, `data.get()` throws a 503
   * that explains why, instead of the whole API failing to start.
   */
  private scored(settings: ScoringSettings): Scored & { dataset: Dataset } {
    const ds = this.data.get();
    if (this.cacheFor !== ds) {
      this.cache.clear();
      this.cacheFor = ds;
    }
    const key = `${settings.lookbackDays}|${settings.minimumTenureDays}`;
    const hit = this.cache.get(key);
    if (hit) return { ...hit, dataset: ds };

    const started = Date.now();
    const ctx = { asOf: ds.asOf, windowStart: ds.windowStart, gapDays: ds.gapDays };
    const window = buildWindow(ctx, settings.lookbackDays);
    const health: AccountHealth[] = [];
    const issues: DataQualityIssue[] = [];
    // One account that trips a scoring bug shouldn't blank the dashboard for everyone else.
    for (const record of ds.records) {
      try {
        health.push(scoreAccount(record, ctx, settings, SCORING, window));
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
    const excluded = health.filter((a) => !a.eligible).length;
    this.logger.log(
      `Scored ${health.length}/${ds.records.length} accounts for ${settings.lookbackDays}-day window, ` +
        `min tenure ${settings.minimumTenureDays}d (${excluded} not scored) in ${Date.now() - started}ms` +
        (issues.length ? ` (${issues.length} failed)` : ''),
    );

    if (this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
    const entry = { window, health, issues };
    this.cache.set(key, entry);
    return { ...entry, dataset: ds };
  }

  list(query: AccountQuery = {}, settings: ScoringSettings = DEFAULT_SETTINGS): AccountHealth[] {
    const q = query.q?.trim().toLowerCase();
    const rows = this.scored(settings).health.filter(
      (a) =>
        (!query.status || a.status === query.status) &&
        (!query.plan || a.planTier === query.plan) &&
        (!query.csm || a.csmOwner === query.csm) &&
        (!q || a.companyName.toLowerCase().includes(q) || a.domain.toLowerCase().includes(q)),
    );

    const sort = query.sort ?? 'priority';
    const defaultOrder = sort === 'score' || sort === 'name' ? 'asc' : 'desc';
    const dir = (query.order ?? defaultOrder) === 'asc' ? 1 : -1;
    const lastMs = (a: AccountHealth) => (a.stats.lastActivity ? Date.parse(a.stats.lastActivity) : 0);
    const cmp: Record<SortKey, (a: AccountHealth, b: AccountHealth) => number> = {
      // "desc" (default) = most urgent first: status group, then highest priority.
      priority: (a, b) =>
        STATUS_ORDER[b.status] - STATUS_ORDER[a.status] ||
        (a.priority ?? -1) - (b.priority ?? -1) ||
        (b.score ?? 0) - (a.score ?? 0),
      score: (a, b) => (a.score ?? 0) - (b.score ?? 0) || b.arrUsd - a.arrUsd,
      arr: (a, b) => a.arrUsd - b.arrUsd,
      name: (a, b) => a.companyName.localeCompare(b.companyName),
      lastActivity: (a, b) => lastMs(a) - lastMs(b),
    };
    return [...rows].sort((a, b) => {
      // Unscored accounts have no score to sort by: keep them last whatever the direction.
      if (sort === 'score' && a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      return dir * cmp[sort](a, b);
    });
  }

  summary(settings: ScoringSettings = DEFAULT_SETTINGS): PortfolioSummary {
    const { dataset: ds, health, window } = this.scored(settings);
    const statuses = Object.fromEntries(
      ACCOUNT_STATUSES.map((s) => {
        const rows = health.filter((a) => a.status === s);
        return [s, { count: rows.length, arr: rows.reduce((sum, a) => sum + a.arrUsd, 0) }];
      }),
    ) as PortfolioSummary['statuses'];
    return {
      asOf: ds.asOf.toISOString(),
      windowStart: ds.windowStart.toISOString(),
      settings,
      window,
      totalAccounts: health.length,
      totalArr: health.reduce((s, a) => s + a.arrUsd, 0),
      statuses,
      csms: [...new Set(health.map((a) => a.csmOwner))].sort(),
      dataIssueCount: this.allIssues(settings).filter((i) => i.severity !== 'info').length,
    };
  }

  /** Data-load issues plus any accounts that failed to score. */
  private allIssues(settings: ScoringSettings): DataQualityIssue[] {
    const { dataset, issues } = this.scored(settings);
    return [...dataset.issues, ...issues];
  }

  dataQuality() {
    const ds = this.data.get();
    return {
      asOf: ds.asOf.toISOString(),
      windowStart: ds.windowStart.toISOString(),
      gapDays: ds.gapDays,
      issues: this.allIssues(DEFAULT_SETTINGS),
    };
  }

  methodology() {
    return SCORING;
  }

  detail(slug: string, settings: ScoringSettings = DEFAULT_SETTINGS): AccountDetail | null {
    const { dataset: ds, health: all, window } = this.scored(settings);
    const record = ds.records.find((r) => r.slug === slug);
    const health = all.find((a) => a.slug === slug);
    if (!record || !health) return null;
    const { events } = record;
    const inWindow = (e: UsageEvent) => {
      const d = isoDay(e.timestamp);
      return d >= window.start && d <= window.end;
    };
    const zeroCounts = () => Object.fromEntries(EVENT_TYPES.map((t) => [t, 0])) as Record<EventType, number>;

    // Monday-start weeks covering the whole export, including empty ones, so gaps are visible.
    const weeks = new Map<string, WeeklyActivity>();
    for (let t = Date.parse(weekStart(ds.windowStart)); t <= ds.asOf.getTime(); t += 7 * 86_400_000) {
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
        eventsInWindow: evs.filter(inWindow).length,
        users: new Set(evs.map((e) => e.userId)).size,
        lastSeen: evs[evs.length - 1].timestamp.toISOString(),
      }))
      .sort((a, b) => b.events - a.events);

    const users = [...groupBy(events, (e) => e.userId)]
      .map(([userId, evs]) => {
        const counts = zeroCounts();
        for (const e of evs) counts[e.eventType]++;
        return {
          userId,
          events: evs.length,
          lastSeen: evs[evs.length - 1].timestamp.toISOString(),
          activeInWindow: evs.some(inWindow),
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
