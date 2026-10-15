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

export const HEALTH_TIERS = ['healthy', 'watch', 'at_risk'] as const;
export type HealthTier = (typeof HEALTH_TIERS)[number];

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

export type PillarKey = 'activity' | 'valueLoop' | 'retention' | 'momentum';

export interface PillarScore {
  key: PillarKey;
  label: string;
  weight: number;
  /** 0..1 */
  ratio: number;
  points: number;
  /** Short measured value, e.g. "4 active days". */
  measured: string;
  /** Plain-English reason a CSM can read. */
  explanation: string;
}

export type FlagCode = 'downgrade' | 'dormant' | 'onboarding' | 'low_signal' | 'multi_workspace';

export interface HealthFlag {
  code: FlagCode;
  severity: Severity;
  title: string;
  detail: string;
  /** Points removed from the score (0 for context-only flags). */
  penalty: number;
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
  score: number;
  /** Score before overrides — so the UI can show what the penalty cost. */
  baseScore: number;
  tier: HealthTier;
  /** Set when an override moved the tier away from what the score alone gives. */
  tierReason: string | null;
  /** Triage order: low health on a large contract ranks first. */
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
  workspaceBreakdown: {
    workspaceId: string;
    events: number;
    events30d: number;
    users: number;
    lastSeen: string;
  }[];
  users: {
    userId: string;
    events: number;
    lastSeen: string;
    active30d: boolean;
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
  totalAccounts: number;
  totalArr: number;
  tiers: Record<HealthTier, { count: number; arr: number }>;
  csms: string[];
  dataIssueCount: number;
}
