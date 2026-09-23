/**
 * §8's baselines: what normal looks like for one series, at one hour of the week.
 *
 * Pure — numbers in, numbers out, no clock and no database. Every function here is the arithmetic and
 * nothing else, which is what makes "is this unusual?" a question with a written, testable answer rather
 * than a threshold somebody guessed.
 *
 * **Hour of the week, not hour of the day.** A checkout service at 3 a.m. on Sunday and at 3 a.m. on
 * Wednesday are different services as far as traffic is concerned, and a baseline that pools them calls
 * every Monday morning an anomaly.
 *
 * **Median and MAD, not mean and standard deviation.** The whole point of a baseline is to be unmoved by
 * the incident it is meant to detect: one hour of a tenfold spike drags a mean, and leaves a median where
 * it was. That is the difference between a baseline and a record of what has gone wrong.
 */

/** 168 hours in a week, and one bucket for each. */
export const BUCKETS = 168;

/** Below this many observations a bucket has no baseline. Three Wednesdays at 3 a.m. is not a pattern. */
export const MIN_SAMPLES = 8;

/** The constant that makes a MAD comparable with a standard deviation for normally distributed data. */
export const MAD_SCALE = 0.6745;

/** How far from normal is worth calling unusual at all (§8). Below it, a deviation is just a Tuesday. */
export const ANOMALY_Z = 3;

/**
 * Which of the week's 168 hours a moment belongs to, in UTC.
 *
 * UTC rather than the viewer's zone, because a baseline is a property of the series and must not move when
 * somebody in another country opens the page — and it must not shift twice a year either.
 */
export function bucketOf(atMs: number): number {
  const at = new Date(atMs);
  return at.getUTCDay() * 24 + at.getUTCHours();
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/** The median of the absolute deviations from the median — the robust answer to "how spread out is this?". */
export function medianAbsoluteDeviation(values: readonly number[], centre: number): number | null {
  return median(values.map((value) => Math.abs(value - centre)));
}

export type Baseline = {
  median: number;
  /** Zero is a real answer: a series that is always exactly the same has no spread. */
  mad: number;
  samples: number;
};

/**
 * The baseline of one bucket, or null when there is not enough of it.
 *
 * Null rather than a baseline computed from three points, because a baseline nobody can stand behind is
 * worse than none: it makes every reading look either normal or alarming with equal, unearned confidence.
 */
export function baselineOf(values: readonly number[]): Baseline | null {
  if (values.length < MIN_SAMPLES) return null;
  const centre = median(values);
  if (centre === null) return null;
  return { median: centre, mad: medianAbsoluteDeviation(values, centre) ?? 0, samples: values.length };
}

/**
 * How unusual one reading is, in robust standard deviations.
 *
 * `null` when there is no spread to measure against. A series that has been exactly 100 for a month has a
 * MAD of zero, and every arithmetic answer there is either zero or infinity — neither of which is a
 * statement about the reading. Saying "cannot tell" is the honest one, and it is what keeps the score's
 * `D` term at zero rather than at six.
 */
export function robustZ(value: number, baseline: Baseline): number | null {
  if (baseline.mad === 0) return null;
  return (MAD_SCALE * (value - baseline.median)) / baseline.mad;
}

/** Whether a reading is far enough above its baseline to be worth a sentence (§8). Above, not merely away. */
export function isSurge(value: number, baseline: Baseline): boolean {
  const z = robustZ(value, baseline);
  return z !== null && z >= ANOMALY_Z;
}
