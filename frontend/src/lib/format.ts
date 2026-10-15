import type { EventType, HealthTier } from '../api/types';

export const TIER_LABEL: Record<HealthTier, string> = {
  healthy: 'Healthy',
  watch: 'Watch',
  at_risk: 'At risk',
};

export const EVENT_LABEL: Record<EventType, string> = {
  guide_created: 'Guide created',
  guide_viewed: 'Guide viewed',
  guide_shared: 'Guide shared',
  user_invited: 'User invited',
  login: 'Login',
};

export const EVENT_COLOR: Record<EventType, string> = {
  guide_created: '#4f46e5',
  guide_viewed: '#0ea5e9',
  guide_shared: '#14b8a6',
  user_invited: '#f59e0b',
  login: '#94a3b8',
};

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usdCompact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export const formatUsd = (n: number) => usd.format(n);
export const formatUsdCompact = (n: number) => usdCompact.format(n);

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

export function daysAgo(days: number | null): string {
  if (days === null) return 'never';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}
