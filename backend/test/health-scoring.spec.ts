import { DAY_MS } from '../src/common/dates';
import type { Account, AccountRecord, EventType, PlanTier, UsageEvent } from '../src/common/types';
import {
  detectDowngrade,
  observedDays,
  priorityFor,
  ramp,
  scoreAccount,
  tierFor,
} from '../src/health/health-scoring';
import { SCORING } from '../src/health/scoring.config';

const AS_OF = new Date('2026-09-13T12:00:00Z');
const WINDOW_START = new Date(AS_OF.getTime() - 89 * DAY_MS);
const ctx = { asOf: AS_OF, windowStart: WINDOW_START, gapDays: [] as string[] };

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
    slug: 'acme',
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

/** A Pro account doing everything right: steady, broad, creating and viewing. */
function healthyEvents(): UsageEvent[] {
  const out: UsageEvent[] = [];
  for (let d = 1; d <= 85; d += 4) {
    const user = `u${d % 3}`;
    out.push(ev(d, 'guide_created', user), ev(d, 'guide_viewed', user), ev(d, 'guide_viewed', 'u9'));
  }
  return out;
}

describe('helpers', () => {
  it('ramp works in both directions and clamps', () => {
    expect(ramp(7, 7, 45)).toBe(1);
    expect(ramp(45, 7, 45)).toBe(0);
    expect(ramp(1.0, 1.0, 0.4)).toBe(1);
    expect(ramp(0.7, 1.0, 0.4)).toBeCloseTo(0.5);
    expect(ramp(5, 1.0, 0.4)).toBe(1);
  });

  it('tiers follow the configured thresholds', () => {
    expect(tierFor(SCORING.tiers.healthy)).toBe('healthy');
    expect(tierFor(SCORING.tiers.healthy - 1)).toBe('watch');
    expect(tierFor(SCORING.tiers.watch)).toBe('watch');
    expect(tierFor(SCORING.tiers.watch - 1)).toBe('at_risk');
  });

  it('observedDays excludes ingestion-gap days', () => {
    const from = new Date('2026-06-16T00:00:00Z');
    const to = new Date('2026-06-30T00:00:00Z');
    expect(observedDays(from, to, [])).toBe(14);
    expect(observedDays(from, to, ['2026-06-28'])).toBe(13);
    expect(observedDays(from, to, ['2026-07-05'])).toBe(14);
  });

  it('priority ranks a big unhealthy contract above a small one', () => {
    expect(priorityFor(20, 200_000)).toBeGreaterThan(priorityFor(20, 0));
    expect(priorityFor(100, 200_000)).toBe(0);
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

describe('scoreAccount', () => {
  it('scores a steady, broad Pro account as Healthy with no flags that cost points', () => {
    const h = scoreAccount(record(healthyEvents()), ctx);
    expect(h.tier).toBe('healthy');
    expect(h.score).toBeGreaterThanOrEqual(85);
    expect(h.flags.every((f) => f.penalty === 0)).toBe(true);
    expect(h.pillars.map((p) => p.key)).toEqual(['activity', 'valueLoop', 'retention', 'momentum']);
    expect(h.pillars.reduce((s, p) => s + p.weight, 0)).toBe(100);
  });

  it('logins alone earn no value-loop credit', () => {
    const evs = Array.from({ length: 10 }, (_, i) => ev(i * 2 + 1, 'login', `u${i % 3}`));
    const h = scoreAccount(record(evs), ctx);
    expect(h.pillars.find((p) => p.key === 'valueLoop')!.points).toBe(0);
  });

  it('needs both producing and consuming for full value-loop credit', () => {
    const onlyViews = Array.from({ length: 8 }, (_, i) => ev(i + 1, 'guide_viewed'));
    const h = scoreAccount(record(onlyViews), ctx);
    expect(h.pillars.find((p) => p.key === 'valueLoop')!.ratio).toBeCloseTo(0.5);
  });

  it('forces Dormant accounts to At Risk', () => {
    const evs = healthyEvents().filter((e) => e.timestamp.getTime() < AS_OF.getTime() - 25 * DAY_MS);
    const h = scoreAccount(record(evs), ctx);
    expect(h.tier).toBe('at_risk');
    expect(h.flags.map((f) => f.code)).toContain('dormant');
  });

  it('penalises a downgrade and never lets it be Healthy', () => {
    const evs = healthyEvents().map((e) =>
      e.timestamp.getTime() > AS_OF.getTime() - 10 * DAY_MS ? { ...e, planTier: 'Pro' as const } : { ...e, planTier: 'Enterprise' as const },
    );
    const base = scoreAccount(record(evs.map((e) => ({ ...e, planTier: 'Enterprise' as const })), { planTier: 'Enterprise' }), ctx);
    const h = scoreAccount(record(evs, { planTier: 'Enterprise' }), ctx);
    expect(h.flags.map((f) => f.code)).toContain('downgrade');
    expect(h.score).toBe(base.score - SCORING.overrides.downgradePenalty);
    expect(h.tier).not.toBe('healthy');
  });

  it('flags declining momentum against the account’s own baseline', () => {
    const evs = [
      ...Array.from({ length: 30 }, (_, i) => ev(35 + i, 'guide_viewed', `u${i % 3}`)),
      ev(2, 'guide_viewed'),
    ];
    const h = scoreAccount(record(evs), ctx);
    expect(h.pillars.find((p) => p.key === 'momentum')!.ratio).toBe(0);
  });

  it('rolls up multiple workspaces and flags it without a penalty', () => {
    const evs = [...healthyEvents(), ev(3, 'guide_viewed', 'u7', 'Pro', 'ws2')];
    const h = scoreAccount(record(evs), ctx);
    const flag = h.flags.find((f) => f.code === 'multi_workspace');
    expect(h.stats.workspaces).toBe(2);
    expect(flag?.penalty).toBe(0);
  });

  it('scores an account with no events at all as At Risk instead of crashing', () => {
    const h = scoreAccount(record([]), ctx);
    expect(h.score).toBe(0);
    expect(h.tier).toBe('at_risk');
    expect(h.stats.lastActivity).toBeNull();
  });
});
