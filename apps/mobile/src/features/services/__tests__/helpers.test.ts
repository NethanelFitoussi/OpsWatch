import type { ServiceSummary } from '@/api/contract';
import { favoritesFirst, filterServices, hasHttpMetrics } from '../helpers';

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
  it('never lets a favorite outrank a service in worse health', () => {
    const ordered = favoritesFirst(list, (id) => id === 'c' || id === 'd');
    expect(ordered.map((s) => s.id)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('pins a favorite above its equally healthy peers', () => {
    const peers = [svc('x', 'x', 'healthy'), svc('y', 'y', 'healthy'), svc('z', 'z', 'healthy')];
    expect(favoritesFirst(peers, (id) => id === 'z').map((s) => s.id)).toEqual(['z', 'x', 'y']);
  });

  it('orders by health and keeps the server order inside a group when there are no favorites', () => {
    expect(favoritesFirst(list, () => false).map((s) => s.id)).toEqual(['a', 'b', 'd', 'c']);
    expect(list.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('hasHttpMetrics', () => {
  const value = (v: number | null) => ({ value: v, unit: 'percent' as const, status: null });

  it('is false only when all three metrics are missing', () => {
    expect(hasHttpMetrics({ errorRate: value(null), latencyP95: value(null), requests: value(null) })).toBe(false);
    expect(hasHttpMetrics({ errorRate: value(null), latencyP95: value(null), requests: value(0) })).toBe(true);
    expect(hasHttpMetrics({ errorRate: value(6.8), latencyP95: value(null), requests: value(null) })).toBe(true);
  });
});
