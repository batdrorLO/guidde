import { DAY_MS, isoDay } from '../common/dates';
import type {
  AccountHealth,
  AccountRecord,
  EventType,
  HealthFlag,
  HealthTier,
  PillarScore,
  PlanTier,
  UsageEvent,
} from '../common/types';
import { PLAN_RANK, SCORING, type ScoringConfig } from './scoring.config';

export const PRODUCE_EVENTS: ReadonlySet<EventType> = new Set(['guide_created', 'guide_shared']);
export const CONSUME_EVENTS: ReadonlySet<EventType> = new Set(['guide_viewed']);

export interface ScoreContext {
  asOf: Date;
  windowStart: Date;
  gapDays: string[];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round1 = (x: number) => Math.round(x * 10) / 10;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Linear ramp: x at `full` → 1, x at `zero` → 0, clamped. */
export function ramp(x: number, full: number, zero: number): number {
  if (full === zero) return x >= full ? 1 : 0;
  return clamp01((x - zero) / (full - zero));
}

/** Days in (from, to] that aren't known ingestion gaps; never less than 1. */
export function observedDays(from: Date, to: Date, gapDays: string[]): number {
  const total = (to.getTime() - from.getTime()) / DAY_MS;
  const gaps = gapDays.filter((d) => {
    const t = Date.parse(d + 'T00:00:00Z');
    return t >= from.getTime() && t < to.getTime();
  }).length;
  return Math.max(1, total - gaps);
}

export function tierFor(score: number, cfg: ScoringConfig = SCORING): HealthTier {
  if (score >= cfg.tiers.healthy) return 'healthy';
  if (score >= cfg.tiers.watch) return 'watch';
  return 'at_risk';
}

/** Triage order: (100 − score) weighted by contract size on a log scale, so ARR matters but doesn't drown health. */
export function priorityFor(score: number, arrUsd: number): number {
  return Math.round((100 - score) * Math.log10(arrUsd + 10));
}

/**
 * Has the account moved to a lower plan than its contract? Looks at the latest
 * event's tier; returns when it moved there.
 */
export function detectDowngrade(
  events: UsageEvent[],
  contractTier: PlanTier,
): { from: PlanTier; to: PlanTier; since: string } | null {
  if (events.length === 0) return null;
  const latest = events[events.length - 1].planTier;
  if (PLAN_RANK[latest] >= PLAN_RANK[contractTier]) return null;
  let i = events.length - 1;
  while (i > 0 && events[i - 1].planTier === latest) i--;
  const from = i > 0 ? events[i - 1].planTier : contractTier;
  return { from, to: latest, since: isoDay(events[i].timestamp) };
}

export function scoreAccount(
  record: AccountRecord,
  ctx: ScoreContext,
  cfg: ScoringConfig = SCORING,
): AccountHealth {
  const { account, events } = record;
  const plan = account.planTier;
  const asOfMs = ctx.asOf.getTime();
  const recentStart = new Date(asOfMs - cfg.recentDays * DAY_MS);

  const recent = events.filter((e) => e.timestamp > recentStart);
  const prior = events.filter((e) => e.timestamp <= recentStart && e.timestamp >= ctx.windowStart);
  const activeDays = new Set(recent.map((e) => isoDay(e.timestamp))).size;
  const recentUsers = new Set(recent.map((e) => e.userId));
  const allUsers = new Set(events.map((e) => e.userId));
  const last = events.length ? events[events.length - 1].timestamp : null;
  const daysSince = last ? Math.floor((asOfMs - last.getTime()) / DAY_MS) : null;

  const pillars: PillarScore[] = [];
  const add = (p: Omit<PillarScore, 'points'>) => pillars.push({ ...p, points: round1(p.ratio * p.weight) });

  // 1. Activity: do they show up consistently, not just in one burst?
  {
    const target = cfg.targets.activeDays[plan];
    add({
      key: 'activity',
      label: 'Activity',
      weight: cfg.weights.activity,
      ratio: clamp01(activeDays / target),
      measured: plural(activeDays, 'active day'),
      explanation: `Active on ${plural(activeDays, 'day')} in the last ${cfg.recentDays} days vs. a ${plan} target of ${target}. Counts distinct days, so one busy afternoon can't hide three silent weeks.`,
    });
  }

  // 2. Value loop: are guides being made/shared AND watched?
  {
    const produced = recent.filter((e) => PRODUCE_EVENTS.has(e.eventType)).length;
    const consumed = recent.filter((e) => CONSUME_EVENTS.has(e.eventType)).length;
    const pTarget = cfg.targets.produced[plan];
    const cTarget = cfg.targets.consumed[plan];
    const ratio = 0.5 * clamp01(produced / pTarget) + 0.5 * clamp01(consumed / cTarget);
    add({
      key: 'valueLoop',
      label: 'Value loop',
      weight: cfg.weights.valueLoop,
      ratio,
      measured: `${produced} made/shared · ${consumed} viewed`,
      explanation: `In the last ${cfg.recentDays} days: ${plural(produced, 'guide')} created or shared (target ${pTarget}) and ${plural(consumed, 'view')} (target ${cTarget}). Both halves matter: content nobody watches, or no new content, both mean the loop is breaking. Logins and invites don't count here.`,
    });
  }

  // 3. Retention: are the people who adopted still around?
  {
    const { fullCreditShare, minUserBase } = cfg.retention;
    const base = Math.max(allUsers.size, minUserBase);
    const share = recentUsers.size / base;
    add({
      key: 'retention',
      label: 'User retention',
      weight: cfg.weights.retention,
      ratio: clamp01(share / fullCreditShare),
      measured: `${recentUsers.size} of ${allUsers.size} users`,
      explanation: `${recentUsers.size} of the ${plural(allUsers.size, 'user')} seen in the export were active in the last ${cfg.recentDays} days (${Math.round(share * 100)}%). ${Math.round(fullCreditShare * 100)}% or more earns full credit.`,
    });
  }

  // 4. Momentum: is usage growing or fading vs. the account's own baseline?
  {
    const { smoothing, fullCreditRatio, zeroCreditRatio } = cfg.momentum;
    const recentDays = observedDays(recentStart, ctx.asOf, ctx.gapDays);
    const priorDays = observedDays(ctx.windowStart, recentStart, ctx.gapDays);
    const r = (recent.length + smoothing) / recentDays / ((prior.length + smoothing) / priorDays);
    const pct = Math.round((r - 1) * 100);
    add({
      key: 'momentum',
      label: 'Momentum',
      weight: cfg.weights.momentum,
      // Smoothing would read 0-vs-0 as growth; no recent activity is never momentum.
      ratio: recent.length === 0 ? 0 : ramp(r, fullCreditRatio, zeroCreditRatio),
      measured: `${pct >= 0 ? '+' : ''}${pct}%`,
      explanation: `Events per day are ${pct >= 0 ? 'up' : 'down'} ${Math.abs(pct)}% vs. the prior ${Math.round(priorDays)} days (${recent.length} recent vs. ${prior.length} earlier events, per observed day). Flat or growing earns full credit; a drop of 60% or more earns none.`,
    });
  }

  // Overrides and context flags
  const flags: HealthFlag[] = [];
  const downgrade = detectDowngrade(events, plan);
  if (downgrade) {
    flags.push({
      code: 'downgrade',
      severity: 'error',
      title: 'Plan downgrade',
      detail: `Events moved from ${downgrade.from} to ${downgrade.to} on ${downgrade.since}, but the contract says ${plan}. Either ARR is about to shrink or the CRM is stale. Confirm with the customer.`,
      penalty: cfg.overrides.downgradePenalty,
    });
  }

  const dormant = daysSince === null || daysSince > cfg.overrides.dormantDays;
  if (dormant) {
    flags.push({
      code: 'dormant',
      severity: 'error',
      title: 'Dormant',
      detail:
        daysSince === null
          ? 'No activity anywhere in the export window.'
          : `Nobody has done anything for ${daysSince} days (threshold: ${cfg.overrides.dormantDays}).`,
      penalty: 0,
    });
  }

  const contractAge = Math.floor((asOfMs - Date.parse(account.contractStartDate + 'T00:00:00Z')) / DAY_MS);
  if (contractAge >= 0 && contractAge < cfg.context.onboardingDays) {
    flags.push({
      code: 'onboarding',
      severity: 'info',
      title: 'Onboarding',
      detail: `Contract started ${account.contractStartDate} (${contractAge} days ago). Usage may still be ramping up.`,
      penalty: 0,
    });
  }

  if (events.length < cfg.context.lowSignalEvents) {
    flags.push({
      code: 'low_signal',
      severity: 'info',
      title: 'Low signal',
      detail: `Only ${plural(events.length, 'event')} in the 90-day export, so treat the score as directional.`,
      penalty: 0,
    });
  }

  const workspaces = new Set(events.map((e) => e.workspaceId)).size;
  if (workspaces > 1) {
    flags.push({
      code: 'multi_workspace',
      severity: 'info',
      title: `${workspaces} workspaces`,
      detail: 'Activity is rolled up across all of this account’s workspaces.',
      penalty: 0,
    });
  }

  const baseScore = Math.round(pillars.reduce((s, p) => s + p.points, 0));
  const penalty = flags.reduce((s, f) => s + f.penalty, 0);
  const score = Math.max(0, Math.min(100, baseScore - penalty));

  let tier = tierFor(score, cfg);
  let tierReason: string | null = null;
  if (dormant && tier !== 'at_risk') {
    tier = 'at_risk';
    tierReason = `Forced to At Risk: no activity for more than ${cfg.overrides.dormantDays} days.`;
  } else if (downgrade && tier === 'healthy') {
    tier = cfg.overrides.downgradeMaxTier;
    tierReason = 'Capped at Watch: a downgraded account is never Healthy.';
  }

  return {
    slug: record.slug,
    companyName: account.companyName,
    domain: account.domain,
    planTier: plan,
    observedPlanTier: events.length ? events[events.length - 1].planTier : null,
    arrUsd: account.arrUsd,
    csmOwner: account.csmOwner,
    contractStartDate: account.contractStartDate,
    score,
    baseScore,
    tier,
    tierReason,
    priority: priorityFor(score, account.arrUsd),
    pillars,
    flags,
    summary: summarize(pillars, flags),
    stats: {
      totalEvents: events.length,
      events30d: recent.length,
      activeDays30d: activeDays,
      activeUsers30d: recentUsers.size,
      totalUsers: allUsers.size,
      workspaces,
      lastActivity: last ? last.toISOString() : null,
      daysSinceLastActivity: daysSince,
    },
  };
}

/** One line a CSM can scan in the table: the biggest problems first. */
function summarize(pillars: PillarScore[], flags: HealthFlag[]): string {
  const parts: string[] = flags.filter((f) => f.severity === 'error').map((f) => f.title);
  const weak = pillars
    .filter((p) => p.ratio < 0.5)
    .sort((a, b) => a.points - a.weight - (b.points - b.weight));
  for (const p of weak) {
    if (p.key === 'activity' && parts.includes('Dormant')) continue;
    parts.push(`Weak ${p.label.toLowerCase()} (${p.measured})`);
  }
  if (parts.length) return parts.slice(0, 3).join(' · ');
  const softest = [...pillars].sort((a, b) => a.ratio - b.ratio)[0];
  return softest.ratio < 0.8
    ? `Solid overall · softer ${softest.label.toLowerCase()} (${softest.measured})`
    : 'Consistent, broad, steady usage.';
}
