/**
 * Pure helpers of the Infrastructure screens: category chips, health summary and category icons.
 */
import { INFRA_CATEGORIES, type HealthStatus, type InfraCategory, type InfraResource } from '@/api/contract';
import type { MessageKey } from '@/i18n';
import type { IconName } from '@/ui/layout';

export type CategoryFilter = 'all' | InfraCategory;

export const CATEGORY_ICONS: Record<InfraCategory, IconName> = {
  ecs: 'cube-outline',
  ec2: 'hardware-chip-outline',
  rds: 'server-outline',
  redis: 'flash-outline',
  'load-balancer': 'git-network-outline',
  storage: 'archive-outline',
  network: 'globe-outline',
  other: 'ellipse-outline',
};

export const CATEGORY_LABELS: Record<InfraCategory, MessageKey> = {
  ecs: 'infrastructure.category.ecs',
  ec2: 'infrastructure.category.ec2',
  rds: 'infrastructure.category.rds',
  redis: 'infrastructure.category.redis',
  'load-balancer': 'infrastructure.category.load-balancer',
  storage: 'infrastructure.category.storage',
  network: 'infrastructure.category.network',
  other: 'infrastructure.category.other',
};

/** "All" plus the categories present in the (unfiltered) data, in a fixed order. */
export function categoryFilters(resources: Pick<InfraResource, 'category'>[]): CategoryFilter[] {
  const present = new Set(resources.map((r) => r.category));
  return ['all', ...INFRA_CATEGORIES.filter((c) => present.has(c))];
}

export function healthCounts(resources: Pick<InfraResource, 'health'>[]): Record<HealthStatus, number> {
  const counts: Record<HealthStatus, number> = { critical: 0, degraded: 0, healthy: 0, unknown: 0 };
  for (const r of resources) counts[r.health] += 1;
  return counts;
}

const SUMMARY_ORDER: readonly HealthStatus[] = ['critical', 'degraded', 'healthy', 'unknown'];

/** The non-zero health counts, worst first: the parts of "2 critical · 3 degraded · 3 healthy". */
export function healthSummaryParts(resources: Pick<InfraResource, 'health'>[]): { status: HealthStatus; count: number }[] {
  const counts = healthCounts(resources);
  return SUMMARY_ORDER.filter((s) => counts[s] > 0).map((status) => ({ status, count: counts[status] }));
}
