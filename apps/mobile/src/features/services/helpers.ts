/**
 * Pure helpers of the Services screens: local filtering, triage ordering, and whether a service reports HTTP metrics
 * at all. The list is a triage tool, so health always decides the order; favorites only break ties.
 */
import type { HealthStatus, ServiceSummary } from '@/api/contract';

export type HealthFilter = 'all' | HealthStatus;

export const HEALTH_FILTERS: HealthFilter[] = ['all', 'critical', 'degraded', 'healthy', 'unknown'];

/** Case-insensitive match on name and kind, plus an optional health filter. */
export function filterServices<T extends Pick<ServiceSummary, 'name' | 'kind' | 'health'>>(services: T[], text: string, health: HealthFilter): T[] {
  const needle = text.trim().toLowerCase();
  return services.filter(
    (s) => (health === 'all' || s.health === health) && (!needle || s.name.toLowerCase().includes(needle) || (s.kind ?? '').toLowerCase().includes(needle)),
  );
}

const HEALTH_RANK: Record<HealthStatus, number> = { critical: 0, degraded: 1, unknown: 2, healthy: 3 };

/**
 * Triage order: worst health first, favorites pinned inside each health group. A favorite is a preference, so it
 * never pushes a healthy service above a service that is on fire. Ties keep the server's order (the sort is stable).
 */
export function favoritesFirst<T extends { id: string; health: HealthStatus }>(services: T[], isFavorite: (id: string) => boolean): T[] {
  return [...services].sort(
    (a, b) => HEALTH_RANK[a.health] - HEALTH_RANK[b.health] || Number(isFavorite(b.id)) - Number(isFavorite(a.id)),
  );
}

/**
 * A worker behind no load balancer has no request, latency or error-rate metric at all. That is "not measured", not
 * "broken", and the screens say so instead of stacking three "No data" cells.
 */
export function hasHttpMetrics(service: Pick<ServiceSummary, 'errorRate' | 'latencyP95' | 'requests'>): boolean {
  return service.errorRate.value !== null || service.latencyP95.value !== null || service.requests.value !== null;
}
