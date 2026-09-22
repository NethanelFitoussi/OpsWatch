import type { InfraResource } from '@/api/contract';
import { categoryFilters, healthCounts, healthSummaryParts } from '../helpers';

const r = (category: InfraResource['category'], health: InfraResource['health']) => ({ category, health });

describe('categoryFilters', () => {
  it('lists All plus the present categories in a fixed order', () => {
    expect(categoryFilters([r('storage', 'unknown'), r('rds', 'critical'), r('ecs', 'healthy'), r('rds', 'healthy')])).toEqual(['all', 'ecs', 'rds', 'storage']);
  });

  it('is just All for an empty list', () => {
    expect(categoryFilters([])).toEqual(['all']);
  });
});

describe('health summary', () => {
  const resources = [r('rds', 'critical'), r('rds', 'healthy'), r('redis', 'degraded'), r('ecs', 'degraded'), r('storage', 'unknown'), r('ecs', 'critical')];

  it('counts every status', () => {
    expect(healthCounts(resources)).toEqual({ critical: 2, degraded: 2, healthy: 1, unknown: 1 });
  });

  it('lists non-zero counts worst first', () => {
    expect(healthSummaryParts(resources)).toEqual([
      { status: 'critical', count: 2 },
      { status: 'degraded', count: 2 },
      { status: 'healthy', count: 1 },
      { status: 'unknown', count: 1 },
    ]);
    expect(healthSummaryParts([r('ec2', 'healthy')])).toEqual([{ status: 'healthy', count: 1 }]);
    expect(healthSummaryParts([])).toEqual([]);
  });
});
