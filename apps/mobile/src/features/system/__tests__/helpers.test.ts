/**
 * The verdict is the whole point of this screen, and the three states it keeps apart are the ones a monitoring tool
 * must never conflate: never collected, stopped, and collecting. Getting that ordering wrong makes OpsWatch report
 * "healthy" about an estate it has not looked at.
 */
import type { JobStatus, SystemStatus } from '@/api/contract';
import { collectorVerdict, environmentCoverage, failingJobs, HEARTBEAT_STALE_MS, isPartial, jobState, sortJobs } from '../helpers';

const NOW = 1_800_000_000_000;

const job = (over: Partial<JobStatus> & { job: string }): JobStatus => ({
  everyMs: 60_000,
  lastRunAt: NOW - 30_000,
  lastStatus: 'ok',
  durationMs: 500,
  covered: null,
  total: null,
  truncated: false,
  errorCode: null,
  nextRunAt: NOW + 30_000,
  ...over,
});

const status = (over: Partial<SystemStatus> = {}): SystemStatus => ({
  version: '1.0.0',
  generatedAt: NOW,
  collector: { owner: 'host-1', heartbeatAt: NOW - 10_000, alive: true, neverRan: false },
  jobs: [job({ job: 'inventory' })],
  environments: [],
  database: { sizeBytes: 1_000, schemaVersion: 6 },
  ...over,
});

describe('collectorVerdict', () => {
  it('says data is current when the collector is alive and its jobs are passing', () => {
    expect(collectorVerdict(status(), NOW).verdict).toBe('collecting');
  });

  /** A failing job never outranks "nothing has ever run": the failure is irrelevant if nothing collected. */
  it('reports never-collected above everything else', () => {
    const never = status({
      collector: { owner: null, heartbeatAt: null, alive: false, neverRan: true },
      jobs: [job({ job: 'inventory', lastStatus: 'failed' })],
    });
    expect(collectorVerdict(never, NOW).verdict).toBe('never');
  });

  it('reports a stopped collector above a failing job', () => {
    const stopped = status({
      collector: { owner: 'host-1', heartbeatAt: NOW - 60_000, alive: false, neverRan: false },
      jobs: [job({ job: 'inventory', lastStatus: 'failed' })],
    });
    expect(collectorVerdict(stopped, NOW).verdict).toBe('stopped');
  });

  /**
   * `alive` is the collector's own claim, and a process that died between heartbeats still claims it. An old
   * heartbeat therefore wins: the app would rather say "may have stopped" than vouch for data that is not arriving.
   */
  it('distrusts a live claim with an old heartbeat', () => {
    const stale = status({ collector: { owner: 'host-1', heartbeatAt: NOW - HEARTBEAT_STALE_MS - 1, alive: true, neverRan: false } });
    expect(collectorVerdict(stale, NOW).verdict).toBe('stale');

    const justInTime = status({ collector: { owner: 'host-1', heartbeatAt: NOW - HEARTBEAT_STALE_MS + 1, alive: true, neverRan: false } });
    expect(collectorVerdict(justInTime, NOW).verdict).toBe('collecting');
  });

  it('treats a missing heartbeat from a live collector as stale, not as healthy', () => {
    const noBeat = status({ collector: { owner: 'host-1', heartbeatAt: null, alive: true, neverRan: false } });
    expect(collectorVerdict(noBeat, NOW).verdict).toBe('stale');
  });

  it('flags failures while still saying the rest is current', () => {
    const failing = status({ jobs: [job({ job: 'inventory' }), job({ job: 'errors', lastStatus: 'failed' })] });
    const verdict = collectorVerdict(failing, NOW);
    expect(verdict.verdict).toBe('failing');
    expect(verdict.tone).toBe('warning');
  });

  /** Every verdict carries what it means for the other screens; a state without one would be unactionable. */
  it('always explains what the verdict means for the rest of the app', () => {
    for (const s of [status(), status({ collector: { owner: null, heartbeatAt: null, alive: false, neverRan: true } })]) {
      expect(collectorVerdict(s, NOW).consequence).toMatch(/^system\.consequence\./);
    }
  });
});

describe('jobs', () => {
  it('calls a job that has never run unproven, not failed', () => {
    expect(jobState(job({ job: 'compaction', lastStatus: null, lastRunAt: null }))).toBe('never');
    expect(failingJobs([job({ job: 'compaction', lastStatus: null, lastRunAt: null })])).toEqual([]);
  });

  it('puts failures first, then what has never run', () => {
    const jobs = [
      job({ job: 'ok-one' }),
      job({ job: 'never-run', lastStatus: null, lastRunAt: null }),
      job({ job: 'broken', lastStatus: 'failed' }),
      job({ job: 'ok-two' }),
    ];
    expect(sortJobs(jobs).map((j) => j.job)).toEqual(['broken', 'never-run', 'ok-one', 'ok-two']);
  });

  it('calls a run partial when it was truncated or covered less than it should have', () => {
    expect(isPartial(job({ job: 'a', truncated: true }))).toBe(true);
    expect(isPartial(job({ job: 'a', covered: 3, total: 7 }))).toBe(true);
    expect(isPartial(job({ job: 'a', covered: 7, total: 7 }))).toBe(false);
    // Counts the server did not report are not a claim that nothing was covered.
    expect(isPartial(job({ job: 'a', covered: null, total: null }))).toBe(false);
  });
});

describe('environmentCoverage', () => {
  it('treats nothing to read as complete rather than dividing by zero', () => {
    expect(environmentCoverage(0, 0)).toEqual({ complete: true, fraction: null });
  });

  it('reports a partial read', () => {
    expect(environmentCoverage(4, 6)).toEqual({ complete: false, fraction: 4 / 6 });
    expect(environmentCoverage(6, 6).complete).toBe(true);
  });
});
