import 'server-only';
import type { Db } from '../db/client';
import { purgeHistoryBefore, readHistoryRange, readWatermark, writeHistory, type HistorySeries } from '../store/history';
import {
  RESOLUTION_MS,
  validateBatch,
  type HistoricalStorageProvider,
  type HistoryPoint,
  type HistoryQuery,
  type HistoryResult,
  type Resolution,
} from './provider';

/**
 * The default `HistoricalStorageProvider`: history in the OpsWatch database itself (§33.9).
 *
 * It is the one every installation gets, so it is also the one the conformance suite matters most for — a
 * guarantee the default provider does not keep is a guarantee the product does not have.
 *
 * This file is an **adapter**, not a store: the SQL lives in `lib/store/history.ts`, because §9.6 is
 * unconditional. A future OpenSearch provider sits here too and has no SQL at all.
 *
 * Each of §33.10's promises is kept by a mechanism rather than by care:
 *
 * - **Idempotent** because the primary key *is* the idempotency key, and a write is an upsert on it.
 * - **All-or-nothing** because the batch is validated before anything is written, and then written in one
 *   transaction — better-sqlite3 transactions are synchronous, so a reader cannot observe half of one.
 * - **Watermarked** by a row per series, advanced in the same transaction as the points it covers.
 * - **Skew-safe** because `validateBatch` throws before any write begins.
 */
export function opswatchDbProvider(db: Db): HistoricalStorageProvider {
  const seriesOf = (query: Omit<HistoryQuery, 'from' | 'to'>): HistorySeries => ({
    category: query.category,
    connectionId: query.connectionId,
    scope: query.scope,
    subjectId: query.subjectId,
    metric: query.metric,
    resolution: query.resolution,
  });

  return {
    id: 'opswatch-db',

    async write(points, nowMs) {
      if (points.length === 0) return;
      // Before anything is written, so a single bad point means the whole batch is refused.
      validateBatch(points, nowMs);
      writeHistory(db, points.map((point) => ({ ...point })), highestPerSeries(points));
    },

    async read(query): Promise<HistoryResult> {
      const watermark = readWatermark(db, seriesOf(query));
      const rows = readHistoryRange(db, seriesOf(query), query.from, query.to);
      return {
        // Never above the watermark: a detector must not act on an interval that is still filling.
        points: rows
          .filter((row) => row.intervalStart <= watermark)
          .map((row) => ({ ...row, resolution: row.resolution as Resolution, category: query.category })),
        watermark,
        // Said plainly, rather than left for a caller to infer from the last timestamp it happened to get.
        partial: query.to > watermark,
      };
    },

    async watermark(query) {
      return readWatermark(db, seriesOf(query));
    },

    async purge(beforeMs) {
      return purgeHistoryBefore(db, beforeMs);
    },
  };
}

/**
 * The end of the last complete interval per series in this batch.
 *
 * The interval's *end*, not its start: an interval beginning at noon with hourly resolution is complete at
 * one o'clock, and a watermark at noon would leave that hour looking unwritten and a reader would discard it.
 */
function highestPerSeries(points: readonly HistoryPoint[]): Map<string, number> {
  const highest = new Map<string, number>();
  for (const point of points) {
    const key = [point.category, point.connectionId, point.scope, point.subjectId, point.metric, point.resolution].join('\u0000');
    const completeTo = point.intervalStart + RESOLUTION_MS[point.resolution];
    highest.set(key, Math.max(highest.get(key) ?? 0, completeTo));
  }
  return highest;
}

/** Bounds a read to data that is complete, which is what a detector is required to do (§33.10). */
export const atOrBelow = (query: HistoryQuery, mark: number): HistoryQuery => ({ ...query, to: Math.min(query.to, mark) });
