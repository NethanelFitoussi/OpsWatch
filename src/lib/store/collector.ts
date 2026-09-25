import 'server-only';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { randomId } from '../crypto';
import type { Db } from '../db/client';
import { collectorLock, collectorRuns, type CollectorLockRow, type CollectorRunRow } from '../db/schema';

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

/**
 * The most recent run of one job in **each** environment it runs in.
 *
 * One row per `(connection, scope)` pair, which is what a per-environment job's status actually is. The
 * page used to take the first matching row out of the recent runs and print it as *the* job's status:
 * with two AWS accounts connected, `errors · ok · 3 minutes ago` could come from Production while the
 * same job had been failing in another account for a day. An unearned green is the one thing a
 * monitoring tool must not show about itself.
 */
export function latestRunPerEnvironment(db: Db, job: string): CollectorRunRow[] {
  const newest = db
    .select({ connectionId: collectorRuns.connectionId, scope: collectorRuns.scope, seq: sql<number>`max(${collectorRuns.seq})`.as('seq') })
    .from(collectorRuns)
    .where(eq(collectorRuns.job, job))
    .groupBy(collectorRuns.connectionId, collectorRuns.scope)
    .all();
  const seqs = newest.map((row) => row.seq);
  if (seqs.length === 0) return [];
  return db.select().from(collectorRuns).where(inArray(collectorRuns.seq, seqs)).orderBy(desc(collectorRuns.seq)).all();
}

/**
 * The most recent run of one job in one environment, or `null` if it has never run there.
 *
 * A `where` rather than a slice of the recent rows. Reading the last 200 runs and filtering in memory
 * worked with one AWS connection and quietly stopped working with several: five connections across four
 * regions running six environment-scoped jobs fill 200 rows in well under an hour, so an hourly job
 * falls off the end of the window and every surface above it reads "nobody has ever looked" — the exact
 * sentence this product reserves for a genuinely unmeasured environment.
 */
export function lastRunFor(db: Db, job: string, scope: { connectionId: string; scope: string }): CollectorRunRow | null {
  return (
    db
      .select()
      .from(collectorRuns)
      .where(and(eq(collectorRuns.job, job), eq(collectorRuns.connectionId, scope.connectionId), eq(collectorRuns.scope, scope.scope)))
      .orderBy(desc(collectorRuns.seq))
      .limit(1)
      .get() ?? null
  );
}

export function deleteRunsBefore(db: Db, beforeMs: number): number {
  return db.delete(collectorRuns).where(lt(collectorRuns.startedAt, beforeMs)).run().changes;
}

/**
 * The collector lock (§33.4). One instance may hold it; everyone else does nothing and comes back later.
 *
 * Acquisition is a **single conditional update**, and the caller proceeds only if it changed exactly one row.
 * Do not "improve" this into a read followed by a write: two processes reading a free lock both see it free and
 * both write, and the test that starts two claimers against one database is what catches that.
 */
export const COLLECTOR_LOCK_ID = 1;
/** A lock whose holder has not checked in for this long is considered abandoned and may be taken. */
export const LOCK_STALE_MS = 90_000;
/** How often a holder checks in. Three heartbeats fit inside the stale window, so one slow cycle is survivable. */
export const LOCK_HEARTBEAT_MS = 30_000;

/**
 * Takes the lock, or answers false. `owner` is `${process.pid}:${randomId()}`, generated once per process and
 * never derived from anything a user can set.
 */
export function claimCollectorLock(db: Db, owner: string, nowMs: number): boolean {
  // The seed and the claim are one statement: ON CONFLICT makes the first caller on a fresh database take the
  // lock and every later caller fall through to the same conditional update.
  const result = db.run(sql`
    insert into collector_lock (id, owner, heartbeat_at)
    values (${COLLECTOR_LOCK_ID}, ${owner}, ${nowMs})
    on conflict(id) do update set owner = ${owner}, heartbeat_at = ${nowMs}
      where collector_lock.heartbeat_at < ${nowMs - LOCK_STALE_MS} or collector_lock.owner = ${owner}
  `);
  return result.changes === 1;
}

/**
 * Checks in. The `and owner = ?` is what stops a process that lost the lock while paused from resurrecting it:
 * a refresh that changes no row means someone else is collecting, and the cycle in progress must abort.
 */
export function refreshCollectorLock(db: Db, owner: string, nowMs: number): boolean {
  const result = db.run(sql`
    update collector_lock set heartbeat_at = ${nowMs}
    where id = ${COLLECTOR_LOCK_ID} and owner = ${owner}
  `);
  return result.changes === 1;
}

/** Frees the lock by ageing it out rather than deleting the row, and only ever the caller's own. */
export function releaseCollectorLock(db: Db, owner: string): void {
  db.run(sql`update collector_lock set heartbeat_at = 0 where id = ${COLLECTOR_LOCK_ID} and owner = ${owner}`);
}

/** Who holds the lock, for System status. Never used to decide whether to collect — that is the claim's job. */
export function readCollectorLock(db: Db): CollectorLockRow | null {
  return db.select().from(collectorLock).where(eq(collectorLock.id, COLLECTOR_LOCK_ID)).get() ?? null;
}
