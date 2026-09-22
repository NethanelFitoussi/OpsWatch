import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/client';
import { appliedMigrations } from '../store/meta';
import { JOBS, type JobId } from '../collector/jobs';
import { readCollectorLock, lastRuns } from '../store/collector';
import { listFamilySnapshots } from '../store/health';
import { version } from '../../../package.json';
import type { EnvironmentStatus, JobStatus, SystemStatus } from '@opswatch/contract';

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

function jobStatus(job: JobId, runs: ReturnType<typeof lastRuns>): JobStatus {
  const spec = JOBS[job];
  const last = runs.find((run) => run.job === job);
  const base = { job, everyMs: spec.everyMs };
  if (!last) {
    return { ...base, lastRunAt: null, lastStatus: null, durationMs: null, covered: null, total: null, truncated: false, errorCode: null, nextRunAt: null };
  }
  return {
    ...base,
    lastRunAt: last.startedAt,
    lastStatus: last.status,
    // Null rather than 0 for a run that never finished: it is unknown, not instant.
    durationMs: last.finishedAt === null ? null : last.finishedAt - last.startedAt,
    covered: last.covered,
    total: last.total,
    truncated: last.truncated,
    errorCode: last.errorCode,
    nextRunAt: last.startedAt + spec.everyMs,
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
    jobs: Object.keys(JOBS).map((job) => jobStatus(job as JobId, runs)),
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

