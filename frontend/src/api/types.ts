// Mirrors backend/src/common/types.ts (API DTOs). Kept as a copy rather than a shared
// package to keep the setup simple; see README "What I'd build next".

export type PlanTier = 'Free' | 'Pro' | 'Enterprise';
export type EventType = 'guide_created' | 'guide_viewed' | 'guide_shared' | 'user_invited' | 'login';
export type HealthTier = 'healthy' | 'watch' | 'at_risk';
/** Effective status: a health tier, or excluded from scoring. */
export type AccountStatus = HealthTier | 'onboarding' | 'insufficient_data';
export type Severity = 'info' | 'warning' | 'error';
export type SortKey = 'priority' | 'score' | 'arr' | 'name' | 'lastActivity';

export interface AuthUser {
  email: string;
  name: string;
  role: string;
}

export const EVENT_TYPES: EventType[] = ['guide_created', 'guide_viewed', 'guide_shared', 'user_invited', 'login'];

export interface PillarScore {
  key: 'activity' | 'valueLoop' | 'retention' | 'momentum';
  label: string;
  weight: number;
  ratio: number;
  points: number;
  measured: string;
  explanation: string;
}

export interface HealthFlag {
  code: 'downgrade' | 'dormant' | 'onboarding' | 'low_signal' | 'multi_workspace';
  severity: Severity;
  title: string;
  detail: string;
  penalty: number;
}

export interface AnalysisWindow {
  referenceDate: string;
  lookbackDays: number;
  start: string;
  end: string;
  observableDays: number;
  unobservableDays: number;
  baseline: { start: string; end: string; calendarDays: number; observableDays: number; sufficient: boolean };
}

export interface StatusOverride {
  code: 'dormant' | 'activity_below_plan_threshold' | 'downgrade_cap';
  status: HealthTier;
  reason: string;
}

export interface ActivityMetrics {
  activeDays: number;
  observableDays: number;
  rate: number | null;
  fullCreditRate: number;
  atRiskRate: number;
}

export interface AccountHealth {
  slug: string;
  companyName: string;
  domain: string;
  planTier: PlanTier;
  observedPlanTier: PlanTier | null;
  arrUsd: number;
  csmOwner: string;
  contractStartDate: string;
  tenureDays: number | null;
  eligible: boolean;
  status: AccountStatus;
  score: number | null;
  baseScore: number | null;
  scoreTier: HealthTier | null;
  overrides: StatusOverride[];
  statusReason: string | null;
  exclusion: { reason: string; message: string } | null;
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

export type WeeklyActivity = { weekStart: string } & Record<EventType, number>;

export interface AccountDetail extends AccountHealth {
  asOf: string;
  weekly: WeeklyActivity[];
  workspaceBreakdown: { workspaceId: string; events: number; eventsInWindow: number; users: number; lastSeen: string }[];
  users: { userId: string; events: number; lastSeen: string; activeInWindow: boolean; topAction: EventType }[];
  recentEvents: {
    eventId: string;
    timestamp: string;
    eventType: EventType;
    userId: string;
    workspaceId: string;
    planTier: PlanTier;
  }[];
}

export interface ScoringSettings {
  lookbackDays: number;
  minimumTenureDays: number;
}

export interface PortfolioSummary {
  asOf: string;
  windowStart: string;
  settings: ScoringSettings;
  window: AnalysisWindow;
  totalAccounts: number;
  totalArr: number;
  statuses: Record<AccountStatus, { count: number; arr: number }>;
  csms: string[];
  dataIssueCount: number;
}

export interface DataQualityIssue {
  code: string;
  severity: Severity;
  message: string;
  handling: string;
  companyName?: string;
}

export interface DataQuality {
  asOf: string;
  windowStart: string;
  gapDays: string[];
  issues: DataQualityIssue[];
}

export interface PlanExpectation {
  fullCreditActivityRate: number;
  atRiskActivityRate: number;
  producedPer30Days: number;
  consumedPer30Days: number;
}

/** Mirrors backend/src/health/scoring.config.ts (served by GET /api/methodology). */
export interface ScoringConfig {
  lookback: { defaultDays: number; minDays: number; maxDays: number; presets: number[] };
  tenure: { defaultMinimumDays: number; minDays: number; maxDays: number };
  weights: { activity: number; valueLoop: number; retention: number; momentum: number };
  planExpectations: Record<PlanTier, PlanExpectation>;
  retention: { fullCreditRate: number };
  momentum: {
    baselineMultiplier: number;
    fullCreditRatio: number;
    zeroCreditRatio: number;
    smoothing: number;
    minBaselineCoverage: number;
    insufficientBaselineCredit: number;
  };
  overrides: { downgradePenalty: number; downgradeMaxTier: HealthTier; dormantDays: number };
  context: { onboardingDays: number; lowSignalEvents: number };
  tiers: { healthy: number; watch: number };
}
