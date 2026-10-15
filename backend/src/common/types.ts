export const PLAN_TIERS = ['Free', 'Pro', 'Enterprise'] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const EVENT_TYPES = [
  'guide_created',
  'guide_viewed',
  'guide_shared',
  'user_invited',
  'login',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

// ---------- Domain (internal) ----------

export interface Account {
  companyName: string;
  domain: string;
  planTier: PlanTier;
  contractStartDate: string; // YYYY-MM-DD
  arrUsd: number;
  csmOwner: string;
}

export interface UsageEvent {
  eventId: string;
  workspaceId: string;
  companyName: string;
  eventType: EventType;
  userId: string;
  timestamp: Date;
  planTier: PlanTier;
}

export type Severity = 'info' | 'warning' | 'error';

export interface DataQualityIssue {
  code: string;
  severity: Severity;
  message: string;
  /** What the pipeline did about it. */
  handling: string;
  companyName?: string;
}

/** One account joined with every event from all of its workspaces (sorted ascending). */
export interface AccountRecord {
  slug: string;
  account: Account;
  events: UsageEvent[];
}

export interface Dataset {
  /** Snapshot "now": the latest event timestamp in the export. */
  asOf: Date;
  /** Midnight UTC of the first event day. */
  windowStart: Date;
  /** Days (YYYY-MM-DD) with zero events from any account — treated as ingestion gaps. */
  gapDays: string[];
  records: AccountRecord[];
  issues: DataQualityIssue[];
}

// ---------- API DTOs ----------

/** Tiers an eligible account can be placed in. */
export const HEALTH_TIERS = ['healthy', 'watch', 'at_risk'] as const;
export type HealthTier = (typeof HEALTH_TIERS)[number];

/** Accounts not scored at all: too new, or tenure can't be established. */
export const EXCLUDED_STATUSES = ['onboarding', 'insufficient_data'] as const;
export type ExcludedStatus = (typeof EXCLUDED_STATUSES)[number];

/** The effective status shown to CSMs. */
export const ACCOUNT_STATUSES = [...HEALTH_TIERS, ...EXCLUDED_STATUSES] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/**
 * The analysis window for one request. "Current" = `lookbackDays` calendar days ending
 * on (and including) the reference day; "baseline" = the `2 × lookbackDays` calendar
 * days immediately before it. All dates are UTC days, YYYY-MM-DD, inclusive.
 */
export interface AnalysisWindow {
  /** Timestamp of the latest event in the export: the scoring "now". */
  referenceDate: string;
  lookbackDays: number;
  start: string;
  end: string;
  /** Days in the window that can be evaluated: inside the export and not an ingestion gap. */
  observableDays: number;
  /** Window days that can't be evaluated (before the export starts, or ingestion gaps). */
  unobservableDays: number;
  /** Ingestion gaps inside the window: days the export has no data for (YYYY-MM-DD). */
  missingDataDays: string[];
  baseline: {
    start: string;
    end: string;
    calendarDays: number;
    observableDays: number;
    /** Ingestion gaps inside the baseline (YYYY-MM-DD). */
    missingDataDays: string[];
    /** False when too little of the baseline is observable to measure momentum fairly. */
    sufficient: boolean;
  };
}

export type PillarKey = 'activity' | 'valueLoop' | 'retention' | 'momentum';

export interface PillarScore {
  key: PillarKey;
  label: string;
  weight: number;
  /** 0..1 */
  ratio: number;
  points: number;
  /** Short measured value, e.g. "10 of 29 days (34%)". */
  measured: string;
  /** Plain-English reason a CSM can read, built from the actual numbers. */
  explanation: string;
}

export type FlagCode = 'downgrade' | 'dormant' | 'onboarding' | 'low_signal' | 'multi_workspace' | 'missing_data';

export interface HealthFlag {
  code: FlagCode;
  severity: Severity;
  title: string;
  detail: string;
  /** Points removed from the score (0 for context-only flags). */
  penalty: number;
}

export type OverrideCode = 'dormant' | 'activity_below_plan_threshold' | 'downgrade_cap';

/** A hard business rule that set the final status regardless of the score tier. */
export interface StatusOverride {
  code: OverrideCode;
  /** The status this rule forces (dormant / activity) or caps at (downgrade). */
  status: HealthTier;
  reason: string;
}

export interface ActivityMetrics {
  activeDays: number;
  observableDays: number;
  /** activeDays / observableDays; null when no day in the window is observable. */
  rate: number | null;
  fullCreditRate: number;
  atRiskRate: number;
}

export interface AccountExclusion {
  reason: 'below_minimum_tenure' | 'tenure_unknown' | 'unknown_plan' | 'no_observable_days';
  message: string;
}

export interface AccountHealth {
  slug: string;
  companyName: string;
  domain: string;
  planTier: PlanTier;
  /** Latest plan tier seen on events; can differ from the contract record. */
  observedPlanTier: PlanTier | null;
  arrUsd: number;
  csmOwner: string;
  contractStartDate: string;
  /** Days from contract start to the reference day; null if the start date is unusable. */
  tenureDays: number | null;
  /** False for onboarding / insufficient-data accounts: no score, tier or priority. */
  eligible: boolean;
  /** The effective status CSMs see. */
  status: AccountStatus;
  /** Final 0–100 score after the downgrade penalty; null when not eligible. */
  score: number | null;
  /** Sum of pillar points before penalties; null when not eligible. */
  baseScore: number | null;
  /** The tier the score alone gives, before hard overrides; null when not eligible. */
  scoreTier: HealthTier | null;
  /** Every hard rule that applied, in precedence order. */
  overrides: StatusOverride[];
  /** Why the status differs from the score tier, or why the account isn't scored. */
  statusReason: string | null;
  exclusion: AccountExclusion | null;
  /** Triage order: low health on a large contract ranks first. Null when not eligible. */
  priority: number | null;
  activity: ActivityMetrics | null;
  pillars: PillarScore[];
  flags: HealthFlag[];
  summary: string;
  window: AnalysisWindow;
  stats: {
    totalEvents: number;
    eventsInWindow: number;
    activeDaysInWindow: number;
    activeUsersInWindow: number;
    totalUsers: number;
    workspaces: number;
    lastActivity: string | null;
    daysSinceLastActivity: number | null;
  };
}

/** `missingDays`: days in this week the export has no data for, so a low bar isn't read as low usage. */
export type WeeklyActivity = { weekStart: string; missingDays: string[] } & Record<EventType, number>;

export interface AccountDetail extends AccountHealth {
  asOf: string;
  weekly: WeeklyActivity[];
  workspaceBreakdown: {
    workspaceId: string;
    events: number;
    eventsInWindow: number;
    users: number;
    lastSeen: string;
  }[];
  users: {
    userId: string;
    events: number;
    lastSeen: string;
    activeInWindow: boolean;
    topAction: EventType;
  }[];
  recentEvents: {
    eventId: string;
    timestamp: string;
    eventType: EventType;
    userId: string;
    workspaceId: string;
    planTier: PlanTier;
  }[];
}

export interface PortfolioSummary {
  asOf: string;
  windowStart: string;
  settings: { lookbackDays: number; minimumTenureDays: number };
  window: AnalysisWindow;
  totalAccounts: number;
  totalArr: number;
  /** Count and ARR per effective status, including accounts excluded from scoring. */
  statuses: Record<AccountStatus, { count: number; arr: number }>;
  csms: string[];
  dataIssueCount: number;
}
