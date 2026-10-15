// Mirrors backend/src/common/types.ts (API DTOs). Kept as a copy rather than a shared
// package to keep the setup simple; see README "What I'd build next".

export type PlanTier = 'Free' | 'Pro' | 'Enterprise';
export type EventType = 'guide_created' | 'guide_viewed' | 'guide_shared' | 'user_invited' | 'login';
export type HealthTier = 'healthy' | 'watch' | 'at_risk';
export type Severity = 'info' | 'warning' | 'error';
export type SortKey = 'priority' | 'score' | 'arr' | 'name' | 'lastActivity';

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

export interface AccountHealth {
  slug: string;
  companyName: string;
  domain: string;
  planTier: PlanTier;
  observedPlanTier: PlanTier | null;
  arrUsd: number;
  csmOwner: string;
  contractStartDate: string;
  score: number;
  baseScore: number;
  tier: HealthTier;
  tierReason: string | null;
  priority: number;
  pillars: PillarScore[];
  flags: HealthFlag[];
  summary: string;
  stats: {
    totalEvents: number;
    events30d: number;
    activeDays30d: number;
    activeUsers30d: number;
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
  workspaceBreakdown: { workspaceId: string; events: number; events30d: number; users: number; lastSeen: string }[];
  users: { userId: string; events: number; lastSeen: string; active30d: boolean; topAction: EventType }[];
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
  totalAccounts: number;
  totalArr: number;
  tiers: Record<HealthTier, { count: number; arr: number }>;
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

type PerPlan = Record<PlanTier, number>;
export interface ScoringConfig {
  recentDays: number;
  weights: { activity: number; valueLoop: number; retention: number; momentum: number };
  targets: { activeDays: PerPlan; produced: PerPlan; consumed: PerPlan };
  retention: { fullCreditShare: number; minUserBase: number };
  momentum: { fullCreditRatio: number; zeroCreditRatio: number; smoothing: number };
  overrides: { downgradePenalty: number; downgradeMaxTier: HealthTier; dormantDays: number };
  context: { onboardingDays: number; lowSignalEvents: number };
  tiers: { healthy: number; watch: number };
}
