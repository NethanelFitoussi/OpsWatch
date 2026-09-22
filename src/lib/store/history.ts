import 'server-only';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { historyPoints, historyWatermarks, type HistoryPointRow } from '../db/schema';

/**
 * The SQL behind the default historical store.
 *
 * It lives here rather than in `lib/history/` because §9.6 is unconditional: the store is the only SQL in the
 * product. That split is also the right shape — `lib/history/` holds *providers*, which are adapters over
 * some backend, and a future OpenSearch provider will have no SQL at all.
 */
export type HistorySeries = {
  category: string;
  connectionId: string;
  scope: string;
  subjectId: string;
  metric: string;
  resolution: string;
};

export type HistoryRow = Omit<HistoryPointRow, 'value'> & { value: number | null };

/**
 * Writes a batch and advances each series' watermark, in **one transaction**, so a reader never sees half a
 * batch. The upsert is what makes a replay a no-op: the primary key is the idempotency key.
 */
export function writeHistory(db: Db, rows: readonly HistoryRow[], watermarks: ReadonlyMap<string, number>): void {
  db.transaction((tx) => {
    for (const row of rows) {
      tx.insert(historyPoints)
        .values(row)
        .onConflictDoUpdate({
          target: [
            historyPoints.category,
            historyPoints.connectionId,
            historyPoints.scope,
            historyPoints.subjectId,
            historyPoints.metric,
            historyPoints.resolution,
            historyPoints.intervalStart,
          ],
          // Replaces rather than accumulates: the same key written twice must leave the same state.
          set: { value: row.value, samples: row.samples },
        })
        .run();
    }
    for (const [key, completeTo] of watermarks) {
      const [category, connectionId, scope, subjectId, metric, resolution] = key.split('\u0000');
      tx.insert(historyWatermarks)
        .values({ category, connectionId, scope, subjectId, metric, resolution, completeTo })
        .onConflictDoUpdate({
          target: [
            historyWatermarks.category,
            historyWatermarks.connectionId,
            historyWatermarks.scope,
            historyWatermarks.subjectId,
            historyWatermarks.metric,
            historyWatermarks.resolution,
          ],
          // Never backwards: backfilling an old gap must not un-complete newer data readers have acted on.
          set: { completeTo: sql`max(${historyWatermarks.completeTo}, ${completeTo})` },
        })
        .run();
    }
  });
}

export function readHistoryRange(db: Db, series: HistorySeries, from: number, to: number): HistoryPointRow[] {
  return db
    .select()
    .from(historyPoints)
    .where(
      and(
        eq(historyPoints.category, series.category),
        eq(historyPoints.connectionId, series.connectionId),
        eq(historyPoints.scope, series.scope),
        eq(historyPoints.subjectId, series.subjectId),
        eq(historyPoints.metric, series.metric),
        eq(historyPoints.resolution, series.resolution),
        gte(historyPoints.intervalStart, from),
        lt(historyPoints.intervalStart, to),
      ),
    )
    .orderBy(historyPoints.intervalStart)
    .all();
}

/** Zero when nothing has been written: "nothing is complete" rather than "everything is". */
export function readWatermark(db: Db, series: HistorySeries): number {
  return (
    db
      .select({ completeTo: historyWatermarks.completeTo })
      .from(historyWatermarks)
      .where(
        and(
          eq(historyWatermarks.category, series.category),
          eq(historyWatermarks.connectionId, series.connectionId),
          eq(historyWatermarks.scope, series.scope),
          eq(historyWatermarks.subjectId, series.subjectId),
          eq(historyWatermarks.metric, series.metric),
          eq(historyWatermarks.resolution, series.resolution),
        ),
      )
      .get()?.completeTo ?? 0
  );
}

export function purgeHistoryBefore(db: Db, beforeMs: number): number {
  return db.delete(historyPoints).where(lt(historyPoints.intervalStart, beforeMs)).run().changes;
}
