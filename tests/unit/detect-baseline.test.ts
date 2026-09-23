import { describe, expect, it } from 'vitest';
import {
  ANOMALY_Z,
  BUCKETS,
  MAD_SCALE,
  MIN_SAMPLES,
  baselineOf,
  bucketOf,
  isSurge,
  median,
  medianAbsoluteDeviation,
  robustZ,
} from '@/lib/detect/baseline';

/**
 * §8's baselines.
 *
 * The rulings are the two choices that make a baseline a baseline rather than a record of what has already
 * gone wrong: hour of the **week**, and **median** rather than mean.
 */

const SUNDAY_MIDNIGHT_UTC = Date.UTC(2026, 8, 20, 0, 0, 0);
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

describe('which bucket a moment belongs to', () => {
  it('THE RULING: hour of the week, so Monday morning is not measured against Sunday night', () => {
    // 20 September 2026 is a Sunday, so it is bucket 0.
    expect(bucketOf(SUNDAY_MIDNIGHT_UTC)).toBe(0);
    expect(bucketOf(SUNDAY_MIDNIGHT_UTC + 9 * HOUR)).toBe(9);
    // Monday 09:00 is a different bucket from Sunday 09:00, which is the whole point.
    expect(bucketOf(SUNDAY_MIDNIGHT_UTC + DAY + 9 * HOUR)).toBe(33);
    expect(bucketOf(SUNDAY_MIDNIGHT_UTC + 7 * DAY)).toBe(0);
  });

  it('covers the week and nothing more', () => {
    const seen = new Set(Array.from({ length: BUCKETS }, (_, i) => bucketOf(SUNDAY_MIDNIGHT_UTC + i * HOUR)));
    expect(seen.size).toBe(BUCKETS);
    expect(Math.max(...seen)).toBe(BUCKETS - 1);
  });

  it('is decided in UTC, so a baseline does not move when somebody abroad opens the page', () => {
    // Stated as an assertion about the arithmetic rather than about a timezone the test cannot change.
    expect(bucketOf(Date.UTC(2026, 0, 1, 23, 59, 59))).toBe(bucketOf(Date.UTC(2026, 0, 1, 23, 0, 0)));
  });
});

describe('the middle and the spread', () => {
  it('takes the middle of an even-length series as the mean of the two centre values', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBeNull();
  });

  it('THE RULING: one spike moves a mean and leaves the median where it was', () => {
    const quiet = [100, 101, 99, 100, 102, 98, 100, 101];
    const withSpike = [...quiet.slice(0, 7), 100_000];
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

    // The baseline must be unmoved by the incident it exists to detect.
    expect(median(withSpike)).toBeCloseTo(median(quiet) ?? 0, 0);
    expect(mean(withSpike)).toBeGreaterThan(mean(quiet) * 100);
  });

  it('measures spread as the median of the distances from the middle', () => {
    // Distances from 3 are 2, 1, 0, 1, 2 — whose median is 1, not the largest of them.
    expect(medianAbsoluteDeviation([1, 2, 3, 4, 5], 3)).toBe(1);
    expect(medianAbsoluteDeviation([5, 5, 5], 5)).toBe(0);
  });
});

describe('a bucket’s baseline', () => {
  const enough = Array.from({ length: MIN_SAMPLES }, (_, i) => 100 + (i % 2));

  it('THE RULING: too few observations is no baseline, not a confident one', () => {
    expect(baselineOf(enough.slice(0, MIN_SAMPLES - 1))).toBeNull();
    expect(baselineOf(enough)).not.toBeNull();
  });

  it('records how many observations it rests on, so a thin one can be shown as thin', () => {
    expect(baselineOf(enough)?.samples).toBe(MIN_SAMPLES);
  });

  it('keeps a zero spread, because "always the same" is a real answer', () => {
    const flat = Array.from({ length: MIN_SAMPLES }, () => 42);
    expect(baselineOf(flat)).toMatchObject({ median: 42, mad: 0 });
  });
});

describe('how unusual a reading is', () => {
  const baseline = { median: 100, mad: 10, samples: 40 };

  it('is zero at the baseline and grows away from it', () => {
    expect(robustZ(100, baseline)).toBe(0);
    expect(robustZ(200, baseline) ?? 0).toBeGreaterThan(0);
    expect(robustZ(50, baseline) ?? 0).toBeLessThan(0);
  });

  it('THE RULING: a series with no spread cannot say, and says so rather than answering infinity', () => {
    // Every arithmetic answer here is zero or infinity, and neither is a statement about the reading.
    expect(robustZ(500, { median: 100, mad: 0, samples: 40 })).toBeNull();
    expect(robustZ(100, { median: 100, mad: 0, samples: 40 })).toBeNull();
  });

  it('calls a surge one only above the threshold, and never below the baseline', () => {
    // Exactly ANOMALY_Z away, plus a hair so the comparison is not decided by a rounding error.
    const far = baseline.median + (ANOMALY_Z * baseline.mad) / MAD_SCALE + 1;
    expect(isSurge(far, baseline)).toBe(true);
    expect(isSurge(far - 2 * baseline.mad, baseline)).toBe(false);
    // A collapse in traffic is unusual too, and it is not a surge.
    expect(isSurge(0, baseline)).toBe(false);
  });

  it('cannot be called a surge when there is nothing to compare against', () => {
    expect(isSurge(9999, { median: 100, mad: 0, samples: 40 })).toBe(false);
  });
});
