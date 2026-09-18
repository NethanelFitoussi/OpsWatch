import { describe, expect, it } from 'vitest';
import {
  AUDIT_BUDGET, AUDIT_METRIC_QUERY_CAP, AUDIT_QUERIES_PER, REPORT_METRIC_QUERY_CAP,
  capResources, coverageOf, notCovered, notCoveredFromFailure, sortNotCovered,
} from '@/lib/analysis/coverage';

describe('the budget', () => {
  it('splits the audit cap exactly and fits the documented resource counts', () => {
    expect(Object.values(AUDIT_BUDGET).reduce((a, b) => a + b, 0)).toBe(AUDIT_METRIC_QUERY_CAP);
    expect(AUDIT_BUDGET.ecs / AUDIT_QUERIES_PER.ecs).toBe(100);
    expect(AUDIT_BUDGET.rds / AUDIT_QUERIES_PER.rds).toBe(50);
    expect(AUDIT_BUDGET.alb / AUDIT_QUERIES_PER.alb).toBe(30);
    expect(AUDIT_BUDGET.logs / AUDIT_QUERIES_PER.logs).toBe(60);
    expect(REPORT_METRIC_QUERY_CAP).toBe(300);
  });
});

describe('capResources', () => {
  const items = Array.from({ length: 10 }, (_, i) => `r${i}`);
  it('takes as many resources as the cap allows and reports the rest', () => {
    const { included, excluded, coverage } = capResources(items, 4, 20);  // 20 / 4 = 5
    expect(included).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
    expect(excluded).toEqual(['r5', 'r6', 'r7', 'r8', 'r9']);
    expect(coverage).toEqual({ covered: 5, total: 10, truncated: true });
  });
  it('keeps everything when the cap is not reached', () => {
    expect(capResources(items, 4, 400).coverage).toEqual({ covered: 10, total: 10, truncated: false });
  });
  it('rounds down rather than overspending, and never goes below zero', () => {
    expect(capResources(items, 3, 10).included).toHaveLength(3);   // floor(10 / 3)
    expect(capResources(items, 3, 2).included).toEqual([]);
    expect(capResources(items, 3, 2).coverage).toEqual({ covered: 0, total: 10, truncated: true });
  });
  it('treats a zero cost per resource as unlimited', () => {
    expect(capResources(items, 0, 5).coverage).toEqual({ covered: 10, total: 10, truncated: false });
  });
  it('reports an empty input as fully covered', () => {
    expect(capResources([], 4, 20).coverage).toEqual({ covered: 0, total: 0, truncated: false });
  });
});

describe('coverageOf', () => {
  it('marks truncation only when something was left out', () => {
    expect(coverageOf(3, 3)).toEqual({ covered: 3, total: 3, truncated: false });
    expect(coverageOf(3, 7)).toEqual({ covered: 3, total: 7, truncated: true });
  });
});

describe('notCovered', () => {
  it('carries the AWS reason, code and action of a failure', () => {
    expect(notCoveredFromFailure('db-orders', { ok: false, reason: 'denied', code: 'AccessDenied', action: 'pi:DescribeDimensionKeys' }))
      .toEqual({ resource: 'db-orders', reason: 'denied', code: 'AccessDenied', action: 'pi:DescribeDimensionKeys' });
  });
  it('carries no code for a structural reason', () => {
    expect(notCovered('db-legacy', 'pi_disabled')).toEqual({ resource: 'db-legacy', reason: 'pi_disabled', code: null, action: null });
  });
  it('sorts worst first, then by resource name', () => {
    const rows = [notCovered('b', 'cap'), notCovered('a', 'pi_disabled'), notCoveredFromFailure('c', { ok: false, reason: 'denied', code: 'X', action: 'y' }), notCovered('a', 'cap')];
    expect(sortNotCovered(rows).map((r) => [r.resource, r.reason])).toEqual([
      ['c', 'denied'], ['a', 'pi_disabled'], ['a', 'cap'], ['b', 'cap'],
    ]);
  });
});
