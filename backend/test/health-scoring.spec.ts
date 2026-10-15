import { DAY_MS, isoDay } from '../src/common/dates';
import type { Account, AccountRecord, Dataset, EventType, PlanTier, UsageEvent } from '../src/common/types';
import type { DatasetService } from '../src/data/dataset.service';
import {
  addDays,
  buildWindow,
  countObservableDays,
  detectDowngrade,
  priorityFor,
  ramp,
  scoreAccount,
  tenureDays,
  tierFor,
  type ScoreContext,
} from '../src/health/health-scoring';
import { HealthService } from '../src/health/health.service';
import { DEFAULT_SETTINGS, SCORING, parseScoringSettings, type ScoringSettings } from '../src/health/scoring.config';

// Reference date = latest event in the (synthetic) export. Events are placed at noon UTC.
const AS_OF = new Date('2026-09-13T12:00:00Z');
const REF_DAY = '2026-09-13';
/** 120 days of coverage, no gaps: enough for a full 30-day window + 60-day baseline. */
const ctx: ScoreContext = { asOf: AS_OF, windowStart: new Date('2026-05-17T00:00:00Z'), gapDays: [] };

const settings = (lookbackDays = 30, minimumTenureDays = 30): ScoringSettings => ({ lookbackDays, minimumTenureDays });

let seq = 0;
function ev(daysAgo: number, type: EventType, user = 'u1', plan: PlanTier = 'Pro', ws = 'ws1'): UsageEvent {
  return {
    eventId: `e${seq++}`,
    workspaceId: ws,
    companyName: 'Acme',
    eventType: type,
    userId: user,
    timestamp: new Date(AS_OF.getTime() - daysAgo * DAY_MS),
    planTier: plan,
  };
}

function record(events: UsageEvent[], overrides: Partial<Account> = {}): AccountRecord {
  return {
    slug: overrides.companyName?.toLowerCase().replace(/\W+/g, '-') ?? 'acme',
    account: {
      companyName: 'Acme',
      domain: 'acme.com',
      planTier: 'Pro',
      contractStartDate: '2024-01-01',
      arrUsd: 20000,
      csmOwner: 'Dana',
      ...overrides,
    },
    events: [...events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()),
  };
}

/**
 * Active on exactly 10 of the last 30 days (33.3%), creating and viewing guides with
 * 3 users, and at the same daily rate through the 60-day baseline — so every pillar
 * except Activity is at full credit.
 */
function tenOfThirty(plan: PlanTier): UsageEvent[] {
  const out: UsageEvent[] = [];
  for (let d = 0; d < 10; d++) out.push(ev(d, 'guide_created', `u${d % 3}`, plan), ev(d, 'guide_viewed', `u${(d + 1) % 3}`, plan));
  for (let d = 30; d < 90; d += 3) out.push(ev(d, 'guide_created', `u${d % 3}`, plan), ev(d, 'guide_viewed', `u${(d + 1) % 3}`, plan));
  return out;
}

/** A Pro account doing everything right: active most days, broad, creating and viewing. */
function healthyEvents(plan: PlanTier = 'Pro'): UsageEvent[] {
  const out: UsageEvent[] = [];
  for (let d = 0; d < 90; d += 2) {
    out.push(ev(d, 'guide_created', `u${d % 3}`, plan), ev(d, 'guide_viewed', `u${(d + 1) % 3}`, plan));
  }
  return out;
}

const pillar = (h: ReturnType<typeof scoreAccount>, key: string) => h.pillars.find((p) => p.key === key)!;

describe('helpers', () => {
  it('ramp works in both directions and clamps', () => {
    expect(ramp(1.0, 1.0, 0.4)).toBe(1);
    expect(ramp(0.7, 1.0, 0.4)).toBeCloseTo(0.5);
    expect(ramp(5, 1.0, 0.4)).toBe(1);
    expect(ramp(0.2, 1.0, 0.4)).toBe(0);
  });

  it('tiers follow the configured thresholds', () => {
    expect(tierFor(70)).toBe('healthy');
    expect(tierFor(69)).toBe('watch');
    expect(tierFor(45)).toBe('watch');
    expect(tierFor(44)).toBe('at_risk');
  });

  it('priority ranks a big unhealthy contract above a small one', () => {
    expect(priorityFor(20, 200_000)).toBeGreaterThan(priorityFor(20, 0));
    expect(priorityFor(100, 200_000)).toBe(0);
  });

  it('tenure is whole days from contract start to the reference day; invalid dates are null', () => {
    expect(tenureDays('2026-08-14', AS_OF)).toBe(30);
    expect(tenureDays('2026-09-20', AS_OF)).toBe(-7);
    expect(tenureDays('2026-02-30', AS_OF)).toBeNull();
    expect(tenureDays('not a date', AS_OF)).toBeNull();
  });
});

describe('settings', () => {
  it('defaults to a 30-day lookback and 30-day minimum tenure', () => {
    expect(DEFAULT_SETTINGS).toEqual({ lookbackDays: 30, minimumTenureDays: 30 });
    expect(parseScoringSettings({})).toEqual({ ok: true, settings: DEFAULT_SETTINGS });
    expect(scoreAccount(record(healthyEvents()), ctx).window.lookbackDays).toBe(30);
  });

  it('accepts custom whole numbers in range and rejects everything else', () => {
    expect(parseScoringSettings({ days: '45', minTenure: '0' })).toEqual({ ok: true, settings: settings(45, 0) });
    expect(parseScoringSettings({ days: 7 })).toMatchObject({ ok: true });
    expect(parseScoringSettings({ days: 180 })).toMatchObject({ ok: true });
    for (const days of ['6', '181', '30.5', 'abc', '-7', '1e2', ' ']) {
      expect(parseScoringSettings({ days })).toMatchObject({ ok: false, field: 'days' });
    }
    for (const minTenure of ['-1', 'x', '731']) {
      expect(parseScoringSettings({ minTenure })).toMatchObject({ ok: false, field: 'minTenure' });
    }
  });

  it('applies a custom lookback to the window and to value-loop targets', () => {
    const h = scoreAccount(record(healthyEvents()), ctx, settings(45));
    expect(h.window).toMatchObject({ lookbackDays: 45, start: addDays(REF_DAY, -44), end: REF_DAY });
    expect(pillar(h, 'valueLoop').explanation).toContain('target of 4.5'); // 3 per 30 days × 45/30
  });
});

describe('analysis window', () => {
  it.each(SCORING.lookback.presets)('a %i-day window ends on the reference day and its baseline never overlaps', (n) => {
    const w = buildWindow(ctx, n);
    expect(w.end).toBe(REF_DAY);
    expect(w.start).toBe(addDays(REF_DAY, -(n - 1)));
    expect(w.baseline.end).toBe(addDays(w.start, -1));
    expect(w.baseline.calendarDays).toBe(2 * n);
    expect(w.baseline.start).toBe(addDays(w.baseline.end, -(2 * n - 1)));
    expect(w.baseline.end < w.start).toBe(true);
  });

  it('includes both boundary days of the window', () => {
    const w = buildWindow(ctx, 7);
    const onStart = ev(6, 'login'); // 2026-09-07
    const beforeStart = ev(7, 'login'); // 2026-09-06
    const h = scoreAccount(record([onStart, beforeStart, ev(0, 'login')]), ctx, settings(7));
    expect(isoDay(onStart.timestamp)).toBe(w.start);
    expect(h.stats.eventsInWindow).toBe(2);
  });

  it('uses the last event in the export as "now", never the wall clock', () => {
    jest.useFakeTimers().setSystemTime(new Date('2031-01-01T00:00:00Z'));
    try {
      const h = scoreAccount(record(healthyEvents()), ctx);
      expect(h.window.referenceDate).toBe(AS_OF.toISOString());
      expect(h.window.end).toBe(REF_DAY);
      expect(h.status).not.toBe('at_risk'); // would be dormant if "now" were 2031
    } finally {
      jest.useRealTimers();
    }
  });

  it('changes the windows and the score for every preset', () => {
    // Very active for the last 7 days, sporadic before.
    const evs = [
      ...Array.from({ length: 7 }, (_, d) => ev(d, 'guide_viewed', `u${d % 2}`)),
      ...Array.from({ length: 12 }, (_, i) => ev(8 + i * 7, 'guide_created', 'u1')),
    ];
    const results = SCORING.lookback.presets.map((n) => scoreAccount(record(evs), ctx, settings(n)));
    expect(new Set(results.map((r) => r.window.start)).size).toBe(SCORING.lookback.presets.length);
    expect(new Set(results.map((r) => r.activity!.rate)).size).toBeGreaterThan(1);
    expect(results[0].activity!.rate).toBe(1); // 7 of 7 days
    expect(results[0].score!).toBeGreaterThan(results[results.length - 1].score!);
  });

  it('does not count uncovered days (gaps, before the export) as inactive', () => {
    const gapCtx = { ...ctx, gapDays: [addDays(REF_DAY, -3)] };
    expect(countObservableDays(addDays(REF_DAY, -6), REF_DAY, gapCtx)).toBe(6);
    const evs = Array.from({ length: 7 }, (_, d) => d).filter((d) => d !== 3).map((d) => ev(d, 'login'));
    const h = scoreAccount(record(evs), gapCtx, settings(7));
    expect(h.activity).toMatchObject({ activeDays: 6, observableDays: 6, rate: 1 });

    // Export starting 10 days ago: a 30-day window only has 10 observable days.
    const shortCtx = { ...ctx, windowStart: new Date(addDays(REF_DAY, -9) + 'T00:00:00Z') };
    const w = buildWindow(shortCtx, 30);
    expect(w.observableDays).toBe(10);
    expect(w.unobservableDays).toBe(20);
  });
});

describe('minimum tenure', () => {
  const daysBefore = (n: number) => addDays(REF_DAY, -n);

  it('excludes an account below the minimum tenure from scoring and ranking', () => {
    const h = scoreAccount(record(healthyEvents(), { contractStartDate: daysBefore(10) }), ctx);
    expect(h).toMatchObject({ eligible: false, status: 'onboarding', score: null, scoreTier: null, priority: null, pillars: [], tenureDays: 10 });
    expect(h.statusReason).toContain('10 days');
    expect(h.statusReason).toContain('30 days');
  });

  it('becomes eligible exactly when it reaches the configured minimum', () => {
    expect(scoreAccount(record(healthyEvents(), { contractStartDate: daysBefore(29) }), ctx).eligible).toBe(false);
    expect(scoreAccount(record(healthyEvents(), { contractStartDate: daysBefore(30) }), ctx).eligible).toBe(true);
    expect(scoreAccount(record(healthyEvents(), { contractStartDate: daysBefore(10) }), ctx, settings(30, 10)).eligible).toBe(true);
  });

  it('does not label a new account At Risk just because it has no history', () => {
    const h = scoreAccount(record([], { contractStartDate: daysBefore(5) }), ctx);
    expect(h.status).toBe('onboarding');
    expect(h.flags.map((f) => f.code)).not.toContain('dormant');
  });

  it('marks an unusable contract start date as insufficient data instead of assuming tenure', () => {
    const h = scoreAccount(record(healthyEvents(), { contractStartDate: '2025-02-30' }), ctx);
    expect(h).toMatchObject({ eligible: false, status: 'insufficient_data', score: null, tenureDays: null });
    expect(h.exclusion?.reason).toBe('tenure_unknown');
  });

  it('treats a contract that starts after the reference date as not yet eligible', () => {
    expect(scoreAccount(record(healthyEvents(), { contractStartDate: addDays(REF_DAY, 5) }), ctx).status).toBe('onboarding');
  });
});

describe('plan-specific activity', () => {
  it('uses the configured full-credit rate and threshold for each plan', () => {
    for (const plan of ['Free', 'Pro', 'Enterprise'] as const) {
      const h = scoreAccount(record(tenOfThirty(plan), { planTier: plan }), ctx);
      expect(h.activity).toMatchObject({
        fullCreditRate: SCORING.planExpectations[plan].fullCreditActivityRate,
        atRiskRate: SCORING.planExpectations[plan].atRiskActivityRate,
      });
    }
    expect(SCORING.planExpectations.Free).toMatchObject({ fullCreditActivityRate: 0.2, atRiskActivityRate: 0.15 });
    expect(SCORING.planExpectations.Pro).toMatchObject({ fullCreditActivityRate: 0.4, atRiskActivityRate: 0.25 });
    expect(SCORING.planExpectations.Enterprise).toMatchObject({ fullCreditActivityRate: 0.6, atRiskActivityRate: 0.4 });
  });

  it('10 active days out of 30 observable days is a 33.3% activity rate', () => {
    const h = scoreAccount(record(tenOfThirty('Free'), { planTier: 'Free' }), ctx);
    expect(h.activity).toMatchObject({ activeDays: 10, observableDays: 30 });
    expect(h.activity!.rate).toBeCloseTo(1 / 3, 5);
    expect(pillar(h, 'activity').measured).toBe('10 of 30 days (33.3%)');
  });

  it('a Free account at 33.3% is not forced to At Risk by the activity rule', () => {
    const h = scoreAccount(record(tenOfThirty('Free'), { planTier: 'Free' }), ctx);
    expect(h.overrides.map((o) => o.code)).not.toContain('activity_below_plan_threshold');
    expect(h.status).toBe('healthy');
    expect(pillar(h, 'activity').points).toBe(30); // 33.3% ≥ 20% full-credit rate
  });

  it('an Enterprise account at 33.3% is At Risk (below the 40% threshold)', () => {
    const h = scoreAccount(record(tenOfThirty('Enterprise'), { planTier: 'Enterprise' }), ctx);
    expect(h.overrides.map((o) => o.code)).toContain('activity_below_plan_threshold');
    expect(h.status).toBe('at_risk');
    expect(pillar(h, 'activity').points).toBeCloseTo(16.7, 1); // 30 × (0.333 / 0.6)
  });

  it('a high numeric score does not bypass the Enterprise activity override, and the score is not altered', () => {
    const h = scoreAccount(record(tenOfThirty('Enterprise'), { planTier: 'Enterprise' }), ctx);
    expect(h.score!).toBeGreaterThanOrEqual(70);
    expect(h.scoreTier).toBe('healthy');
    expect(h.status).toBe('at_risk');
    expect(h.score).toBe(h.baseScore); // no penalty applied just to force the status
    expect(h.statusReason).toContain('40%');
  });
});

describe('pillars', () => {
  it('counts created + shared as producing and viewed as consuming; logins and invites never count', () => {
    const evs = [
      ev(1, 'guide_created'),
      ev(2, 'guide_shared'),
      ev(3, 'guide_viewed'),
      ...Array.from({ length: 10 }, (_, i) => ev(i, 'login')),
      ...Array.from({ length: 10 }, (_, i) => ev(i, 'user_invited')),
    ];
    const vl = pillar(scoreAccount(record(evs), ctx), 'valueLoop');
    expect(vl.measured).toBe('2 made/shared · 1 viewed');
    // Pro: 2/3 of 15 + 1/4 of 15
    expect(vl.points).toBeCloseTo(10 + 3.8, 1);

    const loginsOnly = scoreAccount(record(Array.from({ length: 10 }, (_, i) => ev(i, 'login'))), ctx);
    expect(pillar(loginsOnly, 'valueLoop').points).toBe(0);
  });

  it('caps each value-loop half at 15 and the pillar at 30', () => {
    const evs = Array.from({ length: 50 }, (_, i) => [ev(i % 30, 'guide_created'), ev(i % 30, 'guide_viewed')]).flat();
    expect(pillar(scoreAccount(record(evs), ctx), 'valueLoop').points).toBe(30);
    const onlyViews = Array.from({ length: 50 }, (_, i) => ev(i % 30, 'guide_viewed'));
    expect(pillar(scoreAccount(record(onlyViews), ctx), 'valueLoop').points).toBe(15);
  });

  it('retention = users active in the window ÷ all users in the export; full credit at 60%', () => {
    const evs = [ev(1, 'login', 'a'), ev(2, 'login', 'b'), ev(3, 'login', 'c'), ev(60, 'login', 'd'), ev(61, 'login', 'e')];
    const r = pillar(scoreAccount(record(evs), ctx), 'retention');
    expect(r.measured).toBe('3 of 5 users (60%)');
    expect(r.points).toBe(20);
    const half = pillar(scoreAccount(record([ev(1, 'login', 'a'), ev(60, 'login', 'b'), ev(61, 'login', 'c'), ev(62, 'login', 'd')]), ctx), 'retention');
    expect(half.points).toBeCloseTo(20 * (0.25 / 0.6), 1);
  });

  it('momentum compares per-day rates with the preceding 2N days and drops to zero on a 60%+ decline', () => {
    const evs = [...Array.from({ length: 30 }, (_, i) => ev(31 + i * 2, 'guide_viewed', `u${i % 3}`)), ev(2, 'guide_viewed')];
    expect(pillar(scoreAccount(record(evs), ctx), 'momentum').ratio).toBe(0);
    expect(pillar(scoreAccount(record(healthyEvents()), ctx), 'momentum').ratio).toBe(1);
  });

  it('gives neutral momentum (no invented growth) when the baseline is not covered by the export', () => {
    const h = scoreAccount(record(healthyEvents()), ctx, settings(90)); // baseline would need 180 earlier days
    expect(h.window.baseline.sufficient).toBe(false);
    const m = pillar(h, 'momentum');
    expect(m.ratio).toBe(SCORING.momentum.insufficientBaselineCredit);
    expect(m.explanation).toContain('neutral');
  });
});

describe('business rules', () => {
  it('a downgrade subtracts 20 points and prevents Healthy', () => {
    const contract = { planTier: 'Enterprise' as const };
    const clean = scoreAccount(record(healthyEvents('Enterprise'), contract), ctx);
    const downgraded = healthyEvents('Enterprise').map((e) =>
      AS_OF.getTime() - e.timestamp.getTime() < 10 * DAY_MS ? { ...e, planTier: 'Pro' as const } : e,
    );
    const h = scoreAccount(record(downgraded, contract), ctx);
    expect(clean.status).toBe('healthy');
    expect(h.score).toBe(clean.score! - 20);
    expect(h.status).not.toBe('healthy');
    expect(h.overrides.map((o) => o.code)).toContain('downgrade_cap');
  });

  it('caps a downgraded account that still scores Healthy at Watch', () => {
    const evs = healthyEvents('Pro').map((e) => ({ ...e, planTier: 'Free' as const }));
    const h = scoreAccount(record(evs, { planTier: 'Pro' }), ctx);
    expect(h.scoreTier).toBe('healthy');
    expect(h.status).toBe('watch');
  });

  it('an account with no activity for more than 21 days is always At Risk', () => {
    const evs = healthyEvents().filter((e) => AS_OF.getTime() - e.timestamp.getTime() > 22 * DAY_MS);
    const h = scoreAccount(record(evs), ctx);
    expect(h.status).toBe('at_risk');
    expect(h.overrides.map((o) => o.code)).toContain('dormant');
    // Exactly 21 days is not dormant.
    const edge = scoreAccount(record([...evs, ev(21, 'guide_viewed')]), ctx);
    expect(edge.overrides.map((o) => o.code)).not.toContain('dormant');
  });

  it('reports every override that applies, not just the first', () => {
    // Contracted Enterprise, last seen on Pro 40 days ago: dormant, inactive AND downgraded.
    const h = scoreAccount(record([ev(40, 'login', 'u1', 'Pro')], { planTier: 'Enterprise' }), ctx);
    expect(h.overrides.map((o) => o.code)).toEqual(['dormant', 'activity_below_plan_threshold', 'downgrade_cap']);
    expect(h.statusReason).toContain('Dormant');
    expect(h.statusReason).toContain('threshold');
    expect(h.statusReason).toContain('downgrade');
  });

  it('keeps the score within 0–100', () => {
    const best = scoreAccount(record(healthyEvents()), ctx);
    expect(best.score).toBeLessThanOrEqual(100);
    const downgradedAndIdle = scoreAccount(record([ev(50, 'login', 'u1', 'Free')], { planTier: 'Enterprise' }), ctx);
    expect(downgradedAndIdle.baseScore!).toBeLessThan(20);
    expect(downgradedAndIdle.score).toBe(0);
  });

  it('ARR changes priority but never the health score', () => {
    const small = scoreAccount(record(tenOfThirty('Pro'), { arrUsd: 1_000 }), ctx);
    const big = scoreAccount(record(tenOfThirty('Pro'), { arrUsd: 500_000 }), ctx);
    expect(big.score).toBe(small.score);
    expect(big.status).toBe(small.status);
    expect(big.priority!).toBeGreaterThan(small.priority!);
  });

  it('scores an empty account as At Risk with score 0, never as healthy', () => {
    const h = scoreAccount(record([]), ctx);
    expect(h).toMatchObject({ eligible: true, score: 0, status: 'at_risk' });
    expect(pillar(h, 'retention').explanation).toContain('can’t be measured');
    expect(h.stats.lastActivity).toBeNull();
  });

  it('keeps context flags off the score', () => {
    const evs = [...healthyEvents(), ev(3, 'guide_viewed', 'u7', 'Pro', 'ws2')];
    const h = scoreAccount(record(evs, { contractStartDate: addDays(REF_DAY, -100) }), ctx);
    const codes = h.flags.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(['multi_workspace', 'onboarding']));
    expect(h.flags.filter((f) => f.code !== 'downgrade').every((f) => f.penalty === 0)).toBe(true);
    expect(h.score).toBe(h.baseScore);
  });
});

describe('detectDowngrade', () => {
  it('finds when events moved to a lower plan than contracted', () => {
    const evs = [ev(40, 'login', 'u1', 'Enterprise'), ev(10, 'login', 'u1', 'Pro'), ev(5, 'login', 'u1', 'Pro')];
    expect(detectDowngrade(evs, 'Enterprise')).toEqual({ from: 'Enterprise', to: 'Pro', since: '2026-09-03' });
  });

  it('ignores a dip that recovered, and upgrades', () => {
    expect(detectDowngrade([ev(20, 'login', 'u1', 'Pro'), ev(5, 'login', 'u1', 'Enterprise')], 'Enterprise')).toBeNull();
    expect(detectDowngrade([ev(5, 'login', 'u1', 'Enterprise')], 'Pro')).toBeNull();
  });
});

describe('HealthService (list, summary and detail stay consistent)', () => {
  const records = [
    record(tenOfThirty('Enterprise'), { companyName: 'Big Ent', planTier: 'Enterprise', arrUsd: 300_000 }),
    record(tenOfThirty('Free'), { companyName: 'Small Free', planTier: 'Free', arrUsd: 0 }),
    record(healthyEvents(), { companyName: 'Steady Pro', arrUsd: 40_000 }),
    record(healthyEvents(), { companyName: 'Brand New', arrUsd: 90_000, contractStartDate: addDays(REF_DAY, -12) }),
  ];
  const dataset: Dataset = { ...ctx, records, issues: [] };
  const service = new HealthService({ get: () => dataset } as unknown as DatasetService);

  it('puts accounts forced to At Risk at the top of the queue and new accounts last, with no priority', () => {
    const queue = service.list();
    expect(queue[0].companyName).toBe('Big Ent');
    expect(queue[0].status).toBe('at_risk');
    const last = queue[queue.length - 1];
    expect(last).toMatchObject({ companyName: 'Brand New', status: 'onboarding', priority: null, score: null });
    expect(service.list({ status: 'at_risk' }).map((a) => a.companyName)).not.toContain('Brand New');
  });

  it('returns the same numbers from list, detail and summary for the same settings', () => {
    for (const s of [settings(30), settings(7), settings(60, 10)]) {
      const list = service.list({}, s);
      for (const row of list) {
        const d = service.detail(row.slug, s)!;
        expect(d.score).toBe(row.score);
        expect(d.status).toBe(row.status);
        expect(d.priority).toBe(row.priority);
        expect(d.window).toEqual(row.window);
      }
      const summary = service.summary(s);
      expect(summary.settings).toEqual(s);
      expect(Object.values(summary.statuses).reduce((n, x) => n + x.count, 0)).toBe(list.length);
      expect(summary.statuses.at_risk.count).toBe(list.filter((a) => a.status === 'at_risk').length);
    }
  });

  it('recalculates when the settings change', () => {
    const at30 = service.detail('steady-pro', settings(30))!;
    const at7 = service.detail('steady-pro', settings(7))!;
    expect(at7.window.lookbackDays).toBe(7);
    expect(at7.pillars.find((p) => p.key === 'valueLoop')!.explanation).not.toBe(
      at30.pillars.find((p) => p.key === 'valueLoop')!.explanation,
    );
    expect(service.detail('brand-new', settings(30, 10))!.eligible).toBe(true);
    expect(service.summary(settings(30, 10)).statuses.onboarding.count).toBe(0);
    expect(service.summary(settings(30, 30)).statuses.onboarding.count).toBe(1);
  });
});
