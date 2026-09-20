import 'server-only';
import { desc, eq, lt } from 'drizzle-orm';
import { randomId } from '../crypto';
import type { Db } from '../db/client';
import { collectorRuns, type CollectorRunRow } from '../db/schema';

/**
 * What every collector job did, which is the `collector_runs` half of §21's System status: per job the last run,
 * how long it took, what it covered and what a cap truncated.
 *
 * A run is written when it starts, not when it ends, so a job that dies mid-cycle leaves a `running` row behind
 * rather than no row at all. "Nothing was recorded" and "it never finished" must not look the same on a status
 * page — the second is the one worth investigating.
 */
export function startRun(
  db: Db,
  input: { job: string; connectionId: string | null; scope: string | null; startedAt: number },
): CollectorRunRow {
  return db
    .insert(collectorRuns)
    .values({ ...input, id: randomId(), status: 'running' })
    .returning()
    .get();
}

/**
 * Closes a run. `covered` and `total` are the honest pair behind `truncated`: a job that read 40 of 60 services
 * because a cap stopped it says so, so a page never presents a partial answer as a complete one (§2.4).
 */
export function finishRun(
  db: Db,
  id: string,
  result: {
    finishedAt: number;
    status: 'ok' | 'failed' | 'skipped';
    covered?: number | null;
    total?: number | null;
    truncated?: boolean;
    errorCode?: string | null;
  },
): void {
  db.update(collectorRuns)
    .set({
      finishedAt: result.finishedAt,
      status: result.status,
      covered: result.covered ?? null,
      total: result.total ?? null,
      truncated: result.truncated ?? false,
      errorCode: result.errorCode ?? null,
    })
    .where(eq(collectorRuns.id, id))
    .run();
}

/** The most recent runs, newest first. System status reads this and nothing else. */
export function lastRuns(db: Db, limit: number): CollectorRunRow[] {
  return db.select().from(collectorRuns).orderBy(desc(collectorRuns.seq)).limit(limit).all();
}

export function deleteRunsBefore(db: Db, beforeMs: number): number {
  return db.delete(collectorRuns).where(lt(collectorRuns.startedAt, beforeMs)).run().changes;
}
