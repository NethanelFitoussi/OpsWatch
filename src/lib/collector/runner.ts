import 'server-only';
import { randomId } from '../crypto';
import type { Db } from '../db/client';
import {
  LOCK_HEARTBEAT_MS,
  claimCollectorLock,
  finishRun,
  refreshCollectorLock,
  releaseCollectorLock,
  startRun,
} from '../store/collector';
import { JOBS, type JobId } from './jobs';

/**
 * The collector runtime (§9.2). One process collects; the rest do nothing and come back later.
 *
 * The decision — which jobs are due, for which environments — is the pure function below, tested with
 * literals. What surrounds it is a thin loop: claim the lock, ask, run what came back, record each run.
 * Nothing schedules itself at import time, because that cannot be tested and cannot be stopped.
 */

/** How often the loop wakes. Well inside the heartbeat, so a tick never risks the lock going stale. */
export const COLLECTOR_TICK_MS = 15_000;

export type Environment = { connectionId: string; scope: string };

/** A job to run now, and what it is scoped to. `null` for an instance-wide job such as `compact`. */
export type DueJob = { id: JobId; connectionId: string | null; scope: string | null };

/** The key a job's last run is remembered under. An environment job is remembered per environment. */
export function jobKey(job: DueJob): string {
  return job.connectionId === null ? job.id : `${job.id}\u0000${job.connectionId}\u0000${job.scope}`;
}

/**
 * Whether this process should collect at all (§9.2's off switch).
 *
 * `OPSWATCH_COLLECTOR=off` disables it outright. `OPSWATCH_ROLE=collector` is a second container from the
 * same image that runs the collector alone, and `OPSWATCH_ROLE=web` is its counterpart that serves pages and
 * does not collect. Neither variable set means the application process collects, which is the single
 * container an ordinary self-hosted install runs.
 */
export function collectorEnabled(source: Record<string, string | undefined>): boolean {
  if (source.OPSWATCH_COLLECTOR?.toLowerCase() === 'off') return false;
  const role = source.OPSWATCH_ROLE?.toLowerCase();
  return role !== 'web';
}

/** §33.4: never derived from anything a user can set. */
export function collectorOwner(): string {
  return `${process.pid}:${randomId()}`;
}

export type DueInput = {
  nowMs: number;
  environments: readonly Environment[];
  /** When each job key last *started*. A key that is absent has never run. */
  lastRunAt: ReadonlyMap<string, number>;
  /** Which jobs this instance runs at all — `FRESH_INSTALL_JOBS`, plus whatever the operator enabled. */
  enabled: readonly JobId[];
};

/**
 * Which jobs are due. Pure: it reads the clock it is given and nothing else.
 *
 * A job is due when it has never run, or when its interval has elapsed since it last started. Timing from the
 * start rather than the finish keeps the cadence honest — a job that takes four minutes does not then wait a
 * further five.
 */
export function dueJobs(input: DueInput): DueJob[] {
  const due: DueJob[] = [];
  for (const id of input.enabled) {
    const spec = JOBS[id];
    const targets: DueJob[] =
      spec.scope === 'instance'
        ? [{ id, connectionId: null, scope: null }]
        : input.environments.map((environment) => ({ id, connectionId: environment.connectionId, scope: environment.scope }));
    for (const job of targets) {
      const last = input.lastRunAt.get(jobKey(job));
      if (last === undefined || input.nowMs - last >= spec.everyMs) due.push(job);
    }
  }
  return due;
}

/** What a job actually did, so `collector_runs` can record it without the runner knowing the job's business. */
export type JobOutcome = { covered?: number | null; total?: number | null; truncated?: boolean };
export type JobRun = (job: DueJob, nowMs: number) => Promise<JobOutcome>;

export type CollectorDeps = {
  db: Db;
  owner: string;
  now: () => number;
  /** Every environment the collector serves, re-read each tick so a new connection is picked up. */
  environments: () => readonly Environment[];
  enabled: () => readonly JobId[];
  run: JobRun;
  /** Injected so tests drive the clock rather than wait for it. */
  setInterval: (fn: () => void, ms: number) => { unref?: () => void };
  clearInterval: (handle: { unref?: () => void }) => void;
  log?: (line: string) => void;
};

export type Collector = { stop: () => Promise<void>; tick: () => Promise<void> };

/**
 * Starts the loop. Answers a handle whose `tick` is the whole cycle, exposed so a test can run one
 * deterministically instead of waiting on a timer.
 */
export function startCollector(deps: CollectorDeps): Collector {
  const lastRunAt = new Map<string, number>();
  let running = false;
  let stopped = false;

  async function tick(): Promise<void> {
    // One cycle at a time. A slow cycle must not have a second one start underneath it.
    if (running || stopped) return;
    running = true;
    try {
      const nowMs = deps.now();
      if (!claimCollectorLock(deps.db, deps.owner, nowMs)) return;
      const jobs = dueJobs({ nowMs, environments: deps.environments(), lastRunAt, enabled: deps.enabled() });
      for (const job of jobs) {
        // §33.4: a refresh that changes no row means this process lost the lock while it was busy, and
        // continuing would mean two collectors writing at once. The cycle stops where it is.
        if (!refreshCollectorLock(deps.db, deps.owner, deps.now())) return;
        await runOne(job);
      }
    } finally {
      running = false;
    }
  }

  async function runOne(job: DueJob): Promise<void> {
    const startedAt = deps.now();
    // Remembered by start, so a job that fails or hangs does not re-run every single tick.
    lastRunAt.set(jobKey(job), startedAt);
    const row = startRun(deps.db, { job: job.id, connectionId: job.connectionId, scope: job.scope, startedAt });
    try {
      const outcome = await deps.run(job, startedAt);
      finishRun(deps.db, row.id, {
        finishedAt: deps.now(),
        status: 'ok',
        covered: outcome.covered ?? null,
        total: outcome.total ?? null,
        truncated: outcome.truncated ?? false,
      });
    } catch (error) {
      // One broken job must not stop the other nine, the same rule the detector framework has.
      const code = error instanceof Error ? error.name : 'Error';
      finishRun(deps.db, row.id, { finishedAt: deps.now(), status: 'failed', errorCode: code });
      // The job and a code, and nothing else: never a credential, a resource name or a query (§12.6).
      deps.log?.(JSON.stringify({ event: 'collector_job_failed', job: job.id, code }));
    }
  }

  const handle = deps.setInterval(() => void tick(), COLLECTOR_TICK_MS);
  // The loop must never hold the process open by itself.
  handle.unref?.();

  return {
    tick,
    stop: async () => {
      stopped = true;
      deps.clearInterval(handle);
      // Hand the lock on rather than making the next process wait out the stale window.
      releaseCollectorLock(deps.db, deps.owner);
    },
  };
}

/** Exported for the test that pins the tick inside the heartbeat window. */
export const HEARTBEAT_MS = LOCK_HEARTBEAT_MS;
