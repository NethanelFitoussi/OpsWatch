import { describe, expect, it, vi } from 'vitest';
import {
  COLLECTOR_TICK_MS,
  HEARTBEAT_MS,
  collectorEnabled,
  collectorOwner,
  dueJobs,
  jobKey,
  startCollector,
  type CollectorDeps,
  type DueJob,
  type Environment,
  type JobOutcome,
} from '@/lib/collector/runner';
import { FRESH_INSTALL_JOBS, JOBS } from '@/lib/collector/jobs';
import { claimCollectorLock, lastRuns, readCollectorLock } from '@/lib/store/collector';
import { createTestDb } from '../helpers/db';

const NOW = Date.UTC(2026, 8, 22, 9, 0, 0);
const ENVIRONMENTS: Environment[] = [
  { connectionId: 'c1', scope: 'us-east-1' },
  { connectionId: 'c1', scope: 'eu-west-1' },
];

describe('the off switch and the roles (§9.2)', () => {
  it('collects in an ordinary single-container install, where neither variable is set', () => {
    expect(collectorEnabled({})).toBe(true);
  });

  it('does not collect when OPSWATCH_COLLECTOR is off, however it is capitalised', () => {
    expect(collectorEnabled({ OPSWATCH_COLLECTOR: 'off' })).toBe(false);
    expect(collectorEnabled({ OPSWATCH_COLLECTOR: 'OFF' })).toBe(false);
  });

  it('lets a second container collect alone while the web one does not', () => {
    expect(collectorEnabled({ OPSWATCH_ROLE: 'collector' })).toBe(true);
    expect(collectorEnabled({ OPSWATCH_ROLE: 'web' })).toBe(false);
  });

  it('lets the off switch win over the role, so one variable always stops it', () => {
    expect(collectorEnabled({ OPSWATCH_ROLE: 'collector', OPSWATCH_COLLECTOR: 'off' })).toBe(false);
  });

  it('owns the lock under a value nothing outside the process can set (§33.4)', () => {
    const owner = collectorOwner();
    expect(owner.startsWith(`${process.pid}:`)).toBe(true);
    expect(owner).not.toBe(collectorOwner());
  });

  it('wakes well inside the heartbeat, so a tick never lets the lock go stale', () => {
    expect(COLLECTOR_TICK_MS).toBeLessThan(HEARTBEAT_MS);
  });
});

describe('deciding what is due', () => {
  const due = (over: Partial<Parameters<typeof dueJobs>[0]> = {}) =>
    dueJobs({ nowMs: NOW, environments: ENVIRONMENTS, lastRunAt: new Map(), enabled: FRESH_INSTALL_JOBS, ...over });

  it('runs everything that has never run', () => {
    // Two environments × two environment jobs, plus the one instance job.
    expect(due()).toHaveLength(ENVIRONMENTS.length * 2 + 1);
  });

  it('fans an environment job out per environment, and an instance job out once', () => {
    const jobs = due();
    expect(jobs.filter((job) => job.id === 'detect').map((job) => job.scope)).toEqual(['us-east-1', 'eu-west-1']);
    expect(jobs.filter((job) => job.id === 'compact')).toEqual([{ id: 'compact', connectionId: null, scope: null }]);
  });

  it('does not run a job again before its interval has elapsed', () => {
    const detect: DueJob = { id: 'detect', connectionId: 'c1', scope: 'us-east-1' };
    const lastRunAt = new Map([[jobKey(detect), NOW - JOBS.detect.everyMs + 1]]);
    expect(due({ lastRunAt }).some((job) => jobKey(job) === jobKey(detect))).toBe(false);
  });

  it('runs it again the moment the interval has elapsed', () => {
    const detect: DueJob = { id: 'detect', connectionId: 'c1', scope: 'us-east-1' };
    const lastRunAt = new Map([[jobKey(detect), NOW - JOBS.detect.everyMs]]);
    expect(due({ lastRunAt }).some((job) => jobKey(job) === jobKey(detect))).toBe(true);
  });

  it('remembers each environment separately, so one region does not hide another', () => {
    const lastRunAt = new Map([[jobKey({ id: 'detect', connectionId: 'c1', scope: 'us-east-1' }), NOW]]);
    const detects = due({ lastRunAt }).filter((job) => job.id === 'detect');
    expect(detects.map((job) => job.scope)).toEqual(['eu-west-1']);
  });

  it('runs nothing at all when nothing is enabled', () => {
    expect(due({ enabled: [] })).toEqual([]);
  });

  it('runs nothing for an instance with no environments, except the instance-wide job', () => {
    expect(due({ environments: [] })).toEqual([{ id: 'compact', connectionId: null, scope: null }]);
  });

  it('is pure: the same input twice decides the same thing', () => {
    expect(due()).toEqual(due());
  });
});

/** A collector wired to a real database and a fake clock and timer, so a tick is deterministic. */
function harness(over: Partial<CollectorDeps> = {}) {
  const db = createTestDb();
  const ran: DueJob[] = [];
  let clock = NOW;
  const deps: CollectorDeps = {
    db,
    owner: 'owner-a',
    now: () => clock,
    environments: () => [ENVIRONMENTS[0]],
    enabled: () => ['detect'],
    run: async (job) => {
      ran.push(job);
      return { covered: 1, total: 1 };
    },
    setInterval: () => ({ unref: () => undefined }),
    clearInterval: () => undefined,
    log: vi.fn(),
    ...over,
  };
  return { db, deps, ran, advance: (ms: number) => (clock += ms), collector: startCollector(deps) };
}

describe('the cycle', () => {
  it('claims the lock and runs what is due', async () => {
    const h = harness();
    await h.collector.tick();
    expect(h.ran).toEqual([{ id: 'detect', connectionId: 'c1', scope: 'us-east-1' }]);
    expect(readCollectorLock(h.db)?.owner).toBe('owner-a');
  });

  it('runs nothing at all when another process holds the lock', async () => {
    const h = harness();
    claimCollectorLock(h.db, 'someone-else', NOW);
    await h.collector.tick();
    expect(h.ran).toEqual([]);
    expect(lastRuns(h.db, 10)).toEqual([]);
  });

  it('does not run a job twice before its interval, across ticks', async () => {
    const h = harness();
    await h.collector.tick();
    h.advance(JOBS.detect.everyMs - 1);
    await h.collector.tick();
    expect(h.ran).toHaveLength(1);
    h.advance(1);
    await h.collector.tick();
    expect(h.ran).toHaveLength(2);
  });

  it('carries what a capped job covered, so a partial answer is never shown as a complete one', async () => {
    // §9.2: "a job that hits its cap records 'covered N of M' exactly as the Stage 3 reports do".
    const capped: JobOutcome = { covered: 40, total: 60, truncated: true };
    const h = harness({ run: async () => capped });
    await h.collector.tick();
    const [run] = lastRuns(h.db, 10);
    expect({ covered: run.covered, total: run.total, truncated: run.truncated }).toEqual(capped);
  });

  it('records every run, so System status can tell a failure from a job that never ran', async () => {
    const h = harness();
    await h.collector.tick();
    const [run] = lastRuns(h.db, 10);
    expect({ job: run.job, status: run.status, covered: run.covered, scope: run.scope }).toEqual({
      job: 'detect',
      status: 'ok',
      covered: 1,
      scope: 'us-east-1',
    });
  });

  it('records a job that threw, and still runs the next one', async () => {
    const log = vi.fn();
    const h = harness({
      enabled: () => ['detect', 'inventory'],
      run: async (job) => {
        if (job.id === 'detect') throw new TypeError('the rule is broken');
        return {};
      },
      log,
    });
    await h.collector.tick();
    const runs = lastRuns(h.db, 10);
    expect(runs.map((run) => [run.job, run.status]).sort()).toEqual([
      ['detect', 'failed'],
      ['inventory', 'ok'],
    ]);
    expect(runs.find((run) => run.job === 'detect')?.errorCode).toBe('TypeError');
  });

  it('logs one line for a failure, naming the job and a code and nothing else', async () => {
    const log = vi.fn();
    const h = harness({
      run: async () => {
        throw new Error('connect ECONNREFUSED 10.0.0.5:443 using AKIAEXAMPLE');
      },
      log,
    });
    await h.collector.tick();
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0][0]);
    expect(JSON.parse(line)).toEqual({ event: 'collector_job_failed', job: 'detect', code: 'Error' });
    for (const secret of ['AKIA', '10.0.0.5', 'ECONNREFUSED']) expect(line).not.toContain(secret);
  });

  it('aborts the cycle when the lock was lost while it was busy (§33.4)', async () => {
    const h = harness({ enabled: () => ['detect', 'inventory'] });
    // Between the claim and the second job, another process takes the lock: the refresh changes no row.
    const original = h.deps.run;
    h.deps.run = async (job, at) => {
      claimCollectorLock(h.db, 'someone-else', NOW + 10 * 60_000);
      return original(job, at);
    };
    await h.collector.tick();
    // The first job ran; the second must not, because continuing would mean two collectors writing.
    expect(h.ran).toHaveLength(1);
  });

  it('does not start a second cycle underneath a slow one', async () => {
    let release: (() => void) | undefined;
    const started: string[] = [];
    const h = harness({
      run: async (job) => {
        started.push(job.id);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return {};
      },
    });
    const first = h.collector.tick();
    await h.collector.tick();
    // The second tick returned immediately rather than starting the job again: a slow cycle must not have
    // another begin underneath it, because better-sqlite3 is synchronous and they would contend.
    expect(started).toEqual(['detect']);
    release?.();
    await first;
    expect(started).toEqual(['detect']);
  });

  it('stops, and hands the lock on rather than making the next process wait it out', async () => {
    const h = harness();
    await h.collector.tick();
    await h.collector.stop();
    expect(readCollectorLock(h.db)?.heartbeatAt).toBe(0);
    await h.collector.tick();
    expect(h.ran).toHaveLength(1);
  });
});
