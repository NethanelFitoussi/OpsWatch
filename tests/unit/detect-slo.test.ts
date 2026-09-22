import { describe, expect, it } from 'vitest';
import {
  FAST_BURN,
  MIN_COVERAGE,
  SLOW_BURN,
  albBucket,
  burnAlert,
  coverageOf,
  evaluateSlo,
  latencyBucket,
  statusFor,
  type Bucket,
} from '@/lib/detect/slo';

/** A window of buckets, all measured, with a given share good. */
const buckets = (count: number, goodShare: number): Bucket[] =>
  Array.from({ length: count }, (_, index) => ({ good: index < Math.round(count * goodShare) ? 100 : 0, total: 100 }));

describe('§19 — availability from an ALB', () => {
  it('counts a request that was not 5xx as good', () => {
    expect(albBucket(1000, 5, 15)).toEqual({ good: 980, total: 1000 });
  });

  it('THE RULING: 5xx counts with no request count is not a ratio, so the interval is unmeasured', () => {
    // Reading it as "zero requests, therefore perfect" would report availability nobody observed.
    expect(albBucket(null, 5, 0)).toEqual({ good: null, total: null });
  });

  it('treats a missing error count as zero errors, because absent means none were reported', () => {
    expect(albBucket(500, null, null)).toEqual({ good: 500, total: 500 });
  });

  it('never produces a negative good count', () => {
    expect(albBucket(10, 20, 0).good).toBe(0);
  });
});

describe('§19 — latency, as the bucket approximation it is', () => {
  it('counts an interval good when its p95 was at or below the threshold', () => {
    expect(latencyBucket(400, 500)).toEqual({ good: 1, total: 1 });
    expect(latencyBucket(500, 500)).toEqual({ good: 1, total: 1 });
    expect(latencyBucket(501, 500)).toEqual({ good: 0, total: 1 });
  });

  it('leaves an unmeasured interval out rather than counting it as fast', () => {
    expect(latencyBucket(null, 500)).toEqual({ good: null, total: null });
  });
});

describe('§19 — never a number it cannot stand behind', () => {
  it('THE RULING: below a quarter of the window collected, there is no figure at all', () => {
    const sparse = [...buckets(2, 1), ...Array.from({ length: 10 }, () => ({ good: null, total: null }))];
    const result = evaluateSlo(sparse, 0.99, 12);
    expect(result).toMatchObject({ current: null, budgetRemaining: null, status: 'unknown', reason: 'not_enough_history' });
    // And the share collected is stated, so "not enough" can be shown as a number.
    expect(result.coverage).toBeCloseTo(2 / 12, 6);
    expect(MIN_COVERAGE).toBe(0.25);
  });

  it('computes once a quarter is collected', () => {
    const enough = [...buckets(3, 1), ...Array.from({ length: 9 }, () => ({ good: null, total: null }))];
    expect(evaluateSlo(enough, 0.99, 12).current).toBe(1);
  });

  it('THE RULING: measured but with no events is unknown, not 100 %', () => {
    // A ratio over nothing is not perfection. An idle service must not report a perfect SLO.
    const idle = Array.from({ length: 12 }, () => ({ good: 0, total: 0 }));
    expect(evaluateSlo(idle, 0.99, 12)).toMatchObject({ current: null, status: 'unknown', reason: null });
  });

  it('states coverage even when it is complete', () => {
    expect(evaluateSlo(buckets(12, 1), 0.99, 12).coverage).toBe(1);
    expect(coverageOf([], 10)).toBe(0);
    // A window that expects nothing cannot be partly covered.
    expect(coverageOf(buckets(1, 1), 0)).toBe(0);
  });
});

describe('the error budget', () => {
  it('is whole when nothing failed', () => {
    const result = evaluateSlo(buckets(12, 1), 0.99, 12);
    expect(result).toMatchObject({ current: 1, status: 'healthy' });
    expect(result.budgetRemaining).toBe(1);
    expect(result.burnRate).toBe(0);
  });

  it('is exactly spent when the observed failure rate equals the allowance', () => {
    // 99 % objective allows 1 % bad; exactly 1 % bad leaves nothing and is a breach, not a pass.
    const result = evaluateSlo([{ good: 99, total: 100 }], 0.99, 1);
    expect(result.current).toBeCloseTo(0.99, 10);
    expect(result.budgetRemaining).toBeCloseTo(0, 10);
    expect(result.burnRate).toBeCloseTo(1, 10);
    expect(result.status).toBe('breached');
  });

  it('goes negative once the budget is overspent, because §19 says it may', () => {
    const result = evaluateSlo([{ good: 97, total: 100 }], 0.99, 1);
    // 3 % bad against a 1 % allowance: twice the budget over, burning at three times the rate.
    expect(result.budgetRemaining).toBeCloseTo(-2, 10);
    expect(result.burnRate).toBeCloseTo(3, 10);
    expect(result.status).toBe('breached');
  });

  it('turns amber before it is gone, so there is time to act', () => {
    // 99 % objective, 0.8 % bad: a fifth of the budget left.
    const result = evaluateSlo([{ good: 992, total: 1000 }], 0.99, 1);
    expect(result.budgetRemaining).toBeCloseTo(0.2, 10);
    expect(result.status).toBe('at_risk');
  });

  it('THE RULING: an objective of 100 % leaves no budget, and does not divide by zero', () => {
    const perfect = evaluateSlo([{ good: 100, total: 100 }], 1, 1);
    expect(perfect).toMatchObject({ budgetRemaining: 1, burnRate: 0, status: 'healthy' });

    const anyFailure = evaluateSlo([{ good: 99, total: 100 }], 1, 1);
    expect(anyFailure.budgetRemaining).toBe(-1);
    expect(anyFailure.burnRate).toBe(Number.POSITIVE_INFINITY);
    expect(anyFailure.status).toBe('breached');
  });

  it('maps a budget to a status, and an absent one to unknown', () => {
    expect(statusFor(1)).toBe('healthy');
    expect(statusFor(0.24)).toBe('at_risk');
    expect(statusFor(0)).toBe('breached');
    expect(statusFor(-3)).toBe('breached');
    expect(statusFor(null)).toBe('unknown');
  });
});

describe('§19 — the multi-window burn alerts', () => {
  it('uses the standard rates', () => {
    expect(FAST_BURN).toEqual({ rate: 14.4, windowMs: 60 * 60_000 });
    expect(SLOW_BURN).toEqual({ rate: 6, windowMs: 6 * 60 * 60_000 });
  });

  it('fires fast over an hour and slow over six', () => {
    expect(burnAlert(15, FAST_BURN.windowMs)).toBe('fast');
    expect(burnAlert(7, SLOW_BURN.windowMs)).toBe('slow');
    // Seven times over an hour is not fast enough for the fast rule, and the hour is inside the slow window.
    expect(burnAlert(7, FAST_BURN.windowMs)).toBe('slow');
  });

  it('does not fire on an ordinary burn', () => {
    expect(burnAlert(1, FAST_BURN.windowMs)).toBeNull();
    expect(burnAlert(5.9, SLOW_BURN.windowMs)).toBeNull();
  });

  it('says nothing when there is no burn rate, and treats an infinite one as fast', () => {
    expect(burnAlert(null, FAST_BURN.windowMs)).toBeNull();
    expect(burnAlert(Number.POSITIVE_INFINITY, FAST_BURN.windowMs)).toBe('fast');
  });
});
