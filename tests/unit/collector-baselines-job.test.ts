import { describe, expect, it } from 'vitest';
import { BASELINE_METRICS, BASELINE_WINDOW_DAYS, baselinesOf, bucketize, runBaselinesJob } from '@/lib/collector/baselines-job';
import { MIN_SAMPLES, bucketOf } from '@/lib/detect/baseline';
import { opswatchDbProvider } from '@/lib/history/opswatch-db';
import { writeHistorySettings } from '@/lib/history/settings';
import { listBaselines, readBaseline } from '@/lib/store/baselines';
import { createTestDb } from '../helpers/db';

/**
 * The `baselines` job (§8).
 *
 * It reads only what is already stored, so the expensive question — "what does normal look like?" — is
 * answered without a single AWS request. The rulings are about what it refuses to compute: a bucket with
 * too few observations, and a gap that would otherwise be averaged in as a zero.
 */

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const HOUR = 60 * 60_000;
const WEEK = 7 * 24 * HOUR;
const STEP = 5 * 60_000;
const env = { connectionId: 'c1', scope: 'us-east-1' };
const SUBJECT = 'prod/web';

/** Writes one value at the same hour of the week, `weeks` weeks running. */
async function weekly(db: ReturnType<typeof createTestDb>, values: readonly (number | null)[], metric = 'requests', subjectId = SUBJECT) {
  const base = Math.floor((NOW - 2 * HOUR) / STEP) * STEP;
  await opswatchDbProvider(db).write(
    values.map((value, index) => ({
      category: 'metric' as const,
      subjectId,
      metric,
      ...env,
      intervalStart: base - index * WEEK,
      resolution: '5m' as const,
      value,
      samples: 1,
    })),
    NOW,
  );
}

describe('grouping a series into the week', () => {
  it('THE RULING: an unmeasured interval is left out, never counted as a zero', () => {
    const points = [
      { intervalStart: NOW, value: 100 },
      { intervalStart: NOW + STEP, value: null },
      { intervalStart: NOW + 2 * STEP, value: 120 },
    ];
    // A gap read as zero would drag the median down and then make the next ordinary hour look like a surge.
    expect(bucketize(points).get(bucketOf(NOW))).toEqual([100, 120]);
  });

  it('separates two different hours of the week', () => {
    const buckets = bucketize([
      { intervalStart: NOW, value: 1 },
      { intervalStart: NOW + 3 * HOUR, value: 2 },
    ]);
    expect(buckets.size).toBe(2);
  });

  it('THE RULING: a bucket with too little history gets no baseline at all', () => {
    const thin = Array.from({ length: MIN_SAMPLES - 1 }, (_, i) => ({ intervalStart: NOW + i * STEP, value: 100 + i }));
    expect(baselinesOf(thin).size).toBe(0);

    const enough = Array.from({ length: MIN_SAMPLES }, (_, i) => ({ intervalStart: NOW + i * STEP, value: 100 + i }));
    expect(baselinesOf(enough).size).toBe(1);
  });
});

describe('the job', () => {
  it('THE RULING: with history off it computes nothing, because there are no rollups to compute from', async () => {
    const db = createTestDb();
    await weekly(db, Array.from({ length: 10 }, () => 100));
    // The rollups happen to be there from before; the switch is off now, so the job does no work.
    expect(runBaselinesJob({ db, ...env, nowMs: NOW })).toEqual({ covered: 0, total: 0 });
    expect(listBaselines(db, env, [...BASELINE_METRICS])).toEqual([]);
  });

  it('writes a baseline per bucket once there is enough history', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - 30 * 24 * HOUR);
    // Enough intervals in one hour of the week to clear §8's floor.
    const base = Math.floor((NOW - 2 * HOUR) / STEP) * STEP;
    await opswatchDbProvider(db).write(
      Array.from({ length: MIN_SAMPLES + 2 }, (_, i) => ({
        category: 'metric' as const,
        subjectId: SUBJECT,
        metric: 'requests',
        ...env,
        intervalStart: base + i * STEP,
        resolution: '5m' as const,
        value: 100 + (i % 3),
        samples: 1,
      })),
      NOW,
    );

    expect(runBaselinesJob({ db, ...env, nowMs: NOW })).toMatchObject({ covered: 1, total: 1 });
    const stored = readBaseline(db, { ...env, subjectId: SUBJECT, metric: 'requests' }, bucketOf(base));
    expect(stored).toMatchObject({ median: 101, samples: MIN_SAMPLES + 2 });
  });

  it('THE RULING: a spike in the window does not become the baseline', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - 30 * 24 * HOUR);
    const base = Math.floor((NOW - 2 * HOUR) / STEP) * STEP;
    const values = [...Array.from({ length: MIN_SAMPLES }, () => 100), 50_000, 60_000];
    await opswatchDbProvider(db).write(
      values.map((value, i) => ({
        category: 'metric' as const,
        subjectId: SUBJECT,
        metric: 'requests',
        ...env,
        intervalStart: base + i * STEP,
        resolution: '5m' as const,
        value,
        samples: 1,
      })),
      NOW,
    );

    runBaselinesJob({ db, ...env, nowMs: NOW });
    // A mean would be about 11,000. The baseline has to survive the incident it exists to detect.
    expect(readBaseline(db, { ...env, subjectId: SUBJECT, metric: 'requests' }, bucketOf(base))?.median).toBe(100);
  });

  it('recomputes in place rather than accumulating a row per pass', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - 30 * 24 * HOUR);
    await weekly(db, Array.from({ length: MIN_SAMPLES + 1 }, () => 100));

    runBaselinesJob({ db, ...env, nowMs: NOW });
    const first = listBaselines(db, env, ['requests']).length;
    runBaselinesJob({ db, ...env, nowMs: NOW + HOUR });
    expect(listBaselines(db, env, ['requests'])).toHaveLength(first);
  });

  it('keeps to a declared set of metrics rather than baselining everything stored', () => {
    expect([...BASELINE_METRICS]).toEqual(['requests', 'p95', 'affected']);
  });

  it('looks back four weeks, which is four observations for each hour of the week', () => {
    expect(BASELINE_WINDOW_DAYS).toBe(28);
  });

  it('an environment with no rollups reports it covered nothing, not that it succeeded at one', () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - 30 * 24 * HOUR);
    expect(runBaselinesJob({ db, ...env, nowMs: NOW })).toEqual({ covered: 0, total: 0 });
  });
});
