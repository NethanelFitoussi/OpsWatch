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
    expect(parseAlarmFilter({ state: 'bogus', tt: 'yes', q: '  web ' })).toEqual({ state: 'all', showTargetTracking: false, search: 'web' });
    expect(parseAlarmFilter({ state: 'ALARM', tt: '1' })).toEqual({ state: 'ALARM', showTargetTracking: true, search: '' });
    expect(parseAlarmFilter({ q: 'x'.repeat(150) }).search).toHaveLength(100);
  });

  it('hides target-tracking alarms unless asked, and filters by state and name', async () => {
    twoPages();
    const result = await listAlarms(target, deps);
    const alarms = result.ok ? result.data : [];
    const names = (filter: Parameters<typeof filterAlarms>[1]) => filterAlarms(alarms, filter).map((a) => a.name);
    expect(names({ state: 'all', showTargetTracking: false, search: '' })).toEqual(['site-down', 'api-5xx']);
    expect(names({ state: 'all', showTargetTracking: true, search: '' })).toHaveLength(3);
    expect(names({ state: 'ALARM', showTargetTracking: false, search: '' })).toEqual(['site-down']);
    expect(names({ state: 'all', showTargetTracking: false, search: 'API' })).toEqual(['api-5xx']);
  });
});
