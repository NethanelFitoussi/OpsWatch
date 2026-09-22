/**
 * SLO arithmetic, from stored rollups only (§19).
 *
 * Pure: every function here is numbers in, numbers out. The rollups come from the historical storage
 * provider, so an SLO is computed from what OpsWatch wrote down rather than from a fresh AWS read — which
 * is what makes it cheap enough to show on every report.
 *
 * **The rule that shapes all of it:** an SLO never shows a number it cannot stand behind. A window less
 * than a quarter collected answers "not enough history" with the share it does have, rather than computing
 * a ratio over the fraction that happens to exist and presenting it as the period's.
 */

/** Below this share of the window collected, no figure is offered at all (§19). */
export const MIN_COVERAGE = 0.25;

/** §19's multi-window burn alerts: 14.4× over an hour is fast, 6× over six hours is slow. */
export const FAST_BURN = { rate: 14.4, windowMs: 60 * 60_000 } as const;
export const SLOW_BURN = { rate: 6, windowMs: 6 * 60 * 60_000 } as const;

export type SloStatus = 'healthy' | 'at_risk' | 'breached' | 'unknown';

/** One interval's worth of good and total. `null` for either means the interval was not measured. */
export type Bucket = { good: number | null; total: number | null };

export type SloResult = {
  /** The observed ratio, 0–1, or null when there is not enough history to state one. */
  current: number | null;
  /** Fraction of the error budget left. Negative once the budget is spent (§19 says so explicitly). */
  budgetRemaining: number | null;
  burnRate: number | null;
  status: SloStatus;
  /** The share of the window that was measured, always stated so "not enough" can be shown as a number. */
  coverage: number;
  /** Why there is no figure, when there is none. */
  reason: 'not_enough_history' | null;
};

/**
 * Availability from an ALB: good is requests that were not 5xx, per §19's definition.
 *
 * A 5xx count without a request count is not a ratio, so such an interval is left unmeasured rather than
 * being read as "zero requests, therefore perfect".
 */
export function albBucket(requests: number | null, elb5xx: number | null, target5xx: number | null): Bucket {
  if (requests === null) return { good: null, total: null };
  const bad = (elb5xx ?? 0) + (target5xx ?? 0);
  // More errors than requests cannot happen, but clamping is cheaper than a negative ratio reaching a page.
  return { good: Math.max(0, requests - bad), total: requests };
}

/**
 * Latency as §19 defines it: the share of intervals whose p95 was at or below the threshold.
 *
 * A bucket-based approximation rather than a per-request one, **because a read-only ALB gives no request
 * histogram**, and every surface showing it says that in one sentence.
 */
export function latencyBucket(p95Ms: number | null, thresholdMs: number): Bucket {
  if (p95Ms === null) return { good: null, total: null };
  return { good: p95Ms <= thresholdMs ? 1 : 0, total: 1 };
}

/** How much of the window was actually measured, which decides whether a figure may be shown at all. */
export function coverageOf(buckets: readonly Bucket[], expected: number): number {
  if (expected <= 0) return 0;
  const measured = buckets.filter((bucket) => bucket.total !== null).length;
  return Math.min(1, measured / expected);
}

export function evaluateSlo(
  buckets: readonly Bucket[],
  objective: number,
  /** How many intervals the window should contain, so a gap is a gap rather than a shorter window. */
  expectedBuckets: number,
): SloResult {
  const coverage = coverageOf(buckets, expectedBuckets);
  if (coverage < MIN_COVERAGE) {
    return { current: null, budgetRemaining: null, burnRate: null, status: 'unknown', coverage, reason: 'not_enough_history' };
  }

  const measured = buckets.filter((bucket): bucket is { good: number; total: number } => bucket.total !== null && bucket.good !== null);
  const total = measured.reduce((sum, bucket) => sum + bucket.total, 0);
  if (total === 0) {
    // Measured, but nothing happened. A ratio over no events is not 100 % — it is unknown.
    return { current: null, budgetRemaining: null, burnRate: null, status: 'unknown', coverage, reason: null };
  }

  const good = measured.reduce((sum, bucket) => sum + bucket.good, 0);
  const current = good / total;
  const allowedBad = 1 - objective;

  // §19: error budget = (1 − objective) × window; what is left is how much of that allowance is unspent.
  // An objective of 1 leaves no budget at all, so any failure exhausts it rather than dividing by zero.
  const observedBad = 1 - current;
  const budgetRemaining = allowedBad === 0 ? (observedBad > 0 ? -1 : 1) : (allowedBad - observedBad) / allowedBad;
  const burnRate = allowedBad === 0 ? (observedBad > 0 ? Number.POSITIVE_INFINITY : 0) : observedBad / allowedBad;

  return { current, budgetRemaining, burnRate, status: statusFor(budgetRemaining), coverage, reason: null };
}

/**
 * Breached once the budget is gone, at risk once most of it is.
 *
 * "At risk" is deliberately generous: an SLO that only turns amber at 95 % spent gives nobody time to act,
 * which is the complaint every alerting system eventually attracts.
 */
export function statusFor(budgetRemaining: number | null): SloStatus {
  if (budgetRemaining === null) return 'unknown';
  if (budgetRemaining <= 0) return 'breached';
  return budgetRemaining < 0.25 ? 'at_risk' : 'healthy';
}

/** Whether a burn rate over a window is fast or slow enough to be worth waking someone for (§19). */
export function burnAlert(burnRate: number | null, windowMs: number): 'fast' | 'slow' | null {
  if (burnRate === null || !Number.isFinite(burnRate)) return burnRate === null ? null : 'fast';
  if (windowMs <= FAST_BURN.windowMs && burnRate >= FAST_BURN.rate) return 'fast';
  if (windowMs <= SLOW_BURN.windowMs && burnRate >= SLOW_BURN.rate) return 'slow';
  return null;
}
