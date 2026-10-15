import type { PlanTier } from '../common/types';

/** What each subscription plan is expected to do, and when it counts as at risk. */
export interface PlanExpectation {
  /** Share of observable days with activity that earns full Activity credit. */
  fullCreditActivityRate: number;
  /** Below this activity rate the account is At Risk, whatever its score. */
  atRiskActivityRate: number;
  /** guide_created + guide_shared per 30 days for full credit (scaled to the window). */
  producedPer30Days: number;
  /** guide_viewed per 30 days for full credit (scaled to the window). */
  consumedPer30Days: number;
}

/**
 * Every knob in the health model lives here so it can be debated and tuned in one place.
 *
 * These are INITIAL BUSINESS ASSUMPTIONS, not validated churn predictors. They were set
 * from the product brief and a 25-account sample; before production use they must be
 * calibrated against real renewal, downgrade and churn outcomes.
 */
export const SCORING = {
  /** The CSM-selectable analysis window ("lookback"), in calendar days ending on the reference date. */
  lookback: {
    defaultDays: 30,
    minDays: 7,
    maxDays: 180,
    presets: [7, 14, 30, 60, 90],
  },

  /** Accounts younger than this (contract start → reference date) are not scored yet. */
  tenure: {
    defaultMinimumDays: 30,
    minDays: 0,
    maxDays: 730,
  },

  /** Pillar maximums; they sum to 100. The Value Loop splits evenly into produce / consume. */
  weights: {
    activity: 30,
    valueLoop: 30,
    retention: 20,
    momentum: 20,
  },

  /** Plan-specific usage expectations and risk thresholds. */
  planExpectations: {
    Free: { fullCreditActivityRate: 0.2, atRiskActivityRate: 0.15, producedPer30Days: 2, consumedPer30Days: 2 },
    Pro: { fullCreditActivityRate: 0.4, atRiskActivityRate: 0.25, producedPer30Days: 3, consumedPer30Days: 4 },
    Enterprise: { fullCreditActivityRate: 0.6, atRiskActivityRate: 0.4, producedPer30Days: 4, consumedPer30Days: 5 },
  } satisfies Record<PlanTier, PlanExpectation> as Record<PlanTier, PlanExpectation>,

  retention: {
    /** Share of the export's users active in the window that earns full credit. */
    fullCreditRate: 0.6,
  },

  momentum: {
    /** The baseline is the `baselineMultiplier × lookback` days immediately before the current window. */
    baselineMultiplier: 2,
    /** Current per-day rate ÷ baseline per-day rate at or above this → full credit. */
    fullCreditRatio: 1.0,
    /** At or below this (a 60% drop) → zero credit. */
    zeroCreditRatio: 0.4,
    /** Pseudo-count added to both periods so 1-vs-0 events doesn't read as infinite growth. */
    smoothing: 1,
    /**
     * The baseline needs at least this share of its calendar days to be observable (inside
     * the export and not an ingestion gap). Otherwise momentum can't be measured fairly.
     */
    minBaselineCoverage: 0.5,
    /** Credit when the baseline is insufficient: neutral — neither invented growth nor decline. */
    insufficientBaselineCredit: 0.5,
  },

  overrides: {
    /** Points removed when events show the account on a lower plan than contracted. */
    downgradePenalty: 20,
    /** A downgraded account can't be Healthy, whatever the usage says. */
    downgradeMaxTier: 'watch' as const,
    /** No activity for longer than this (relative to the reference date) forces At Risk. */
    dormantDays: 21,
  },

  context: {
    /** Contract younger than this shows the informational "Onboarding" flag (no score effect). */
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

/** The two CSM-controlled settings that change how accounts are scored. */
export interface ScoringSettings {
  lookbackDays: number;
  minimumTenureDays: number;
}

export const DEFAULT_SETTINGS: ScoringSettings = {
  lookbackDays: SCORING.lookback.defaultDays,
  minimumTenureDays: SCORING.tenure.defaultMinimumDays,
};

export type SettingsResult = { ok: true; settings: ScoringSettings } | { ok: false; field: string; message: string };

/**
 * Validate raw settings (e.g. query-string values). Missing values fall back to the
 * defaults; anything present must be a whole number inside the configured range.
 */
export function parseScoringSettings(
  raw: { days?: string | number | null; minTenure?: string | number | null },
  cfg: ScoringConfig = SCORING,
): SettingsResult {
  const parse = (value: string | number | null | undefined, fallback: number, min: number, max: number) => {
    if (value === undefined || value === null || value === '') return fallback;
    const s = String(value).trim();
    if (!/^\d+$/.test(s)) return null;
    const n = Number(s);
    return n >= min && n <= max ? n : null;
  };

  const { minDays, maxDays, defaultDays } = cfg.lookback;
  const lookbackDays = parse(raw.days, defaultDays, minDays, maxDays);
  if (lookbackDays === null) {
    return { ok: false, field: 'days', message: `The analysis period must be a whole number of days between ${minDays} and ${maxDays}.` };
  }
  const t = cfg.tenure;
  const minimumTenureDays = parse(raw.minTenure, t.defaultMinimumDays, t.minDays, t.maxDays);
  if (minimumTenureDays === null) {
    return {
      ok: false,
      field: 'minTenure',
      message: `The minimum tenure must be a whole number of days between ${t.minDays} and ${t.maxDays}.`,
    };
  }
  return { ok: true, settings: { lookbackDays, minimumTenureDays } };
}
