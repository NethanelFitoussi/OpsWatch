import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { metricBaselines, type MetricBaselineRow } from '../db/schema';
import type { Baseline } from '../detect/baseline';

/**
 * §8's baselines, as rows.
 *
 * Nothing here computes anything: the arithmetic is in `lib/detect/baseline.ts` and stays pure, so a
 * recomputation is a write and a reading is a lookup. That split is what lets the baselines job run hourly
 * over weeks of history while a page answers "is this unusual?" with one indexed read.
 */

export type BaselineKey = { connectionId: string; scope: string; subjectId: string; metric: string };

/** Replaces one series' buckets. Written in a transaction, so a reader never sees half a recomputation. */
export function writeBaselines(
  db: Db,
  key: BaselineKey,
  buckets: ReadonlyMap<number, Baseline>,
  nowMs: number,
): number {
  return db.transaction(() => {
    let written = 0;
    for (const [bucket, baseline] of buckets) {
      db.insert(metricBaselines)
        .values({ ...key, bucket, median: baseline.median, mad: baseline.mad, samples: baseline.samples, computedAt: nowMs })
        .onConflictDoUpdate({
          target: [
            metricBaselines.connectionId,
            metricBaselines.scope,
            metricBaselines.subjectId,
            metricBaselines.metric,
            metricBaselines.bucket,
          ],
          set: { median: baseline.median, mad: baseline.mad, samples: baseline.samples, computedAt: nowMs },
        })
        .run();
      written += 1;
    }
    return written;
  });
}

/** One bucket's baseline, or null when the job has not computed one for that hour of the week yet. */
export function readBaseline(db: Db, key: BaselineKey, bucket: number): MetricBaselineRow | null {
  return (
    db
      .select()
      .from(metricBaselines)
      .where(
        and(
          eq(metricBaselines.connectionId, key.connectionId),
          eq(metricBaselines.scope, key.scope),
          eq(metricBaselines.subjectId, key.subjectId),
          eq(metricBaselines.metric, key.metric),
          eq(metricBaselines.bucket, bucket),
        ),
      )
      .get() ?? null
  );
}

/** Every baseline of one environment for the given metrics, for a caller that is about to check many. */
export function listBaselines(db: Db, environment: { connectionId: string; scope: string }, metrics: readonly string[]): MetricBaselineRow[] {
  if (metrics.length === 0) return [];
  return db
    .select()
    .from(metricBaselines)
    .where(
      and(
        eq(metricBaselines.connectionId, environment.connectionId),
        eq(metricBaselines.scope, environment.scope),
        inArray(metricBaselines.metric, [...metrics]),
      ),
    )
    .all();
}
