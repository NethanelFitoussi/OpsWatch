import { CloudWatchClient, DescribeAlarmsCommand } from '@aws-sdk/client-cloudwatch';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { filterAlarms, listAlarms, parseAlarmFilter } from '@/lib/monitoring/alarms';
import { createTtlCache } from '@/lib/monitoring/cache';

const cw = mockClient(CloudWatchClient);
const target = { connectionId: 'abc123def456', region: 'eu-west-1', credentials: { accessKeyId: 'ASIA', secretAccessKey: 's' } };
const updated = new Date('2026-09-17T09:00:00Z');
let deps: { cache: ReturnType<typeof createTtlCache>; log: Mock };

beforeEach(() => {
  cw.reset();
  deps = { cache: createTtlCache(), log: vi.fn() };
});

function twoPages() {
  cw.on(DescribeAlarmsCommand)
    .resolvesOnce({
      MetricAlarms: [
        {
          AlarmName: 'api-5xx',
          StateValue: 'OK',
          StateReason: 'Threshold not crossed',
          StateUpdatedTimestamp: updated,
          Namespace: 'AWS/ApplicationELB',
          MetricName: 'HTTPCode_ELB_5XX_Count',
          Dimensions: [{ Name: 'LoadBalancer', Value: 'app/api/1' }],
          Threshold: 10,
          ComparisonOperator: 'GreaterThanOrEqualToThreshold',
        },
      ],
      NextToken: 'page-2',
    })
    .resolvesOnce({
      CompositeAlarms: [{ AlarmName: 'site-down', StateValue: 'ALARM', StateReason: 'Children in alarm' }],
      MetricAlarms: [{ AlarmName: 'TargetTracking-service/prod/web-AlarmLow-1', StateValue: 'ALARM', StateReason: 'low' }],
    });
}

describe('listAlarms', () => {
  it('pages through metric and composite alarms, alarms first', async () => {
    twoPages();
    const result = await listAlarms(target, deps);
    expect(cw.commandCalls(DescribeAlarmsCommand).map((c) => c.args[0].input)).toEqual([
      { AlarmTypes: ['MetricAlarm', 'CompositeAlarm'], MaxRecords: 100 },
      { AlarmTypes: ['MetricAlarm', 'CompositeAlarm'], MaxRecords: 100, NextToken: 'page-2' },
    ]);
    expect(result.ok && result.data.map((a) => [a.name, a.type, a.state, a.targetTracking])).toEqual([
      ['site-down', 'composite', 'ALARM', false],
      ['TargetTracking-service/prod/web-AlarmLow-1', 'metric', 'ALARM', true],
      ['api-5xx', 'metric', 'OK', false],
    ]);
    expect(result.ok && result.data[2]).toEqual({
      name: 'api-5xx',
      type: 'metric',
      state: 'OK',
      stateReason: 'Threshold not crossed',
      stateUpdatedAt: updated.getTime(),
      namespace: 'AWS/ApplicationELB',
      metricName: 'HTTPCode_ELB_5XX_Count',
      dimensions: { LoadBalancer: 'app/api/1' },
      threshold: 10,
      comparison: 'GreaterThanOrEqualToThreshold',
      targetTracking: false,
      // The rest of the condition, which DescribeAlarms already returns: without it a reader cannot tell
      // "over 10 once" from "over 10 for fifteen minutes", and those are different alarms.
      description: null,
      statistic: null,
      period: null,
      evaluationPeriods: null,
      datapointsToAlarm: null,
      unit: null,
      treatMissingData: null,
    });
  });

  it('caches the list for 60 seconds and reports a denied call', async () => {
    twoPages();
    await listAlarms(target, deps);
    await listAlarms(target, deps);
    expect(cw.commandCalls(DescribeAlarmsCommand)).toHaveLength(2);

    cw.reset();
    cw.on(DescribeAlarmsCommand).rejects(Object.assign(new Error('no'), { name: 'AccessDenied' }));
    expect(await listAlarms({ ...target, region: 'us-east-1' }, deps)).toEqual({ ok: false, reason: 'denied', code: 'AccessDenied', action: 'cloudwatch:DescribeAlarms' });
  });
});

describe('alarm filters', () => {
  it('parses the query string', () => {
    expect(parseAlarmFilter({ state: 'bogus', tt: 'yes', q: '  web ' })).toEqual({ service: 'all', recent: false, state: 'all', showTargetTracking: false, search: 'web' });
    expect(parseAlarmFilter({ state: 'ALARM', tt: '1' })).toEqual({ service: 'all', recent: false, state: 'ALARM', showTargetTracking: true, search: '' });
    expect(parseAlarmFilter({ q: 'x'.repeat(150) }).search).toHaveLength(100);
  });

  it('hides target-tracking alarms unless asked, and filters by state and name', async () => {
    twoPages();
    const result = await listAlarms(target, deps);
    const alarms = result.ok ? result.data : [];
    const names = (filter: Parameters<typeof filterAlarms>[1]) => filterAlarms(alarms, filter).map((a) => a.name);
    expect(names({ service: 'all', recent: false, state: 'all', showTargetTracking: false, search: '' })).toEqual(['site-down', 'api-5xx']);
    expect(names({ service: 'all', recent: false, state: 'all', showTargetTracking: true, search: '' })).toHaveLength(3);
    expect(names({ service: 'all', recent: false, state: 'ALARM', showTargetTracking: false, search: '' })).toEqual(['site-down']);
    expect(names({ service: 'all', recent: false, state: 'all', showTargetTracking: false, search: 'API' })).toEqual(['api-5xx']);
  });
});

describe('a metric-math alarm, which is what Application Insights creates', () => {
  /**
   * CloudWatch answers these with `MetricName`, `Namespace`, `Period` and `Statistic` all null, and the
   * real metric inside `Metrics[].MetricStat`. Reading only the top level left them with no metric at
   * all, so the only thing the page could call them was their own identifier — which is exactly what a
   * real estate showed.
   */
  const insights = {
    AlarmName: 'ApplicationInsights/ApplicationInsights-ContainerInsights-ECS_CLUSTER-prod/AWS/ECS/CPUReservation/prod/',
    StateValue: 'ALARM' as const,
    StateReason: 'Threshold Crossed: 2 out of the last 2 datapoints were greater than the threshold (64.0).',
    StateUpdatedTimestamp: updated,
    Threshold: 64,
    ComparisonOperator: 'GreaterThanOrEqualToThreshold' as const,
    // The shape that matters: an empty array rather than an absent one.
    Dimensions: [],
    Metrics: [
      {
        Id: 'm1',
        ReturnData: true,
        MetricStat: {
          Metric: { Namespace: 'AWS/ECS', MetricName: 'CPUReservation', Dimensions: [{ Name: 'ClusterName', Value: 'prod' }] },
          Period: 300,
          Stat: 'Average',
        },
      },
    ],
  };

  it('THE RULING: the metric, its dimensions, its period and its statistic all come from the query', async () => {
    cw.on(DescribeAlarmsCommand).resolves({ MetricAlarms: [insights] });
    const result = await listAlarms(target, deps);
    expect(result.ok && result.data[0]).toMatchObject({
      namespace: 'AWS/ECS',
      metricName: 'CPUReservation',
      // `Dimensions: []` must not win over the dimensions inside the query, or the alarm names no resource.
      dimensions: { ClusterName: 'prod' },
      statistic: 'Average',
      period: 300,
    });
  });

  it('reads the returned expression rather than whichever metric happened to be first', async () => {
    cw.on(DescribeAlarmsCommand).resolves({
      MetricAlarms: [
        {
          ...insights,
          Metrics: [
            // A metric-math alarm carries its inputs too; only one of them is what the alarm watches.
            { Id: 'm0', ReturnData: false, MetricStat: { Metric: { Namespace: 'AWS/ECS', MetricName: 'MemoryReservation' }, Period: 60, Stat: 'Sum' } },
            ...insights.Metrics,
          ],
        },
      ],
    });
    const result = await listAlarms(target, deps);
    expect(result.ok && result.data[0].metricName).toBe('CPUReservation');
  });

  it('leaves a plain alarm alone, taking nothing from a query it does not have', async () => {
    twoPages();
    const result = await listAlarms(target, deps);
    expect(result.ok && result.data[2]).toMatchObject({ namespace: 'AWS/ApplicationELB', metricName: 'HTTPCode_ELB_5XX_Count' });
  });
});
