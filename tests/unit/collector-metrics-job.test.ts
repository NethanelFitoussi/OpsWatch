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
const listLoadBalancers = vi.fn();
const getMetricSeries = vi.fn();

vi.mock('@/lib/monitoring/target', () => ({ resolveTarget: (...args: unknown[]) => resolveTarget(...args) }));
vi.mock('@/lib/monitoring/overview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/monitoring/overview')>()),
  loadFamily: (...args: unknown[]) => loadFamily(...args),
}));
vi.mock('@/lib/monitoring/elb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/monitoring/elb')>()),
  listLoadBalancers: (...args: unknown[]) => listLoadBalancers(...args),
}));
vi.mock('@/lib/monitoring/metrics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/monitoring/metrics')>()),
  getMetricSeries: (...args: unknown[]) => getMetricSeries(...args),
}));

const { METRICS_RESOLUTION, SLO_LOAD_BALANCER_LIMIT, runMetricsJob } = await import('@/lib/collector/metrics-job');
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
  listLoadBalancers.mockReset();
  getMetricSeries.mockReset();
  resolveTarget.mockResolvedValue({ ok: true, data: { ...env, region: env.scope, credentials: {} } });
  loadFamily.mockResolvedValue({ ok: true, data: { total: 10, affected: 2 } });
  listLoadBalancers.mockResolvedValue({ ok: true, data: [] });
  getMetricSeries.mockResolvedValue({ ok: true, data: [] });
});

describe('§31.1 — history is off until someone turns it on', () => {
  it('THE RULING: a fresh installation makes no AWS request whatsoever', async () => {
    const db = createTestDb();
    const outcome = await runMetricsJob({ db, ...env, nowMs: NOW });

    expect(resolveTarget).not.toHaveBeenCalled();
    expect(loadFamily).not.toHaveBeenCalled();
    // The availability rollups §19 reads are behind the same switch, so this call must not fire either.
    expect(listLoadBalancers).not.toHaveBeenCalled();
    expect(getMetricSeries).not.toHaveBeenCalled();
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

describe('the availability rollups §19 reads back', () => {
  const balancers = [{ name: 'prod-alb', arn: 'a', dimension: 'app/prod-alb/1', dnsName: null, scheme: null, state: null, vpcId: null, createdAt: null }];
  const series = (over: Record<string, number[]> = {}) =>
    Object.entries({ lb0req: [1000], lb0elb5xx: [5], lb0t5xx: [15], ...over }).map(([id, values]) => ({
      id,
      label: id,
      timestamps: values.map((_, index) => NOW - index * 60_000),
      values,
    }));

  const readMetric = (db: Parameters<typeof opswatchDbProvider>[0], metric: string) =>
    opswatchDbProvider(db).read({
      category: 'metric', subjectId: 'prod-alb', metric, ...env,
      resolution: METRICS_RESOLUTION,
      from: NOW - RESOLUTION_MS[METRICS_RESOLUTION] * 4,
      to: NOW,
    });

  it('stores requests and both 5xx counts, which is what availability is computed from', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW);
    listLoadBalancers.mockResolvedValue({ ok: true, data: balancers });
    getMetricSeries.mockResolvedValue({ ok: true, data: series() });

    await runMetricsJob({ db, ...env, nowMs: NOW });

    expect((await readMetric(db, 'requests')).points[0]?.value).toBe(1000);
    expect((await readMetric(db, 'elb5xx')).points[0]?.value).toBe(5);
    expect((await readMetric(db, 'target5xx')).points[0]?.value).toBe(15);
  });

  it('THE RULING: a metric with no datapoint is stored as null, not as zero traffic', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW);
    listLoadBalancers.mockResolvedValue({ ok: true, data: balancers });
    // CloudWatch returned nothing for requests. Zero would say "no traffic", which nobody measured.
    getMetricSeries.mockResolvedValue({ ok: true, data: series({ lb0req: [] }) });

    await runMetricsJob({ db, ...env, nowMs: NOW });
    expect((await readMetric(db, 'requests')).points[0]?.value).toBeNull();
  });

  it('counts the load balancers it covered in the run, alongside the families', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW);
    listLoadBalancers.mockResolvedValue({ ok: true, data: balancers });
    getMetricSeries.mockResolvedValue({ ok: true, data: series() });

    const outcome = await runMetricsJob({ db, ...env, nowMs: NOW });
    expect(outcome).toMatchObject({ covered: 5, total: 5 });
  });

  /** The percentile request is a separate one: `getMetricSeries` is called twice, and this answers each. */
  const byRequest = (availability: Record<string, number[]>, latency: Record<string, number[]>) =>
    (_target: unknown, queries: readonly { stat: string }[]) => ({
      ok: true,
      data: queries[0]?.stat === 'p95'
        ? Object.entries(latency).map(([id, values]) => ({ id, label: id, timestamps: values.map((_, i) => NOW - i * 60_000), values }))
        : series(availability),
    });

  it('THE RULING: p95 is asked for in a request of its own, because a percentile cannot share one', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW);
    listLoadBalancers.mockResolvedValue({ ok: true, data: balancers });
    getMetricSeries.mockImplementation(byRequest({}, { lb0p95: [0.42] }));

    await runMetricsJob({ db, ...env, nowMs: NOW });

    expect(getMetricSeries).toHaveBeenCalledTimes(2);
    const stats = getMetricSeries.mock.calls.map((call) => (call[1] as { stat: string }[]).map((query) => query.stat));
    // No request mixes them: one is all Sums, the other all percentiles.
    for (const request of stats) expect(new Set(request).size).toBe(1);
    // Stored as CloudWatch reports it — seconds. The objective converts, so history is not rewritten by a unit.
    expect((await readMetric(db, 'p95')).points[0]?.value).toBe(0.42);
  });

  it('a p95 CloudWatch had no datapoint for is null, not an instant response', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW);
    listLoadBalancers.mockResolvedValue({ ok: true, data: balancers });
    getMetricSeries.mockImplementation(byRequest({}, {}));

    await runMetricsJob({ db, ...env, nowMs: NOW });
    expect((await readMetric(db, 'p95')).points[0]?.value).toBeNull();
  });

  it('bounds the fan-out, so a large account cannot turn a five-minute job loose', async () => {
    expect(SLO_LOAD_BALANCER_LIMIT).toBeGreaterThan(0);
    expect(SLO_LOAD_BALANCER_LIMIT).toBeLessThanOrEqual(50);
  });

  it('records the families even when the load balancers cannot be listed', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW);
    listLoadBalancers.mockResolvedValue({ ok: false, reason: 'error', code: 'AccessDenied', action: 'elasticloadbalancing:DescribeLoadBalancers' });

    const outcome = await runMetricsJob({ db, ...env, nowMs: NOW });
    // The families still counted; the availability half simply contributed nothing.
    expect(outcome.covered).toBe(4);
    expect(outcome.total).toBe(4);
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
