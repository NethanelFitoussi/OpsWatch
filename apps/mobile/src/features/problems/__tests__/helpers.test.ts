import type { Evidence } from '@/api/contract';
import { translate } from '@/i18n';
import {
  briefCountsLine,
  briefHeadline,
  categoriesOf,
  categoryFromValue,
  categoryValue,
  CATEGORY_ALL,
  DEFAULT_FILTERS,
  deploymentCorrelationText,
  hasNarrowingFilters,
  occurrencesText,
  problemDuration,
  problemEvidence,
  sinceFor,
  toProblemFilters,
} from '../helpers';

const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate('en', key, params);
const tFr = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate('fr', key, params);
const MIN = 60_000;

describe('toProblemFilters', () => {
  it('asks for open problems by default and leaves every other filter out', () => {
    expect(toProblemFilters(DEFAULT_FILTERS)).toEqual({ status: 'open' });
  });

  it('drops the status for "all" and maps every narrowing filter', () => {
    expect(toProblemFilters({ status: 'all', severities: ['warning', 'critical'], category: 'databases', since: 1000, service: 'svc-a' })).toEqual({
      severity: ['critical', 'warning'],
      category: 'databases',
      since: 1000,
      service: 'svc-a',
    });
  });

  it('can leave the category out (for deriving the category chips)', () => {
    expect(toProblemFilters({ ...DEFAULT_FILTERS, category: 'databases' }, { withCategory: false })).toEqual({ status: 'open' });
  });

  it('passes a specific status through', () => {
    expect(toProblemFilters({ ...DEFAULT_FILTERS, status: 'resolved' })).toEqual({ status: 'resolved' });
  });
});

describe('filter helpers', () => {
  it('computes `since` from the time range', () => {
    expect(sinceFor('1h', 10 * 3_600_000)).toBe(9 * 3_600_000);
    expect(sinceFor('7d', 8 * 24 * 3_600_000)).toBe(24 * 3_600_000);
    expect(sinceFor('any', 123)).toBeNull();
  });

  it('knows when filters narrow the list', () => {
    expect(hasNarrowingFilters(DEFAULT_FILTERS)).toBe(false);
    expect(hasNarrowingFilters({ ...DEFAULT_FILTERS, severities: ['info'] })).toBe(true);
    expect(hasNarrowingFilters({ ...DEFAULT_FILTERS, service: 'svc' })).toBe(true);
  });

  it('derives sorted, unique categories and keeps the selected one', () => {
    expect(categoriesOf([{ category: 'rds' }, { category: 'ecs' }, { category: 'rds' }], null)).toEqual(['ecs', 'rds']);
    expect(categoriesOf([], 'redis')).toEqual(['redis']);
  });

  it('round-trips category chip values', () => {
    expect(categoryFromValue(categoryValue('databases'))).toBe('databases');
    expect(categoryFromValue(CATEGORY_ALL)).toBeNull();
  });
});

describe('problemDuration', () => {
  it('runs until now while the problem is open', () => {
    expect(problemDuration({ status: 'active', firstSeenAt: 0, lastSeenAt: 5 * MIN }, 43 * MIN)).toEqual({ ms: 43 * MIN, ongoing: true });
  });
  it('stops at the last occurrence once resolved', () => {
    expect(problemDuration({ status: 'resolved', firstSeenAt: 0, lastSeenAt: 15 * MIN }, 999 * MIN)).toEqual({ ms: 15 * MIN, ongoing: false });
  });
});

describe('phrasing', () => {
  const deployment = { version: 'v2.14.0', service: { type: 'service' as const, id: 'svc-checkout-api', label: 'checkout-api' } };

  it('states deployment timing as a fact, never as a cause', () => {
    const text = deploymentCorrelationText(t, deployment, 9);
    expect(text).toBe('Started 9 min after deployment v2.14.0 of checkout-api');
    expect(text).not.toMatch(/caus/i);
    expect(deploymentCorrelationText(t, deployment, 75)).toBe('Started 1 h 15 min after deployment v2.14.0 of checkout-api');
    expect(deploymentCorrelationText(t, { ...deployment, service: { type: 'service', id: 'svc-x' } }, 3)).toContain('of svc-x');
  });

  it('reads like the brief example', () => {
    expect(`${briefHeadline(t, 'Production', 'degraded')} · ${briefCountsLine(t, { critical: 2, warning: 4, healthyServices: 18, totalServices: 22 })}`).toBe(
      'Production: DEGRADED · 2 critical · 4 warnings · 18 healthy services',
    );
  });

  it('uses singular forms and never turns missing data into 0', () => {
    expect(briefCountsLine(t, { critical: 0, warning: 1, healthyServices: null, totalServices: null })).toBe('0 critical · 1 warning · healthy services: no data');
    expect(briefCountsLine(tFr, { critical: 2, warning: 1, healthyServices: 1, totalServices: 3 })).toBe('2 critiques · 1 avertissement · 1 service sain');
    expect(occurrencesText(t, null)).toBeNull();
    expect(occurrencesText(t, 1)).toBe('1 occurrence');
    expect(occurrencesText(t, 3712)).toBe('3712 occurrences');
  });
});

describe('problemEvidence', () => {
  const item = (id: string, kind: Evidence['kind']): Evidence => ({ id, at: 0, kind, type: 'metric', title: id });

  it('labels every possible cause as a hypothesis and de-duplicates', () => {
    const merged = problemEvidence({ evidence: [item('a', 'fact'), item('b', 'fact')], possibleCauses: [item('b', 'fact'), item('c', 'correlation')] });
    expect(merged.map((e) => [e.id, e.kind])).toEqual([
      ['b', 'hypothesis'],
      ['c', 'hypothesis'],
      ['a', 'fact'],
    ]);
  });
});
