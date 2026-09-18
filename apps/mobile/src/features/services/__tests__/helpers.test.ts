import type { ServiceSummary } from '@/api/contract';
import { favoritesFirst, filterServices } from '../helpers';

const metric = { value: null, unit: 'percent' as const, status: null };
const svc = (id: string, name: string, health: ServiceSummary['health'], kind?: string): ServiceSummary => ({
  id, name, kind, health, errorRate: metric, latencyP95: metric, requests: metric, openProblems: null, firingAlerts: null,
});

const list = [
  svc('a', 'checkout-api', 'critical', 'ECS service'),
  svc('b', 'orders-worker', 'degraded', 'ECS worker'),
  svc('c', 'catalog-api', 'healthy', 'ECS service'),
  svc('d', 'media-resizer', 'unknown', 'Lambda'),
];

describe('filterServices', () => {
  it('returns everything with no text and "all"', () => {
    expect(filterServices(list, '', 'all')).toHaveLength(4);
  });

  it('matches name or kind, case-insensitively, ignoring surrounding spaces', () => {
    expect(filterServices(list, '  API ', 'all').map((s) => s.id)).toEqual(['a', 'c']);
    expect(filterServices(list, 'worker', 'all').map((s) => s.id)).toEqual(['b']);
    expect(filterServices(list, 'lambda', 'all').map((s) => s.id)).toEqual(['d']);
  });

  it('filters by health and combines with text', () => {
    expect(filterServices(list, '', 'critical').map((s) => s.id)).toEqual(['a']);
    expect(filterServices(list, 'catalog', 'critical')).toEqual([]);
    expect(filterServices(list, '', 'unknown').map((s) => s.id)).toEqual(['d']);
  });
});

describe('favoritesFirst', () => {
  it('pins favorites on top and keeps the server order inside each group', () => {
    const ordered = favoritesFirst(list, (id) => id === 'c' || id === 'd');
    expect(ordered.map((s) => s.id)).toEqual(['c', 'd', 'a', 'b']);
  });

  it('keeps the order when there are no favorites', () => {
    expect(favoritesFirst(list, () => false).map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
