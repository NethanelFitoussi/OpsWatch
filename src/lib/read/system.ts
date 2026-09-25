import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/client';
import { appliedMigrations } from '../store/meta';
import { JOBS, type JobId } from '../collector/jobs';
import { latestRunPerEnvironment, readCollectorLock, lastRuns } from '../store/collector';
import { listFamilySnapshots } from '../store/health';
import { version } from '../../../package.json';
import type { JobStatus, SystemStatus } from '@opswatch/contract';

/**
 * What OpsWatch knows about itself (§21, and the mission's Phase T).
 *
 * The point of this page is the one distinction a monitoring tool must never blur: **"production is healthy"
 * and "OpsWatch cannot determine production health" are different answers.** If the collector has not run,
 * every other page is reporting on stale knowledge, and this is where that is visible.
 *
 * It reads the database and nothing else — no AWS call — because the page that tells you monitoring is broken
 * must not depend on the thing that is broken.
 */

/**
 * The shapes come from the canonical contract, not from here: the page, `/api/v1/system/status` and any
 * client all read one definition, so none of them can drift from another.
 */
export type { SystemStatus };

/** A lock whose heartbeat is older than this is not being held by a live process. */
const LOCK_ALIVE_MS = 90_000;

/** Worst first: a job failing anywhere is failing, whatever it did somewhere else. */
const STATUS_RANK = { failed: 0, running: 1, skipped: 2, ok: 3 } as const;

function jobStatus(db: Db, job: JobId, environments: readonly { connectionId: string; scope: string }[]): JobStatus {
  const spec = JOBS[job];
  const base = { job, everyMs: spec.everyMs };
  const empty = {
    ...base,
    lastRunAt: null,
    lastStatus: null,
    durationMs: null,
    covered: null,
    total: null,
    truncated: false,
    errorCode: null,
    nextRunAt: null,
  };

  /*
   * An instance-scoped job has one run to report. An environment-scoped one has as many as there are
   * environments, and the page used to print whichever came back first — so a job failing in one AWS
   * account could be reported as `ok` because another account had just succeeded.
   *
   * The answer is the **worst** of them, with the counts beside it so the single word is not the whole
   * claim, and `coveredEverywhereSince` for "every environment has been visited at least this recently".
   */
  const runs = latestRunPerEnvironment(db, job);
  if (runs.length === 0) return empty;

  const worst = [...runs].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status])[0];
  const newest = runs.reduce((a, b) => (a.startedAt >= b.startedAt ? a : b));
  const oldest = runs.reduce((a, b) => (a.startedAt <= b.startedAt ? a : b));

  const scoped = spec.scope === 'environment';
  const neverRan = scoped ? Math.max(0, environments.length - runs.length) : 0;

  return {
    ...base,
    lastRunAt: newest.startedAt,
    // The worst outcome, never the most recent one.
    lastStatus: worst.status,
    // Null rather than 0 for a run that never finished: it is unknown, not instant.
    durationMs: worst.finishedAt === null ? null : worst.finishedAt - worst.startedAt,
    covered: worst.covered,
    total: worst.total,
    truncated: runs.some((run) => run.truncated),
    errorCode: worst.errorCode,
    nextRunAt: newest.startedAt + spec.everyMs,
    ...(scoped
      ? {
          environments: {
            total: Math.max(environments.length, runs.length),
            failing: runs.filter((run) => run.status === 'failed').length,
            neverRan,
          },
          // No such instant while an environment has never been visited at all.
          coveredEverywhereSince: neverRan > 0 ? null : oldest.startedAt,
        }
      : {}),
  };
}

export function readSystemStatus(
  db: Db,
  input: { nowMs: number; environments: readonly { connectionId: string; scope: string }[]; dataDir?: string },
): SystemStatus {
  const runs = lastRuns(db, 500);
  const lock = readCollectorLock(db);

  return {
    version,
    generatedAt: input.nowMs,
    collector: {
      owner: lock?.owner ?? null,
      heartbeatAt: lock?.heartbeatAt ?? null,
      alive: lock !== null && input.nowMs - lock.heartbeatAt < LOCK_ALIVE_MS,
      // The state worth shouting about: nothing has ever collected, so every other page knows nothing.
      neverRan: runs.length === 0,
    },
    jobs: Object.keys(JOBS).map((job) => jobStatus(db, job as JobId, input.environments)),
    environments: input.environments.map((environment) => {
      const snapshots = listFamilySnapshots(db, environment.connectionId, environment.scope);
      return {
        ...environment,
        lastReadAt: snapshots.length === 0 ? null : Math.max(...snapshots.map((row) => row.readAt)),
        familiesRead: snapshots.filter((row) => row.unavailableReason === null).length,
        familiesTotal: snapshots.length,
      };
    }),
    database: {
      sizeBytes: databaseSize(input.dataDir),
      schemaVersion: appliedMigrations(db),
    },
  };
}

/** How large the database has grown. Null when it cannot be measured — never a guess. */
function databaseSize(dataDir: string | undefined): number | null {
  if (dataDir === undefined) return null;
  try {
    return fs.statSync(path.join(dataDir, 'opswatch.sqlite')).size;
  } catch {
    return null;
  }
}

