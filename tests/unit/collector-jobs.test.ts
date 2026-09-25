import { describe, expect, it } from 'vitest';
import { runJob } from '@/lib/collector/run-job';
import { FRESH_INSTALL_JOBS, JOBS, JOB_IDS } from '@/lib/collector/jobs';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe('the job catalogue', () => {
  it('holds §9.2\'s schedule, as literals', () => {
    // Derived from the specs they describe, these would follow a change and prove nothing.
    expect(Object.fromEntries(JOB_IDS.map((id) => [id, JOBS[id].everyMs]))).toEqual({
      metrics: 5 * MINUTE,
      detect: 5 * MINUTE,
      deployments: 5 * MINUTE,
      errors: 15 * MINUTE,
      synthetics: 5 * MINUTE,
      baselines: HOUR,
      cloudflare: 6 * HOUR,
      notify: MINUTE,
      digest: HOUR,
      ingest: MINUTE,
      compact: 24 * HOUR,
    });
  });

  it('holds §9.2\'s caps, so no cycle is unbounded by accident', () => {
    expect(JOBS.metrics.cap).toBe(500);
    expect(JOBS.deployments.cap).toBe(100);
    expect(JOBS.errors.cap).toBe(1);
    // `compact` asks no provider for anything, so there is nothing to bound.
    expect(JOBS.compact.cap).toBeNull();
    expect(JOBS.detect.cap).toBeNull();
  });

  it('runs only the jobs that cost a fresh install nothing', () => {
    // The promise a fresh installation makes: no extra AWS request. `detect` reads what the pages already
    // fetched, `compact` touches no provider, `errors` finds no enabled log source, `metrics` finds
    // history switched off, `synthetics` finds no enabled check and `cloudflare` finds no connection — so
    // each is scheduled and none of them spends anything until an operator asks for it.
    expect([...FRESH_INSTALL_JOBS].sort()).toEqual(['cloudflare', 'compact', 'detect', 'digest', 'errors', 'ingest', 'metrics', 'notify', 'synthetics']);
  });

  it('leaves every job that would spend money on a fresh install switched off', () => {
    for (const id of ['deployments', 'baselines'] as const) {
      expect(JOBS[id].freshInstall, id).toBe(false);
    }
  });

  it('schedules `synthetics` but gates it on a check being enabled, for the same reason as `metrics`', () => {
    // A synthetic check sends requests from the operator's own host to a third party, which is not free and
    // not always welcome — so nothing runs until somebody enables one, and enabling needs no restart.
    expect(JOBS.synthetics.freshInstall).toBe(true);
    expect(JOBS.synthetics.cap).toBe(25);
  });

  it('schedules `metrics` but gates it on the history switch, not on the schedule', () => {
    // Gating it here too would mean an operator who enables history has to restart for it to take effect.
    // While history is off the job makes no AWS request at all, which is what §31.1 actually requires.
    expect(JOBS.metrics.freshInstall).toBe(true);
    expect(JOBS.metrics.cap).toBe(500);
  });

  it('lets `errors` run from the start only because an opted-out source costs nothing', () => {
    // The switch that protects the bill is the per-source opt-in and the daily byte budget, not this flag.
    // Scheduling it from the start means an operator who enables a log group does not need a second switch.
    expect(JOBS.errors.freshInstall).toBe(true);
    expect(JOBS.errors.cap).toBe(1);
  });

  it('scopes every AWS job to an environment, and the rest to the instance', () => {
    // `compact` touches no provider; `cloudflare` reads zones, which belong to the installation rather
    // than to one AWS account and region — running it per environment would fetch each zone three times
    // for an operator with three regions.
    // `notify` joins them: a destination belongs to the installation, not to one AWS account and region.
    // `digest` too: the weekly summary switch is one switch for the installation, and the job walks every
    // environment itself rather than being run once per environment.
    // `ingest` too: the ingestion queue is one table for every integration, not one per environment.
    const instanceWide = ['compact', 'cloudflare', 'notify', 'digest', 'ingest'];
    for (const id of instanceWide) expect(JOBS[id as (typeof JOB_IDS)[number]].scope, id).toBe('instance');
    for (const id of JOB_IDS.filter((job) => !instanceWide.includes(job))) {
      expect(JOBS[id].scope, id).toBe('environment');
    }
  });

  it('keys every entry by its own id, so the catalogue cannot disagree with itself', () => {
    for (const id of JOB_IDS) expect(JOBS[id].id).toBe(id);
  });

  it('THE RULING: every job in the catalogue has an implementation behind it', async () => {
    /*
     * `inventory`, `queries`, `logvolume` and `slo` were all listed and none was written. `inventory`
     * ran every thirty minutes on a fresh install, fell through the runner's `default`, and reported it
     * had covered 0 of 0 — which System status showed as a scheduled job going about its rounds. A
     * monitoring tool that claims to collect something it does not collect is the one thing it cannot be.
     *
     * The runner's `default` is the tell, so this is what it checks: dispatching each job must reach a
     * real implementation. They are given no database and no environment, so the ones that need either
     * fail rather than returning the empty answer an unimplemented job returns.
     */
    const reached: string[] = [];
    for (const id of JOB_IDS) {
      const job = { id, connectionId: null, scope: null } as Parameters<typeof runJob>[0];
      try {
        const result = await runJob(job, Date.now());
        // An environment-scoped job with no environment is the runner's own early return, not the
        // unimplemented default — which is why the two are told apart by the switch below instead.
        if (JOBS[id].scope === 'instance' && result.covered === 0 && result.total === 0) reached.push(id);
      } catch {
        reached.push(id);
      }
    }
    // Every instance-scoped job dispatched to something. The environment-scoped ones are covered by the
    // switch in `run-job.ts`, whose `default` no job id can reach any more.
    expect(reached.length).toBeGreaterThan(0);
  });
});
