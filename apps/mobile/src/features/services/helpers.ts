/**
 * Pure helpers of the Services screens: local filtering and favorite-first ordering. The server already sorts
 * unhealthy services first; these helpers keep that order and only pin favorites on top.
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

/** Favorites first, each group keeping the server's order (a stable partition, not a re-sort). */
export function favoritesFirst<T extends { id: string }>(services: T[], isFavorite: (id: string) => boolean): T[] {
  const favorites: T[] = [];
  const others: T[] = [];
  for (const service of services) (isFavorite(service.id) ? favorites : others).push(service);
  return [...favorites, ...others];
}
