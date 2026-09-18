import { CloudWatchClient, DescribeAlarmsCommand, GetMetricDataCommand, type GetMetricDataCommandInput } from '@aws-sdk/client-cloudwatch';
import { DescribeClustersCommand, DescribeServicesCommand, ECSClient, ListClustersCommand, ListServicesCommand } from '@aws-sdk/client-ecs';
import { DescribeLoadBalancersCommand, DescribeTargetGroupsCommand, ElasticLoadBalancingV2Client } from '@aws-sdk/client-elastic-load-balancing-v2';
import { DescribeDBClustersCommand, DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createTtlCache } from '@/lib/monitoring/cache';
import { INSIGHT_FETCH_MINUTES, albFamily, alarmsFamily, ecsFamily, loadFamily, rdsFamily } from '@/lib/monitoring/overview';

const cw = mockClient(CloudWatchClient);
const ecs = mockClient(ECSClient);
const rds = mockClient(RDSClient);
const elb = mockClient(ElasticLoadBalancingV2Client);

const NOW = Date.parse('2026-09-17T10:00:30Z');
const END = Date.parse('2026-09-17T10:00:00Z');
const target = { connectionId: 'abc123def456', region: 'eu-west-1', credentials: { accessKeyId: 'ASIA', secretAccessKey: 's' } };
const ecsArn = (kind: string, name: string) => `arn:aws:ecs:eu-west-1:111122223333:${kind}/${name}`;
const lbArn = 'arn:aws:elasticloadbalancing:eu-west-1:111122223333:loadbalancer/app/api/50dc6c495c0c9188';
const tgArn = 'arn:aws:elasticloadbalancing:eu-west-1:111122223333:targetgroup/web/73e2d6bc24d8a067';

/** One datapoint per minute of the fetched window, ending at its end. */
const POINTS = Array.from({ length: INSIGHT_FETCH_MINUTES }, (_, i) => new Date(END - (INSIGHT_FETCH_MINUTES - 1 - i) * 60_000));

let deps: { cache: ReturnType<typeof createTtlCache>; log: Mock };

beforeEach(() => {
  cw.reset();
  ecs.reset();
  rds.reset();
  elb.reset();
  deps = { cache: createTtlCache(), log: vi.fn() };
});

/** Answers every query with a flat series whose value comes from the metric name. */
function metrics(table: Record<string, number>) {
  cw.on(GetMetricDataCommand).callsFake((input: GetMetricDataCommandInput) => ({
    MetricDataResults: (input.MetricDataQueries ?? []).map((q) => ({
      Id: q.Id,
      Timestamps: POINTS,
      Values: POINTS.map(() => table[q.MetricStat?.Metric?.MetricName ?? ''] ?? 0),
    })),
  }));
}

const metricCalls = () => cw.commandCalls(GetMetricDataCommand).map((c) => c.args[0].input);

describe('ecsFamily', () => {
  beforeEach(() => {
    ecs.on(ListClustersCommand).resolves({ clusterArns: [ecsArn('cluster', 'prod')] });
    ecs.on(DescribeClustersCommand).resolves({
      clusters: [
        {
          clusterName: 'prod',
          clusterArn: ecsArn('cluster', 'prod'),
          status: 'ACTIVE',
          settings: [{ name: 'containerInsights', value: 'enabled' }],
          activeServicesCount: 1,
          runningTasksCount: 2,
          pendingTasksCount: 0,
        },
      ],
    });
    ecs.on(ListServicesCommand).resolves({ serviceArns: [ecsArn('service', 'prod/web')] });
    ecs.on(DescribeServicesCommand).resolves({
      services: [
        {
          serviceName: 'web',
          serviceArn: ecsArn('service', 'prod/web'),
          status: 'ACTIVE',
          desiredCount: 2,
          runningCount: 2,
          pendingCount: 0,
          taskDefinition: ecsArn('task-definition', 'web:7'),
          deployments: [
            {
              id: 'ecs-svc/1',
              status: 'PRIMARY',
              rolloutState: 'COMPLETED',
              taskDefinition: ecsArn('task-definition', 'web:7'),
              desiredCount: 2,
              runningCount: 2,
              pendingCount: 0,
              createdAt: new Date(END - 3_600_000),
              updatedAt: new Date(END - 3_600_000),
            },
          ],
          events: [],
          loadBalancers: [],
        },
      ],
    });
  });

  it('reports a high-CPU service and counts it once', async () => {
    metrics({ CPUUtilization: 96, MemoryUtilization: 40, RunningTaskCount: 2, DesiredTaskCount: 2 });
    expect(await ecsFamily(target, NOW, deps)).toEqual({
      ok: true,
      data: {
        total: 1,
        affected: 1,
        insights: [
          {
            severity: 'critical',
            kind: 'ecs_cpu_high',
            resource: 'web',
            messageKey: 'messages.ecs_cpu_high',
            values: { service: 'web', value: 96, threshold: 95 },
            href: '/c/abc123def456/eu-west-1/containers/services/prod/web',
          },
        ],
      },
    });
  });

  it('asks for utilization and task counts of the last 20 minutes in one request', async () => {
    metrics({ CPUUtilization: 30, MemoryUtilization: 40, RunningTaskCount: 2, DesiredTaskCount: 2 });
    const result = await ecsFamily(target, NOW, deps);
    expect(result).toEqual({ ok: true, data: { total: 1, affected: 0, insights: [] } });
    expect(metricCalls()).toHaveLength(1);
    expect(metricCalls()[0].StartTime).toEqual(new Date('2026-09-17T09:40:00Z'));
    expect(metricCalls()[0].EndTime).toEqual(new Date('2026-09-17T10:00:00Z'));
    expect(metricCalls()[0].MetricDataQueries?.map((q) => [q.MetricStat?.Metric?.MetricName, q.MetricStat?.Period])).toEqual([
      ['CPUUtilization', 60],
      ['MemoryUtilization', 60],
      ['RunningTaskCount', 60],
      ['DesiredTaskCount', 60],
    ]);
  });
});

describe('rdsFamily', () => {
  it('reads CPU and freeable memory of every instance and reports a healthy one as unaffected', async () => {
    rds.on(DescribeDBClustersCommand).resolves({ DBClusters: [] });
    rds.on(DescribeDBInstancesCommand).resolves({
      DBInstances: [
        {
          DBInstanceIdentifier: 'orders',
          DBInstanceArn: 'arn:aws:rds:eu-west-1:111122223333:db:orders',
          Engine: 'mysql',
          DBInstanceClass: 'db.t3.medium',
          DBInstanceStatus: 'available',
        },
      ],
    });
    metrics({ CPUUtilization: 50, FreeableMemory: 3 * 1024 ** 3 });
    expect(await rdsFamily(target, NOW, deps)).toEqual({ ok: true, data: { total: 1, affected: 0, insights: [] } });
    expect(metricCalls()).toHaveLength(1);
    expect(metricCalls()[0].MetricDataQueries?.map((q) => q.MetricStat?.Metric?.MetricName)).toEqual(['CPUUtilization', 'FreeableMemory']);
  });
});

describe('albFamily', () => {
  it('reports unhealthy hosts without counting them as 5xx errors', async () => {
    elb.on(DescribeLoadBalancersCommand).resolves({
      LoadBalancers: [
        { LoadBalancerName: 'api', LoadBalancerArn: lbArn, Type: 'application', DNSName: 'api.example', Scheme: 'internet-facing', State: { Code: 'active' } },
      ],
    });
    elb.on(DescribeTargetGroupsCommand).resolves({
      TargetGroups: [{ TargetGroupName: 'web', TargetGroupArn: tgArn, Protocol: 'HTTP', Port: 80, TargetType: 'ip', LoadBalancerArns: [lbArn] }],
    });
    metrics({ RequestCount: 60, HTTPCode_ELB_5XX_Count: 0, HTTPCode_Target_5XX_Count: 0, UnHealthyHostCount: 1 });
    expect(await albFamily(target, NOW, deps)).toEqual({
      ok: true,
      data: {
        total: 1,
        affected: 0,
        insights: [
          {
            severity: 'warning',
            kind: 'alb_unhealthy_hosts',
            resource: 'api/web',
            messageKey: 'messages.alb_unhealthy_hosts',
            values: { loadBalancer: 'api', targetGroup: 'web', count: 1 },
            href: '/c/abc123def456/eu-west-1/load-balancers/list/api',
          },
        ],
      },
    });
    const unhealthy = metricCalls()[0].MetricDataQueries?.find((q) => q.MetricStat?.Metric?.MetricName === 'UnHealthyHostCount');
    expect(unhealthy?.MetricStat?.Stat).toBe('Maximum');
    expect(unhealthy?.MetricStat?.Metric?.Dimensions).toEqual([
      { Name: 'LoadBalancer', Value: 'app/api/50dc6c495c0c9188' },
      { Name: 'TargetGroup', Value: 'targetgroup/web/73e2d6bc24d8a067' },
    ]);
  });
});

describe('alarmsFamily', () => {
  it('counts alarms that are not target-tracking and reports the firing ones', async () => {
    cw.on(DescribeAlarmsCommand).resolves({
      MetricAlarms: [
        { AlarmName: 'db-cpu', StateValue: 'ALARM', StateReason: 'breach' },
        { AlarmName: 'TargetTracking-x', StateValue: 'ALARM', StateReason: 'scaling' },
        { AlarmName: 'ok', StateValue: 'OK', StateReason: 'fine' },
      ],
    });
    expect(await alarmsFamily(target, NOW, deps)).toEqual({
      ok: true,
      data: {
        total: 2,
        affected: 1,
        insights: [
          {
            severity: 'critical',
            kind: 'alarm_firing',
            resource: 'db-cpu',
            messageKey: 'messages.alarm_firing',
            values: { alarm: 'db-cpu' },
            href: '/c/abc123def456/eu-west-1/alarms/list?state=ALARM',
          },
        ],
      },
    });
  });
});

describe('loadFamily', () => {
  it('propagates a denied describe call', async () => {
    cw.on(DescribeAlarmsCommand).rejects(Object.assign(new Error('no'), { name: 'AccessDenied' }));
    const failure = { ok: false, reason: 'denied', code: 'AccessDenied', action: 'cloudwatch:DescribeAlarms' };
    expect(await alarmsFamily(target, NOW, deps)).toEqual(failure);
    expect(await loadFamily('alarms', target, NOW, deps)).toEqual(failure);
    expect(deps.log).toHaveBeenCalledWith({
      event: 'monitoring_call',
      connectionId: target.connectionId,
      region: target.region,
      action: 'cloudwatch:DescribeAlarms',
      reason: 'denied',
      code: 'AccessDenied',
    });
  });
});
