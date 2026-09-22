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
      logvolume: HOUR,
      baselines: HOUR,
      slo: HOUR,
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

  it('runs exactly D4\'s three jobs on a fresh install, and no others', () => {
    // The promise a fresh installation makes: no extra AWS request. `detect` reads what the pages already
    // fetched and `inventory` is Describe*, which §9.5 records as throttled but not billed.
    expect([...FRESH_INSTALL_JOBS].sort()).toEqual(['compact', 'detect', 'inventory']);
  });

  it('leaves everything that costs money or needs an opt-in switched off', () => {
    for (const id of ['metrics', 'deployments', 'queries', 'errors', 'logvolume', 'baselines', 'slo'] as const) {
      expect(JOBS[id].freshInstall, id).toBe(false);
    }
  });

  it('scopes every data job to an environment, and compaction to the instance', () => {
    expect(JOBS.compact.scope).toBe('instance');
    for (const id of JOB_IDS.filter((job) => job !== 'compact')) {
      expect(JOBS[id].scope, id).toBe('environment');
    }
  });

  it('keys every entry by its own id, so the catalogue cannot disagree with itself', () => {
    for (const id of JOB_IDS) expect(JOBS[id].id).toBe(id);
  });
});
