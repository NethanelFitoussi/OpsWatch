import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../helpers/db';

/**
 * The `metrics` job sits **behind the history switch** (§31.1).
 *
 * The ruling being tested is the expensive one: on a fresh installation the job must make **no AWS request
 * at all**. Reading and then discarding would satisfy a test that only checked what was stored, and would
 * still put the cost on the owner's bill — so these tests watch the AWS-facing calls themselves.
 */

const resolveTarget = vi.fn();
const loadFamily = vi.fn();

vi.mock('@/lib/monitoring/target', () => ({ resolveTarget: (...args: unknown[]) => resolveTarget(...args) }));
vi.mock('@/lib/monitoring/overview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/monitoring/overview')>()),
  loadFamily: (...args: unknown[]) => loadFamily(...args),
}));

const { METRICS_RESOLUTION, runMetricsJob } = await import('@/lib/collector/metrics-job');
const { writeHistorySettings } = await import('@/lib/history/settings');
const { opswatchDbProvider } = await import('@/lib/history/opswatch-db');
const { RESOLUTION_MS } = await import('@/lib/history/provider');

const NOW = Date.UTC(2026, 8, 22, 12, 3, 17);
const env = { connectionId: 'c1', scope: 'us-east-1' };
const FAMILIES = ['ecs', 'rds', 'alb', 'alarms'] as const;

/** One series, read the way a detector would: the store keys history by `(subject, metric)`, not by family alone. */
const readSeries = (db: Parameters<typeof opswatchDbProvider>[0], subjectId: string, metric: string) =>
  opswatchDbProvider(db).read({
    category: 'metric',
    subjectId,
    metric,
    ...env,
    resolution: METRICS_RESOLUTION,
    from: NOW - RESOLUTION_MS[METRICS_RESOLUTION] * 4,
    to: NOW,
  });

/** Every point the job could have written this cycle, across all four families and both metrics. */
async function allPoints(db: Parameters<typeof opswatchDbProvider>[0]) {
  const reads = await Promise.all(
    FAMILIES.flatMap((family) => ['affected', 'total'].map((metric) => readSeries(db, family, metric))),
  );
  return reads.flatMap((result) => result.points);
}

beforeEach(() => {
  resolveTarget.mockReset();
  loadFamily.mockReset();
  resolveTarget.mockResolvedValue({ ok: true, data: { ...env, region: env.scope, credentials: {} } });
  loadFamily.mockResolvedValue({ ok: true, data: { total: 10, affected: 2 } });
});

describe('§31.1 — history is off until someone turns it on', () => {
  it('THE RULING: a fresh installation makes no AWS request whatsoever', async () => {
    const db = createTestDb();
    const outcome = await runMetricsJob({ db, ...env, nowMs: NOW });

    expect(resolveTarget).not.toHaveBeenCalled();
    expect(loadFamily).not.toHaveBeenCalled();
    expect(outcome).toEqual({ covered: 0, total: 0 });
  });

  it('and writes nothing, so a disabled installation accumulates no history', async () => {
    const db = createTestDb();
    await runMetricsJob({ db, ...env, nowMs: NOW });
    const points = await allPoints(db);
    expect(points).toEqual([]);
  });

  it('turning it off again stops the requests, rather than only hiding the results', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW);
    await runMetricsJob({ db, ...env, nowMs: NOW });
    expect(loadFamily).toHaveBeenCalled();

    loadFamily.mockClear();
    resolveTarget.mockClear();
    writeHistorySettings(db, { enabled: false }, NOW);
    await runMetricsJob({ db, ...env, nowMs: NOW + RESOLUTION_MS[METRICS_RESOLUTION] });
    expect(resolveTarget).not.toHaveBeenCalled();
    expect(loadFamily).not.toHaveBeenCalled();
  });
});

describe('once enabled', () => {
  it('reads every family and stores what each one measured', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW);
    const outcome = await runMetricsJob({ db, ...env, nowMs: NOW });

    expect(outcome.covered).toBe(4);
    expect(outcome.total).toBe(4);
    const points = await allPoints(db);
    expect(points).toHaveLength(8);
    expect(points.filter((point) => point.metric === 'affected').map((point) => point.value)).toEqual([2, 2, 2, 2]);
  });

  it('aligns every point to the completed interval, so two writers agree which bucket a reading is in', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW);
    await runMetricsJob({ db, ...env, nowMs: NOW });

    const step = RESOLUTION_MS[METRICS_RESOLUTION];
    const expected = Math.floor(NOW / step) * step - step;
    const points = await allPoints(db);
    expect(new Set(points.map((point) => point.intervalStart))).toEqual(new Set([expected]));
    // The interval that just closed, never the one still filling: a partial bucket would read as a dip.
    expect(expected).toBeLessThan(NOW);
  });

  it('skips a family it could not read rather than writing a zero for it', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW);
    loadFamily.mockImplementation(async (family: string) =>
      family === 'rds' ? { ok: false, reason: 'error' } : { ok: true, data: { total: 10, affected: 2 } },
    );

    const outcome = await runMetricsJob({ db, ...env, nowMs: NOW });
    expect(outcome).toMatchObject({ covered: 3, total: 4, truncated: true });

    const points = await allPoints(db);
    // A zero here would be read as "RDS is fine", which is a claim nobody measured.
    expect(points.map((point) => point.subjectId)).not.toContain('rds');
  });

  it('is idempotent: running the same cycle twice leaves the same state', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW);
    await runMetricsJob({ db, ...env, nowMs: NOW });
    await runMetricsJob({ db, ...env, nowMs: NOW });

    const points = await allPoints(db);
    expect(points).toHaveLength(8);
  });
});
