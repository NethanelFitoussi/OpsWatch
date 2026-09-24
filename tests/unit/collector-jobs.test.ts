import { describe, expect, it } from 'vitest';
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
      inventory: 30 * MINUTE,
      queries: 30 * MINUTE,
      errors: 15 * MINUTE,
      synthetics: 5 * MINUTE,
      logvolume: HOUR,
      baselines: HOUR,
      slo: HOUR,
      cloudflare: 6 * HOUR,
      notify: MINUTE,
      digest: HOUR,
      compact: 24 * HOUR,
    });
  });

  it('holds §9.2\'s caps, so no cycle is unbounded by accident', () => {
    expect(JOBS.metrics.cap).toBe(500);
    expect(JOBS.inventory.cap).toBe(60);
    expect(JOBS.errors.cap).toBe(1);
    // `compact` asks no provider for anything, so there is nothing to bound.
    expect(JOBS.compact.cap).toBeNull();
    expect(JOBS.detect.cap).toBeNull();
  });

  it('runs only the jobs that cost a fresh install nothing', () => {
    // The promise a fresh installation makes: no extra AWS request. `detect` reads what the pages already
    // fetched, `inventory` is Describe* (throttled but not billed, §9.5), `compact` touches no provider,
    // `errors` finds no enabled log source, `metrics` finds history switched off, `synthetics` finds no
    // enabled check and `cloudflare` finds no connection - so each is scheduled and none of them spends
    // anything until an operator asks for it.
    expect([...FRESH_INSTALL_JOBS].sort()).toEqual(['cloudflare', 'compact', 'detect', 'digest', 'errors', 'inventory', 'metrics', 'notify', 'synthetics']);
  });

  it('leaves every job that would spend money on a fresh install switched off', () => {
    for (const id of ['deployments', 'queries', 'logvolume', 'baselines', 'slo'] as const) {
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
    const instanceWide = ['compact', 'cloudflare', 'notify', 'digest'];
    for (const id of instanceWide) expect(JOBS[id as (typeof JOB_IDS)[number]].scope, id).toBe('instance');
    for (const id of JOB_IDS.filter((job) => !instanceWide.includes(job))) {
      expect(JOBS[id].scope, id).toBe('environment');
    }
  });

  it('keys every entry by its own id, so the catalogue cannot disagree with itself', () => {
    for (const id of JOB_IDS) expect(JOBS[id].id).toBe(id);
  });
});
