import 'server-only';
import type { Db } from '../db/client';
import { readHistorySettings } from '../history/settings';
import { purgeHistoryBefore } from '../store/history';
import { runRetention, type RetentionReport } from '../store/retention';
import type { JobOutcome } from './runner';

/**
 * The `compact` job: one pass of forgetting, once a day (§9.4).
 *
 * It is the only **instance-scoped** job — it touches no provider and belongs to no environment — and that
 * turned out to matter more than it looks. `runJob` returned early for any job without a connection, which
 * every instance-scoped job is by definition, so this one was scheduled every day and discarded every time.
 * Retention was a setting that quietly did nothing. That is fixed in `run-job.ts`; this file is what it now
 * dispatches to.
 *
 * What it removes is reported rather than silent, so an operator who notices history is missing can see that
 * retention took it instead of suspecting a bug.
 */

export type CompactReport = RetentionReport & { historyPoints: number };

export function runCompact(db: Db, nowMs: number): CompactReport {
  const retention = runRetention(db, nowMs);

  // History has its own retention, chosen by the operator alongside the switch that starts collecting it.
  const { retentionDays } = readHistorySettings(db);
  const historyPoints = purgeHistoryBefore(db, nowMs - retentionDays * 24 * 60 * 60_000);

  return { ...retention, historyPoints };
}

/** How many rows one pass removed, which is what System status shows as the run's coverage. */
export function totalRemoved(report: CompactReport): number {
  return report.resolvedProblems + report.observationEvents + report.lifecycleEvents + report.collectorRuns + report.historyPoints;
}

export function runCompactJob(input: { db: Db; nowMs: number }): JobOutcome {
  const report = runCompact(input.db, input.nowMs);
  const removed = totalRemoved(report);
  // `covered` is rows removed and `total` the same number: a pass is never partial, and a cap never truncates
  // it, so reporting anything else would invent a fraction that does not exist.
  return { covered: removed, total: removed };
}
