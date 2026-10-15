import type { PlanTier } from '../common/types';

type PerPlan = Record<PlanTier, number>;

/**
 * Every knob in the health model lives here so it can be debated and tuned in one place.
 * Pillar weights sum to 100. Each pillar produces a 0..1 ratio which is multiplied by its weight.
 */
export const SCORING = {
  /** "Current behaviour" window, in days, ending at the snapshot date. */
  recentDays: 30,

  weights: {
    activity: 30,
    valueLoop: 30,
    retention: 20,
    momentum: 20,
  },

  /**
   * Per-plan expectations for a 30-day window. A bigger contract is held to a higher bar.
   * Calibrated against this snapshot's distribution; in production these would be fit
   * to actual renewal and churn outcomes.
   */
  targets: {
    /** Distinct calendar days with any activity. */
    activeDays: { Free: 3, Pro: 6, Enterprise: 8 } as PerPlan,
    /** guide_created + guide_shared — someone is producing and distributing content. */
    produced: { Free: 2, Pro: 3, Enterprise: 4 } as PerPlan,
    /** guide_viewed — someone is consuming it. */
    consumed: { Free: 2, Pro: 4, Enterprise: 5 } as PerPlan,
  },

  retention: {
    /** Share of the 90-day user base active in the last 30 days that earns full credit. */
    fullCreditShare: 0.6,
    /** Denominator floor so a one-person account can't score 100% retention. */
    minUserBase: 2,
  },

  momentum: {
    /** Recent per-day rate ÷ prior per-day rate at or above this → full credit. */
    fullCreditRatio: 1.0,
    /** At or below this → zero credit. */
    zeroCreditRatio: 0.4,
    /** Pseudo-count added to both periods so 1-vs-0 events doesn't read as infinite growth. */
    smoothing: 1,
  },

  overrides: {
    /** Points removed when events show the account on a lower plan than contracted. */
    downgradePenalty: 20,
    /** A downgraded account can't be Healthy, whatever the usage says. */
    downgradeMaxTier: 'watch' as const,
    /** No activity for longer than this forces At Risk. */
    dormantDays: 21,
  },

  context: {
    /** Contract younger than this is still onboarding (informational). */
    onboardingDays: 180,
    /** Fewer events than this in the whole export → low-confidence score. */
    lowSignalEvents: 8,
  },

  tiers: {
    healthy: 70,
    watch: 45,
  },
};

export type ScoringConfig = typeof SCORING;

export const PLAN_RANK: Record<PlanTier, number> = { Free: 0, Pro: 1, Enterprise: 2 };
