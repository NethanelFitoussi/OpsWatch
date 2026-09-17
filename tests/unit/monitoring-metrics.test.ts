import { CloudWatchClient, GetMetricDataCommand, type GetMetricDataCommandInput } from '@aws-sdk/client-cloudwatch';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createTtlCache } from '@/lib/monitoring/cache';
import { METRICS_TIMEOUT_MS, getMetricSeries, type MetricQuery } from '@/lib/monitoring/metrics';
import { timeWindow } from '@/lib/monitoring/shared/time-range';

const cw = mockClient(CloudWatchClient);
const target = { connectionId: 'abc123def456', region: 'eu-west-1', credentials: { accessKeyId: 'ASIA', secretAccessKey: 's', sessionToken: 't' } };
const window = timeWindow('1h', Date.parse('2026-09-17T10:00:30Z'));
const at = (iso: string) => new Date(`2026-09-17T${iso}Z`);

const cpu = (i: number): MetricQuery => ({
  id: `cpu${i}`,
  namespace: 'AWS/ECS',
  metricName: 'CPUUtilization',
  dimensions: { ServiceName: `svc${i}`, ClusterName: 'prod' },
  stat: 'Average',
});

/** Answers every query with one datapoint whose value is the query index. */
function echo() {
  cw.on(GetMetricDataCommand).callsFake((input: GetMetricDataCommandInput) => ({
    MetricDataResults: (input.MetricDataQueries ?? []).map((q, i) => ({ Id: q.Id, Timestamps: [at('09:59:00')], Values: [i] })),
  }));
}

let clockMs = 0;
let deps: { cache: ReturnType<typeof createTtlCache>; log: Mock };

beforeEach(() => {
  cw.reset();
  clockMs = 0;
  deps = { cache: createTtlCache({ now: () => clockMs }), log: vi.fn() };
});

const calls = () => cw.commandCalls(GetMetricDataCommand).map((c) => c.args[0].input);

describe('getMetricSeries', () => {
  it('sends the window, period, statistic and name-sorted dimensions', async () => {
    echo();
    const result = await getMetricSeries(target, [cpu(0), { ...cpu(1), stat: 'Sum', label: 'Total' }], window, deps);
    expect(calls()).toEqual([
      {
        StartTime: at('09:00:00'),
        EndTime: at('10:00:00'),
        ScanBy: 'TimestampAscending',
        MetricDataQueries: [
          { Id: 'q0', ReturnData: true, MetricStat: { Metric: { Namespace: 'AWS/ECS', MetricName: 'CPUUtilization', Dimensions: [{ Name: 'ClusterName', Value: 'prod' }, { Name: 'ServiceName', Value: 'svc0' }] }, Period: 60, Stat: 'Average' } },
          { Id: 'q1', ReturnData: true, MetricStat: { Metric: { Namespace: 'AWS/ECS', MetricName: 'CPUUtilization', Dimensions: [{ Name: 'ClusterName', Value: 'prod' }, { Name: 'ServiceName', Value: 'svc1' }] }, Period: 60, Stat: 'Sum' } },
        ],
      },
    ]);
    expect(result).toEqual({
      ok: true,
      data: [
        { id: 'cpu0', label: 'CPUUtilization', timestamps: [at('09:59:00').getTime()], values: [0] },
        { id: 'cpu1', label: 'Total', timestamps: [at('09:59:00').getTime()], values: [1] },
      ],
    });
  });

  it('splits 1001 queries into requests of 500, 500 and 1', async () => {
    echo();
    const result = await getMetricSeries(target, Array.from({ length: 1001 }, (_, i) => cpu(i)), window, deps);
    expect(result.ok).toBe(true);
    expect(calls().map((c) => c.MetricDataQueries?.length).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 500, 500]);
  });

  it('follows NextToken and returns datapoints oldest first', async () => {
    cw.on(GetMetricDataCommand)
      .resolvesOnce({ MetricDataResults: [{ Id: 'q0', Timestamps: [at('09:02:00'), at('09:01:00')], Values: [2, 1] }], NextToken: 'page-2' })
      .resolvesOnce({ MetricDataResults: [{ Id: 'q0', Timestamps: [at('09:00:00')], Values: [0] }] });
    const result = await getMetricSeries(target, [cpu(0)], window, deps);
    expect(calls()[1].NextToken).toBe('page-2');
    expect(result).toMatchObject({ ok: true, data: [{ timestamps: [at('09:00:00'), at('09:01:00'), at('09:02:00')].map((d) => d.getTime()), values: [0, 1, 2] }] });
  });

  it('returns an empty series for a query AWS did not answer', async () => {
    cw.on(GetMetricDataCommand).resolves({ MetricDataResults: [] });
    expect(await getMetricSeries(target, [cpu(0)], window, deps)).toEqual({ ok: true, data: [{ id: 'cpu0', label: 'CPUUtilization', timestamps: [], values: [] }] });
  });

  it('serves each series from the cache for 60 seconds and only fetches the missing ones', async () => {
    echo();
    await getMetricSeries(target, [cpu(0)], window, deps);
    await getMetricSeries(target, [cpu(0), cpu(1)], window, deps);
    expect(calls().map((c) => c.MetricDataQueries?.length)).toEqual([1, 1]);
    expect(calls()[1].MetricDataQueries?.[0].MetricStat?.Metric?.Dimensions?.[1]).toEqual({ Name: 'ServiceName', Value: 'svc1' });
    clockMs += 60_000;
    await getMetricSeries(target, [cpu(0)], window, deps);
    expect(calls()).toHaveLength(3);
  });

  it('asks AWS once for identical queries with different ids', async () => {
    echo();
    const result = await getMetricSeries(target, [cpu(0), { ...cpu(0), id: 'again' }], window, deps);
    expect(calls()[0].MetricDataQueries).toHaveLength(1);
    expect(result.ok && result.data.map((s) => s.id)).toEqual(['cpu0', 'again']);
  });

  it('maps errors to typed failures, logs them without parameters and does not cache them', async () => {
    cw.on(GetMetricDataCommand).rejects(Object.assign(new Error('no'), { name: 'AccessDeniedException' }));
    expect(await getMetricSeries(target, [cpu(0)], window, deps)).toEqual({ ok: false, reason: 'denied', code: 'AccessDeniedException', action: 'cloudwatch:GetMetricData' });
    expect(deps.log).toHaveBeenCalledWith({ event: 'monitoring_call', connectionId: 'abc123def456', region: 'eu-west-1', action: 'cloudwatch:GetMetricData', reason: 'denied', code: 'AccessDeniedException' });
    await getMetricSeries(target, [cpu(0)], window, deps);
    expect(calls()).toHaveLength(2);
  });

  it('gives up after the timeout', async () => {
    expect(METRICS_TIMEOUT_MS).toBe(10_000);
    cw.on(GetMetricDataCommand).callsFake(() => new Promise(() => {}));
    expect(await getMetricSeries(target, [cpu(0)], window, { ...deps, timeoutMs: 5 })).toMatchObject({ ok: false, reason: 'error', code: 'Timeout' });
  });

  it('returns no request and an empty list for no queries', async () => {
    expect(await getMetricSeries(target, [], window, deps)).toEqual({ ok: true, data: [] });
    expect(calls()).toHaveLength(0);
  });
});
