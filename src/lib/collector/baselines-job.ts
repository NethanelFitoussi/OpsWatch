import 'server-only';
import type { Db } from '../db/client';
import { BUCKETS, baselineOf, bucketOf, type Baseline } from '../detect/baseline';
import { readHistorySettings } from '../history/settings';
import { listHistorySubjects, readHistoryRange } from '../store/history';
import { writeBaselines } from '../store/baselines';
import { JOBS } from './jobs';
import type { JobOutcome } from './runner';

/**
 * The `baselines` job: recomputing what normal looks like, once an hour (§8).
 *
 * It reads only what is already stored — the rollups the metrics job wrote — and asks AWS for nothing at
 * all. That is what makes it affordable to run over weeks of history: the expensive part was paid once, by
 * the job that collected it.
 *
 * **Behind the history switch**, and not by remembering to check: with history off there are no rollups, so
 * there is nothing to compute a baseline from. The guard is here rather than in the scheduler so an
 * operator who turns history on does not have to restart anything.
 */

/** The resolution the metrics job writes, and therefore the one a baseline is computed from. */
const RESOLUTION = '5m';

/** How far back one pass looks. Four weeks gives each hour of the week four observations per bucket. */
export const BASELINE_WINDOW_DAYS = 28;

/**
 * The series a baseline is kept for.
 *
 * A short, declared list rather than "everything stored". Every extra metric is 168 more rows per subject
 * and a baseline nobody reads, and §8's questions are all about these three: how much traffic, how slow,
 * and how much of the fleet is affected.
 */
export const BASELINE_METRICS = ['requests', 'p95', 'affected'] as const;

export type BaselinesJobInput = { db: Db; connectionId: string; scope: string; nowMs: number };

/**
 * Groups a series' points into the week's 168 buckets.
 *
 * An unmeasured interval is left out rather than counted as zero — §2.4, and here it matters twice over: a
 * gap counted as zero would drag a median down and then make the next ordinary hour look like a surge.
 */
export function bucketize(points: readonly { intervalStart: number; value: number | null }[]): Map<number, number[]> {
  const buckets = new Map<number, number[]>();
  for (const point of points) {
    if (point.value === null) continue;
    const bucket = bucketOf(point.intervalStart);
    const existing = buckets.get(bucket);
    if (existing === undefined) buckets.set(bucket, [point.value]);
    else existing.push(point.value);
  }
  return buckets;
}

/** The baselines of one series: a bucket with too few observations simply has none (§8). */
export function baselinesOf(points: readonly { intervalStart: number; value: number | null }[]): Map<number, Baseline> {
  const out = new Map<number, Baseline>();
  for (const [bucket, values] of bucketize(points)) {
    const baseline = baselineOf(values);
    if (baseline !== null) out.set(bucket, baseline);
  }
  return out;
}

export function runBaselinesJob(input: BaselinesJobInput): JobOutcome {
  // No rollups, no baselines. Nothing here reads AWS either way; this is about not claiming a pass did work.
  if (!readHistorySettings(input.db).enabled) return { covered: 0, total: 0 };

  const from = input.nowMs - BASELINE_WINDOW_DAYS * 24 * 60 * 60_000;
  const cap = JOBS.baselines.cap ?? Number.POSITIVE_INFINITY;

  let written = 0;
  let series = 0;
  let truncated = false;

  for (const metric of BASELINE_METRICS) {
    const subjects = listHistorySubjects(input.db, {
      category: 'metric',
      connectionId: input.connectionId,
      scope: input.scope,
      metric,
      resolution: RESOLUTION,
      fromMs: from,
      toMs: input.nowMs,
    });

    for (const subjectId of subjects) {
      // The cap is on rows written, which is what bounds the pass: 168 buckets per series is the worst case.
      if (written + BUCKETS > cap) {
        truncated = true;
        break;
      }
      series += 1;
      const points = readHistoryRange(
        input.db,
        { category: 'metric', connectionId: input.connectionId, scope: input.scope, subjectId, metric, resolution: RESOLUTION },
        from,
        input.nowMs,
      );
      written += writeBaselines(
        input.db,
        { connectionId: input.connectionId, scope: input.scope, subjectId, metric },
        baselinesOf(points),
        input.nowMs,
      );
    }
    if (truncated) break;
  }

  // `covered` is the series this pass computed baselines for, which is what System status shows as work
  // done. A pass over an environment with no rollups covered nothing, and says so rather than reporting one.
  return { covered: series, total: series, ...(truncated ? { truncated: true } : {}) };
}
