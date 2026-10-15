import { DAY_MS, isoDay } from '../common/dates';
import type {
  AccountExclusion,
  AccountHealth,
  AccountRecord,
  ActivityMetrics,
  AnalysisWindow,
  EventType,
  HealthFlag,
  HealthTier,
  PillarScore,
  PlanTier,
  StatusOverride,
  UsageEvent,
} from '../common/types';
import { DEFAULT_SETTINGS, PLAN_RANK, SCORING, type ScoringConfig, type ScoringSettings } from './scoring.config';

/**
 * THE scoring implementation. Pure functions, explicit inputs, no I/O: the API calls
 * these and the UI only displays the result, so there is exactly one place a score
 * can come from.
 */

export const PRODUCE_EVENTS: ReadonlySet<EventType> = new Set(['guide_created', 'guide_shared']);
export const CONSUME_EVENTS: ReadonlySet<EventType> = new Set(['guide_viewed']);

export interface ScoreContext {
  /** Reference date: the latest event in the export (never the wall clock). */
  asOf: Date;
  /** Midnight UTC of the first day the export covers. Days before it can't be evaluated. */
  windowStart: Date;
  /** Days with zero events from any account: ingestion gaps, not customer inactivity. */
  gapDays: string[];
}

const TIER_LABEL: Record<HealthTier, string> = { healthy: 'Healthy', watch: 'Watch', at_risk: 'At Risk' };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round1 = (x: number) => Math.round(x * 10) / 10;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const num = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const shortDay = (day: string) =>
  new Date(day + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function addDays(day: string, n: number): string {
  return isoDay(new Date(Date.parse(day + 'T00:00:00Z') + n * DAY_MS));
}

/** Linear ramp: x at `full` → 1, x at `zero` → 0, clamped. */
export function ramp(x: number, full: number, zero: number): number {
  if (full === zero) return x >= full ? 1 : 0;
  return clamp01((x - zero) / (full - zero));
}

/**
 * Days in [start, end] (inclusive, YYYY-MM-DD) that can be evaluated: inside the export's
 * coverage and not a known ingestion gap. A day nobody could have been seen on is never
 * counted as an inactive day.
 */
export function countObservableDays(start: string, end: string, ctx: ScoreContext): number {
  const coverageStart = isoDay(ctx.windowStart);
  const coverageEnd = isoDay(ctx.asOf);
  const gaps = new Set(ctx.gapDays);
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (d >= coverageStart && d <= coverageEnd && !gaps.has(d)) n++;
  }
  return n;
}

/**
 * Current window: `lookbackDays` calendar days ending on (and including) the reference day.
 * Baseline: the `baselineMultiplier × lookbackDays` calendar days immediately before it.
 * The two never overlap.
 */
export function buildWindow(ctx: ScoreContext, lookbackDays: number, cfg: ScoringConfig = SCORING): AnalysisWindow {
  const end = isoDay(ctx.asOf);
  const start = addDays(end, -(lookbackDays - 1));
  const observableDays = countObservableDays(start, end, ctx);

  const baselineEnd = addDays(start, -1);
  const calendarDays = lookbackDays * cfg.momentum.baselineMultiplier;
  const baselineStart = addDays(baselineEnd, -(calendarDays - 1));
  const baselineObservable = countObservableDays(baselineStart, baselineEnd, ctx);

  return {
    referenceDate: ctx.asOf.toISOString(),
    lookbackDays,
    start,
    end,
    observableDays,
    unobservableDays: lookbackDays - observableDays,
    baseline: {
      start: baselineStart,
      end: baselineEnd,
      calendarDays,
      observableDays: baselineObservable,
      sufficient: baselineObservable > 0 && baselineObservable >= calendarDays * cfg.momentum.minBaselineCoverage,
    },
  };
}

/** Whole days from contract start to the reference day; null if the date isn't a real calendar date. */
export function tenureDays(contractStartDate: string, asOf: Date): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(contractStartDate)) return null;
  const startMs = Date.parse(contractStartDate + 'T00:00:00Z');
  // Reject dates that don't round-trip (e.g. 2025-02-30).
  if (Number.isNaN(startMs) || isoDay(new Date(startMs)) !== contractStartDate) return null;
  return Math.round((Date.parse(isoDay(asOf) + 'T00:00:00Z') - startMs) / DAY_MS);
}

export function tierFor(score: number, cfg: ScoringConfig = SCORING): HealthTier {
  if (score >= cfg.tiers.healthy) return 'healthy';
  if (score >= cfg.tiers.watch) return 'watch';
  return 'at_risk';
}

/** Triage order: (100 − score) weighted by contract size on a log scale, so ARR matters but doesn't drown health. */
export function priorityFor(score: number, arrUsd: number): number {
  return Math.round((100 - score) * Math.log10(Math.max(0, arrUsd) + 10));
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

/**
 * Score one account. Rule precedence:
 *  1. Resolve plan, reference date, tenure and data sufficiency.
 *  2. Too new / tenure unknown / nothing observable → excluded: no score, tier or priority.
 *  3. Compute the four pillars.
 *  4. Apply the downgrade penalty → numeric score → score tier.
 *  5. Hard rules: dormant → At Risk; activity below the plan's threshold → At Risk;
 *     downgrade → can't be Healthy. All that apply are reported.
 */
export function scoreAccount(
  record: AccountRecord,
  ctx: ScoreContext,
  settings: ScoringSettings = DEFAULT_SETTINGS,
  cfg: ScoringConfig = SCORING,
  window: AnalysisWindow = buildWindow(ctx, settings.lookbackDays, cfg),
): AccountHealth {
  const { account, events } = record;
  const plan = account.planTier;
  const expectation = cfg.planExpectations[plan];
  const N = settings.lookbackDays;

  const inRange = (e: UsageEvent, start: string, end: string) => {
    const d = isoDay(e.timestamp);
    return d >= start && d <= end;
  };
  const current = events.filter((e) => inRange(e, window.start, window.end));
  const baseline = events.filter((e) => inRange(e, window.baseline.start, window.baseline.end));
  const activeDays = new Set(current.map((e) => isoDay(e.timestamp))).size;
  const currentUsers = new Set(current.map((e) => e.userId));
  const allUsers = new Set(events.map((e) => e.userId));
  const last = events.length ? events[events.length - 1].timestamp : null;
  const daysSince = last ? Math.floor((ctx.asOf.getTime() - last.getTime()) / DAY_MS) : null;
  const tenure = tenureDays(account.contractStartDate, ctx.asOf);
  const workspaces = new Set(events.map((e) => e.workspaceId)).size;
  const downgrade = detectDowngrade(events, plan);

  const base = {
    slug: record.slug,
    companyName: account.companyName,
    domain: account.domain,
    planTier: plan,
    observedPlanTier: events.length ? events[events.length - 1].planTier : null,
    arrUsd: account.arrUsd,
    csmOwner: account.csmOwner,
    contractStartDate: account.contractStartDate,
    tenureDays: tenure,
    window,
    stats: {
      totalEvents: events.length,
      eventsInWindow: current.length,
      activeDaysInWindow: activeDays,
      activeUsersInWindow: currentUsers.size,
      totalUsers: allUsers.size,
      workspaces,
      lastActivity: last ? last.toISOString() : null,
      daysSinceLastActivity: daysSince,
    },
  };

  // ---- Context flags (never change the score, except the downgrade penalty) ----
  const flags: HealthFlag[] = [];
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
          ? 'No activity anywhere in the export.'
          : `Nobody has done anything for ${daysSince} days (threshold: more than ${cfg.overrides.dormantDays}).`,
      penalty: 0,
    });
  }
  if (tenure !== null && tenure >= 0 && tenure < cfg.context.onboardingDays) {
    flags.push({
      code: 'onboarding',
      severity: 'info',
      title: 'Onboarding',
      detail: `Contract started ${account.contractStartDate} (${tenure} days before the reference date). Usage may still be ramping up.`,
      penalty: 0,
    });
  }
  if (events.length < cfg.context.lowSignalEvents) {
    flags.push({
      code: 'low_signal',
      severity: 'info',
      title: 'Low signal',
      detail: `Only ${plural(events.length, 'event')} in the whole export, so treat the score as directional.`,
      penalty: 0,
    });
  }
  if (workspaces > 1) {
    flags.push({
      code: 'multi_workspace',
      severity: 'info',
      title: `${workspaces} workspaces`,
      detail: 'Activity is rolled up across all of this account’s workspaces.',
      penalty: 0,
    });
  }

  // ---- 1–2. Eligibility: never score what we can't score fairly ----
  const exclusion = exclusionFor(tenure, settings, window, account.contractStartDate, expectation);
  if (exclusion) {
    return {
      ...base,
      eligible: false,
      status: exclusion.reason === 'below_minimum_tenure' ? 'onboarding' : 'insufficient_data',
      score: null,
      baseScore: null,
      scoreTier: null,
      overrides: [],
      statusReason: exclusion.message,
      exclusion,
      priority: null,
      activity: null,
      pillars: [],
      // Status rules don't apply to an account we aren't scoring; keep the factual context.
      flags: flags.filter((f) => f.code !== 'dormant').map((f) => ({ ...f, penalty: 0 })),
      summary: exclusion.message,
    };
  }

  // ---- 3. Pillars ----
  const pillars: PillarScore[] = [];

  // Activity: share of observable days with any activity, against the plan's full-credit rate.
  const rate = activeDays / window.observableDays;
  const activity: ActivityMetrics = {
    activeDays,
    observableDays: window.observableDays,
    rate,
    fullCreditRate: expectation.fullCreditActivityRate,
    atRiskRate: expectation.atRiskActivityRate,
  };
  {
    const ratio = clamp01(rate / expectation.fullCreditActivityRate);
    const unobservable =
      window.unobservableDays > 0
        ? ` ${plural(window.unobservableDays, 'day')} in the window can't be evaluated (before the export starts or missing from it) and ${window.unobservableDays === 1 ? 'is' : 'are'} left out rather than counted as inactive.`
        : '';
    pillars.push({
      key: 'activity',
      label: 'Activity',
      weight: cfg.weights.activity,
      ratio,
      points: round1(cfg.weights.activity * ratio),
      measured: `${activeDays} of ${window.observableDays} days (${pct(rate)})`,
      explanation:
        `Active on ${activeDays} of the ${window.observableDays} observable days from ${shortDay(window.start)} to ${shortDay(window.end)} (${pct(rate)}). ` +
        `${plan} accounts earn full credit at ${pct(expectation.fullCreditActivityRate)} and are At Risk below ${pct(expectation.atRiskActivityRate)}.` +
        unobservable,
    });
  }

  // Value loop: guides made/shared and guides viewed, each against a target scaled to the window.
  {
    const half = cfg.weights.valueLoop / 2;
    const produced = current.filter((e) => PRODUCE_EVENTS.has(e.eventType)).length;
    const consumed = current.filter((e) => CONSUME_EVENTS.has(e.eventType)).length;
    const pTarget = (expectation.producedPer30Days * N) / 30;
    const cTarget = (expectation.consumedPer30Days * N) / 30;
    const pPts = round1(half * Math.min(produced / pTarget, 1));
    const cPts = round1(half * Math.min(consumed / cTarget, 1));
    const points = Math.min(cfg.weights.valueLoop, round1(pPts + cPts));
    pillars.push({
      key: 'valueLoop',
      label: 'Value loop',
      weight: cfg.weights.valueLoop,
      ratio: points / cfg.weights.valueLoop,
      points,
      measured: `${produced} made/shared · ${consumed} viewed`,
      explanation:
        `In the last ${N} days: ${plural(produced, 'guide')} created or shared vs. a target of ${num(pTarget)} (${num(pPts)}/${half} pts), ` +
        `and ${plural(consumed, 'guide view')} vs. a target of ${num(cTarget)} (${num(cPts)}/${half} pts). ` +
        `${plan} targets are ${expectation.producedPer30Days} made/shared and ${expectation.consumedPer30Days} views per 30 days, scaled to the ${N}-day window. Logins and invites don't count.`,
    });
  }

  // Retention: users active in the window ÷ every user seen in the export.
  {
    const { fullCreditRate } = cfg.retention;
    if (allUsers.size === 0) {
      pillars.push({
        key: 'retention',
        label: 'User retention',
        weight: cfg.weights.retention,
        ratio: 0,
        points: 0,
        measured: 'no users',
        explanation: 'No users appear in the export for this account, so retention can’t be measured. No points are awarded rather than assuming full retention.',
      });
    } else {
      const share = currentUsers.size / allUsers.size;
      const ratio = clamp01(share / fullCreditRate);
      pillars.push({
        key: 'retention',
        label: 'User retention',
        weight: cfg.weights.retention,
        ratio,
        points: round1(cfg.weights.retention * ratio),
        measured: `${currentUsers.size} of ${allUsers.size} users (${pct(share)})`,
        explanation: `${currentUsers.size} of the ${plural(allUsers.size, 'user')} seen anywhere in the export were active in the last ${N} days (${pct(share)}). ${pct(fullCreditRate)} or more earns full credit.`,
      });
    }
  }

  // Momentum: per-observable-day rate now vs. the 2N days before, smoothed.
  {
    const { smoothing, fullCreditRatio, zeroCreditRatio, insufficientBaselineCredit } = cfg.momentum;
    const b = window.baseline;
    let ratio: number;
    let measured: string;
    let explanation: string;
    if (current.length === 0) {
      ratio = 0;
      measured = 'no recent activity';
      explanation = `No activity in the last ${N} days, so there is no momentum to credit.`;
    } else if (!b.sufficient) {
      ratio = insufficientBaselineCredit;
      measured = 'not enough history';
      explanation =
        `Momentum compares the last ${N} days with the ${b.calendarDays} days before them (${shortDay(b.start)} – ${shortDay(b.end)}), ` +
        `but the export only covers ${plural(b.observableDays, 'day')} of that period. Instead of inventing growth or decline, momentum is scored as neutral ` +
        `(${num(cfg.weights.momentum * ratio)}/${cfg.weights.momentum}). Pick a shorter period for a full comparison.`;
    } else {
      const curRate = current.length / window.observableDays;
      const baseRate = baseline.length / b.observableDays;
      const r = (current.length + smoothing) / window.observableDays / ((baseline.length + smoothing) / b.observableDays);
      const change = Math.round((r - 1) * 100);
      ratio = ramp(r, fullCreditRatio, zeroCreditRatio);
      measured = `${change >= 0 ? '+' : ''}${change}%`;
      explanation =
        `${plural(current.length, 'event')} over ${window.observableDays} observable days (${curRate.toFixed(2)}/day) vs. ` +
        `${plural(baseline.length, 'event')} over the ${b.observableDays} observable days before (${shortDay(b.start)} – ${shortDay(b.end)}, ${baseRate.toFixed(2)}/day): ` +
        `${change >= 0 ? 'up' : 'down'} ${Math.abs(change)}% after light smoothing. Flat or growing earns full credit; a drop of ${Math.round((1 - zeroCreditRatio) * 100)}% or more earns none.`;
    }
    pillars.push({
      key: 'momentum',
      label: 'Momentum',
      weight: cfg.weights.momentum,
      ratio,
      points: round1(cfg.weights.momentum * ratio),
      measured,
      explanation,
    });
  }

  // ---- 4. Numeric score and its tier ----
  const baseScore = Math.round(pillars.reduce((s, p) => s + p.points, 0));
  const penalty = flags.reduce((s, f) => s + f.penalty, 0);
  const score = Math.max(0, Math.min(100, baseScore - penalty));
  const scoreTier = tierFor(score, cfg);

  // ---- 5. Hard rules: collect every one that applies ----
  const overrides: StatusOverride[] = [];
  if (dormant) {
    overrides.push({
      code: 'dormant',
      status: 'at_risk',
      reason:
        daysSince === null
          ? 'Dormant: no activity anywhere in the export.'
          : `Dormant: no activity for ${daysSince} days (more than ${cfg.overrides.dormantDays}).`,
    });
  }
  if (rate < expectation.atRiskActivityRate) {
    overrides.push({
      code: 'activity_below_plan_threshold',
      status: 'at_risk',
      reason: `Activity ${pct(rate)} is below the ${plan} At Risk threshold of ${pct(expectation.atRiskActivityRate)}.`,
    });
  }
  if (downgrade) {
    overrides.push({
      code: 'downgrade_cap',
      status: cfg.overrides.downgradeMaxTier,
      reason: `Plan downgrade (${downgrade.from} → ${downgrade.to}): a downgraded account can’t be Healthy.`,
    });
  }

  let status: HealthTier = scoreTier;
  if (overrides.some((o) => o.status === 'at_risk')) status = 'at_risk';
  else if (downgrade && status === 'healthy') status = cfg.overrides.downgradeMaxTier;

  const reasons = overrides.map((o) => o.reason).join(' ');
  const statusReason =
    status !== scoreTier
      ? `The score alone gives ${TIER_LABEL[scoreTier]}, but the status is ${TIER_LABEL[status]}. ${reasons}`
      : overrides.length
        ? reasons
        : null;

  return {
    ...base,
    eligible: true,
    status,
    score,
    baseScore,
    scoreTier,
    overrides,
    statusReason,
    exclusion: null,
    priority: priorityFor(score, account.arrUsd),
    activity,
    pillars,
    flags,
    summary: summarize(pillars, overrides),
  };
}

function exclusionFor(
  tenure: number | null,
  settings: ScoringSettings,
  window: AnalysisWindow,
  contractStartDate: string,
  expectation: unknown,
): AccountExclusion | null {
  if (!expectation) {
    return { reason: 'unknown_plan', message: 'Not enough data: the account’s plan isn’t recognised, so there are no expectations to score it against.' };
  }
  if (tenure === null) {
    return {
      reason: 'tenure_unknown',
      message: `Not enough data: the contract start date ("${contractStartDate}") isn’t a valid date, so tenure can’t be established. Fix the account record to score it.`,
    };
  }
  if (tenure < settings.minimumTenureDays) {
    return {
      reason: 'below_minimum_tenure',
      message:
        tenure < 0
          ? `Not scored yet: the contract starts on ${contractStartDate}, after the data’s reference date.`
          : `Not scored yet: customer for ${plural(tenure, 'day')}; scoring starts at ${settings.minimumTenureDays} days of tenure.`,
    };
  }
  if (window.observableDays === 0) {
    return { reason: 'no_observable_days', message: 'Not enough data: no day in the selected period is covered by the export.' };
  }
  return null;
}

/** One line a CSM can scan in the table: status rules first, then the weakest pillars. */
function summarize(pillars: PillarScore[], overrides: StatusOverride[]): string {
  const parts: string[] = overrides.map((o) =>
    o.code === 'dormant' ? 'Dormant' : o.code === 'activity_below_plan_threshold' ? 'Activity below plan threshold' : 'Plan downgrade',
  );
  const weak = pillars
    .filter((p) => p.ratio < 0.5)
    .sort((a, b) => a.points - a.weight - (b.points - b.weight));
  for (const p of weak) {
    // Already said by "Dormant" / "Activity below plan threshold".
    if (p.key === 'activity' && overrides.some((o) => o.code !== 'downgrade_cap')) continue;
    parts.push(`Weak ${p.label.toLowerCase()} (${p.measured})`);
  }
  if (parts.length) return parts.slice(0, 3).join(' · ');
  const softest = [...pillars].sort((a, b) => a.ratio - b.ratio)[0];
  return softest.ratio < 0.8
    ? `Solid overall · softer ${softest.label.toLowerCase()} (${softest.measured})`
    : 'Consistent, broad, steady usage.';
}
