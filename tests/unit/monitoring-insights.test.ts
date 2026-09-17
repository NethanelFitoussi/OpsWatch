import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import type { AlarmSummary } from '@/lib/monitoring/alarms';
import type { EcsDeployment, EcsService } from '@/lib/monitoring/ecs';
import type { LoadBalancer, TargetGroup } from '@/lib/monitoring/elb';
import {
  ALB_5XX_RATE_LEVELS,
  ALB_ELB_5XX_COUNT,
  ALB_MIN_REQUESTS,
  ECS_UTILIZATION_LEVELS,
  FREEABLE_MEMORY_LEVELS,
  GROUP_MIN_SERVICES,
  INSIGHT_VALUE_UNITS,
  INSIGHT_WINDOW_MINUTES,
  RDS_CPU_LEVELS,
  REPLICA_LAG_LEVELS,
  ROLLOUT_STUCK_MINUTES,
  TASKS_WINDOW_MINUTES,
  UNHEALTHY_HOSTS_LEVELS,
  albInsights,
  alarmInsights,
  ecsInsights,
  formatInsightValues,
  rdsInsights,
  sortInsights,
  type AlbSignals,
  type EcsServiceSignals,
  type Insight,
  type InsightKind,
  type RdsInstanceSignals,
} from '@/lib/monitoring/insights';
import type { RdsInstance } from '@/lib/monitoring/rds';

const NOW = Date.parse('2026-09-17T10:00:00Z');
/** A 1-minute series whose last datapoint is at NOW. */
const series = (values: number[]) => ({ timestamps: values.map((_, i) => NOW - (values.length - 1 - i) * 60_000), values });
const repeat = (value: number, n: number) => Array.from({ length: n }, () => value);
const ctx = { scope: { connectionId: 'abc123def456', region: 'eu-west-1' }, now: NOW };

const deployment = (overrides: Partial<EcsDeployment> = {}): EcsDeployment => ({
  id: 'd',
  status: 'PRIMARY',
  rolloutState: 'COMPLETED',
  rolloutStateReason: null,
  taskDefinition: 'web:1',
  desiredCount: 2,
  runningCount: 2,
  pendingCount: 0,
  failedTasks: 0,
  createdAt: NOW - 3_600_000,
  updatedAt: NOW - 3_600_000,
  ...overrides,
});

const service = (overrides: Partial<EcsService> = {}): EcsService => ({
  name: 'web',
  arn: 'arn:aws:ecs:eu-west-1:111122223333:service/prod/web',
  cluster: 'prod',
  status: 'ACTIVE',
  desiredCount: 2,
  runningCount: 2,
  pendingCount: 0,
  launchType: 'FARGATE',
  taskDefinitionArn: 'arn:aws:ecs:eu-west-1:111122223333:task-definition/web:1',
  taskDefinition: 'web:1',
  deployments: [deployment()],
  primaryDeployment: deployment(),
  events: [],
  loadBalancers: [],
  ...overrides,
});

const signals = (overrides: Partial<EcsServiceSignals> = {}): EcsServiceSignals => ({
  service: service(),
  cpu: series(repeat(30, 15)),
  memory: series(repeat(40, 15)),
  running: null,
  desired: null,
  ...overrides,
});

const instance = (overrides: Partial<RdsInstance> = {}): RdsInstance => ({
  id: 'orders-1',
  arn: 'arn:aws:rds:eu-west-1:111122223333:db:orders-1',
  resourceId: 'db-ORDERS1',
  engine: 'aurora-postgresql',
  engineVersion: '16.4',
  instanceClass: 'db.r6g.xlarge',
  status: 'available',
  availabilityZone: 'eu-west-1a',
  clusterId: 'orders',
  role: 'writer',
  aurora: true,
  performanceInsights: true,
  memoryGiB: 16,
  ...overrides,
});

const dbSignals = (overrides: Partial<RdsInstanceSignals> = {}): RdsInstanceSignals => ({
  instance: instance(),
  cpu: series(repeat(20, 15)),
  freeableMemory: series(repeat(8 * 1024 ** 3, 15)),
  replicaLag: null,
  ...overrides,
});

const loadBalancer: LoadBalancer = {
  name: 'api',
  arn: 'arn:aws:elasticloadbalancing:eu-west-1:111122223333:loadbalancer/app/api/50dc',
  dimension: 'app/api/50dc',
  dnsName: 'api-50dc.eu-west-1.elb.amazonaws.com',
  scheme: 'internet-facing',
  state: 'active',
  vpcId: 'vpc-1',
  createdAt: NOW - 86_400_000,
};

const targetGroup: TargetGroup = {
  name: 'web',
  arn: 'arn:aws:elasticloadbalancing:eu-west-1:111122223333:targetgroup/web/abcd',
  protocol: 'HTTP',
  port: 80,
  targetType: 'ip',
  healthCheckPath: '/health',
  loadBalancerArns: [loadBalancer.arn],
};

const albSignals = (overrides: Partial<AlbSignals> = {}): AlbSignals => ({
  loadBalancer,
  requests: series([]),
  elb5xx: series([]),
  target5xx: series([]),
  targetGroups: [],
  ...overrides,
});

const alarm = (overrides: Partial<AlarmSummary> = {}): AlarmSummary => ({
  name: 'db-cpu',
  type: 'metric',
  state: 'ALARM',
  stateReason: 'Threshold crossed',
  stateUpdatedAt: NOW - 60_000,
  namespace: 'AWS/RDS',
  metricName: 'CPUUtilization',
  dimensions: { DBInstanceIdentifier: 'orders-1' },
  threshold: 80,
  comparison: 'GreaterThanThreshold',
  targetTracking: false,
  ...overrides,
});

describe('insight thresholds', () => {
  it('clears percentage rules 5 points back and other units 5 % of the threshold', () => {
    expect(ECS_UTILIZATION_LEVELS).toEqual({ warning: { threshold: 85, clearAt: 80 }, critical: { threshold: 95, clearAt: 90 } });
    expect(RDS_CPU_LEVELS).toEqual({ warning: { threshold: 80, clearAt: 75 }, critical: { threshold: 95, clearAt: 90 } });
    expect(FREEABLE_MEMORY_LEVELS).toEqual({ warning: { threshold: 5, clearAt: 10 } });
    expect(REPLICA_LAG_LEVELS).toEqual({ warning: { threshold: 1000, clearAt: 950 } });
    expect(ALB_5XX_RATE_LEVELS).toEqual({ warning: { threshold: 1, clearAt: 0.95 }, critical: { threshold: 5, clearAt: 4.75 } });
    expect(UNHEALTHY_HOSTS_LEVELS).toEqual({ warning: { threshold: 0, clearAt: 0 } });
    expect(ALB_ELB_5XX_COUNT).toEqual({ warning: 10, critical: 100 });
    expect([INSIGHT_WINDOW_MINUTES, TASKS_WINDOW_MINUTES, ROLLOUT_STUCK_MINUTES, GROUP_MIN_SERVICES, ALB_MIN_REQUESTS]).toEqual([15, 10, 30, 4, 100]);
  });

  it('pre-formats only the documented value keys', () => {
    expect(INSIGHT_VALUE_UNITS).toEqual({
      'messages.ecs_cpu_high': { value: 'percent', threshold: 'percent' },
      'messages.ecs_memory_high': { value: 'percent', threshold: 'percent' },
      'messages.rds_cpu_high': { value: 'percent', threshold: 'percent' },
      'messages.rds_freeable_memory_low': { value: 'percent' },
      'messages.alb_5xx_rate': { rate: 'percent' },
      'members.aurora_replica_lag': { value: 'milliseconds' },
    });
  });
});

describe('ecsInsights', () => {
  it('reports high CPU and memory with values and a service href', () => {
    expect(ecsInsights([{ cluster: 'prod', services: [signals({ cpu: series(repeat(90, 15)) })] }], ctx)).toEqual([
      {
        severity: 'warning',
        kind: 'ecs_cpu_high',
        resource: 'web',
        messageKey: 'messages.ecs_cpu_high',
        values: { service: 'web', value: 90, threshold: 85 },
        href: '/c/abc123def456/eu-west-1/containers/prod/web',
      },
    ]);
    expect(ecsInsights([{ cluster: 'prod', services: [signals({ memory: series(repeat(96, 15)) })] }], ctx)).toEqual([
      {
        severity: 'critical',
        kind: 'ecs_memory_high',
        resource: 'web',
        messageKey: 'messages.ecs_memory_high',
        values: { service: 'web', value: 96, threshold: 95 },
        href: '/c/abc123def456/eu-west-1/containers/prod/web',
      },
    ]);
  });

  it('reports tasks below desired from Container Insights series', () => {
    expect(ecsInsights([{ cluster: 'prod', services: [signals({ running: series(repeat(1, 11)), desired: series(repeat(2, 11)) })] }], ctx)).toEqual([
      {
        severity: 'critical',
        kind: 'ecs_tasks_below_desired',
        resource: 'web',
        messageKey: 'messages.ecs_tasks_below_desired',
        values: { service: 'web', running: 1, desired: 2 },
        href: '/c/abc123def456/eu-west-1/containers/prod/web',
      },
    ]);
    expect(ecsInsights([{ cluster: 'prod', services: [signals({ running: series([...repeat(1, 10), 2]), desired: series(repeat(2, 11)) })] }], ctx)).toEqual([]);
  });

  it('falls back to the describe counts when Container Insights is off', () => {
    const stale = signals({
      service: service({ runningCount: 1, desiredCount: 2, primaryDeployment: deployment({ updatedAt: NOW - 11 * 60_000 }) }),
      running: series([1, 1]),
      desired: series([2, 2]),
    });
    expect(ecsInsights([{ cluster: 'prod', services: [stale] }], ctx)).toEqual([
      {
        severity: 'critical',
        kind: 'ecs_tasks_below_desired',
        resource: 'web',
        messageKey: 'messages.ecs_tasks_below_desired',
        values: { service: 'web', running: 1, desired: 2 },
        href: '/c/abc123def456/eu-west-1/containers/prod/web',
      },
    ]);
    const recent = signals({
      service: service({ runningCount: 1, desiredCount: 2, primaryDeployment: deployment({ updatedAt: NOW - 9 * 60_000 }) }),
      running: series([1, 1]),
      desired: series([2, 2]),
    });
    expect(ecsInsights([{ cluster: 'prod', services: [recent] }], ctx)).toEqual([]);
  });

  it('reports failed and stuck rollouts', () => {
    const failed = signals({ service: service({ primaryDeployment: deployment({ rolloutState: 'FAILED', rolloutStateReason: 'circuit breaker' }) }) });
    expect(ecsInsights([{ cluster: 'prod', services: [failed] }], ctx)).toEqual([
      {
        severity: 'critical',
        kind: 'ecs_rollout_failed',
        resource: 'web',
        messageKey: 'messages.ecs_rollout_failed',
        values: { service: 'web', reason: 'circuit breaker' },
        href: '/c/abc123def456/eu-west-1/containers/prod/web',
      },
    ]);
    const stuck = signals({ service: service({ primaryDeployment: deployment({ rolloutState: 'IN_PROGRESS', createdAt: NOW - 31 * 60_000 }) }) });
    expect(ecsInsights([{ cluster: 'prod', services: [stuck] }], ctx)).toEqual([
      {
        severity: 'warning',
        kind: 'ecs_rollout_stuck',
        resource: 'web',
        messageKey: 'messages.ecs_rollout_stuck',
        values: { service: 'web', minutes: 31 },
        href: '/c/abc123def456/eu-west-1/containers/prod/web',
      },
    ]);
    const fresh = signals({ service: service({ primaryDeployment: deployment({ rolloutState: 'IN_PROGRESS', createdAt: NOW - 29 * 60_000 }) }) });
    expect(ecsInsights([{ cluster: 'prod', services: [fresh] }], ctx)).toEqual([]);
  });

  it('groups four or more services of the same cluster and kind', () => {
    const hot = (name: string, cpu: number) => signals({ service: service({ name }), cpu: series(repeat(cpu, 15)) });
    const four = ['a', 'b', 'c', 'd'].map((name) => hot(name, 90));
    const grouped = ecsInsights([{ cluster: 'prod', services: four }], ctx);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({
      severity: 'warning',
      kind: 'ecs_cpu_high',
      resource: 'prod',
      messageKey: 'groups.ecs_cpu_high',
      values: { cluster: 'prod', count: 4 },
      href: '/c/abc123def456/eu-west-1/containers',
    });
    expect(grouped[0].members?.map((member) => member.resource)).toEqual(['a', 'b', 'c', 'd']);
    expect(new Set(grouped[0].members?.map((member) => member.messageKey))).toEqual(new Set(['messages.ecs_cpu_high']));

    const withCritical = ecsInsights([{ cluster: 'prod', services: [hot('a', 96), ...four.slice(1)] }], ctx);
    expect(withCritical).toHaveLength(1);
    expect(withCritical[0].severity).toBe('critical');

    const three = ecsInsights([{ cluster: 'prod', services: four.slice(0, 3) }], ctx);
    expect(three).toHaveLength(3);
    expect(three.every((insight) => insight.members === undefined)).toBe(true);
  });
});

describe('rdsInsights', () => {
  it('reports high CPU and low freeable memory per instance', () => {
    expect(rdsInsights({ clusters: [], instances: [dbSignals({ cpu: series(repeat(81, 15)) })] }, ctx)).toEqual([
      {
        severity: 'warning',
        kind: 'rds_cpu_high',
        resource: 'orders-1',
        messageKey: 'messages.rds_cpu_high',
        values: { instance: 'orders-1', value: 81, threshold: 80 },
        href: '/c/abc123def456/eu-west-1/databases/orders-1',
      },
    ]);
    expect(rdsInsights({ clusters: [], instances: [dbSignals({ freeableMemory: series(repeat(0.5 * 1024 ** 3, 15)) })] }, ctx)).toEqual([
      {
        severity: 'warning',
        kind: 'rds_freeable_memory_low',
        resource: 'orders-1',
        messageKey: 'messages.rds_freeable_memory_low',
        values: { instance: 'orders-1', value: 3.125 },
        href: '/c/abc123def456/eu-west-1/databases/orders-1',
      },
    ]);
    const unknownMemory = dbSignals({ instance: instance({ memoryGiB: null }), freeableMemory: series(repeat(0.5 * 1024 ** 3, 15)) });
    expect(rdsInsights({ clusters: [], instances: [unknownMemory] }, ctx)).toEqual([]);
  });

  it('always groups Aurora replica lag per cluster', () => {
    const clusters = [{ id: 'orders', engine: 'aurora-postgresql', status: 'available', writer: 'orders-1', readers: ['orders-2', 'orders-3'] }];
    const reader = (id: string, lag: number) => dbSignals({ instance: instance({ id, role: 'reader' }), replicaLag: series(repeat(lag, 15)) });
    expect(rdsInsights({ clusters, instances: [dbSignals(), reader('orders-2', 1500), reader('orders-3', 200)] }, ctx)).toEqual([
      {
        severity: 'warning',
        kind: 'aurora_replica_lag',
        resource: 'orders',
        messageKey: 'messages.aurora_replica_lag',
        values: { cluster: 'orders', lagging: 1, readers: 2 },
        href: '/c/abc123def456/eu-west-1/databases',
        members: [
          {
            resource: 'orders-2',
            severity: 'warning',
            messageKey: 'members.aurora_replica_lag',
            values: { instance: 'orders-2', value: 1500 },
            href: '/c/abc123def456/eu-west-1/databases/orders-2',
          },
        ],
      },
    ]);
    expect(rdsInsights({ clusters, instances: [dbSignals(), reader('orders-2', 200), reader('orders-3', 200)] }, ctx)).toEqual([]);
  });
});

describe('albInsights', () => {
  it('reports a 5xx rate once enough requests were served', () => {
    const warning = albInsights([albSignals({ requests: series(repeat(60, 15)), target5xx: series(repeat(1, 15)) })], ctx);
    expect(warning).toHaveLength(1);
    expect(warning[0]).toMatchObject({
      severity: 'warning',
      kind: 'alb_5xx_rate',
      resource: 'api',
      messageKey: 'messages.alb_5xx_rate',
      href: '/c/abc123def456/eu-west-1/load-balancers/api',
    });
    expect(warning[0].values).toMatchObject({ loadBalancer: 'api', errors: 15, requests: 900 });
    expect(warning[0].values.rate).toBeCloseTo(1.667, 3);

    const critical = albInsights([albSignals({ requests: series(repeat(60, 15)), target5xx: series(repeat(4, 15)) })], ctx);
    expect(critical).toHaveLength(1);
    expect(critical[0].severity).toBe('critical');

    expect(albInsights([albSignals({ requests: series(repeat(5, 15)), target5xx: series(repeat(5, 15)) })], ctx)).toEqual([]);
  });

  it('reports load balancer 5xx counts regardless of request volume', () => {
    expect(albInsights([albSignals({ elb5xx: series([...repeat(0, 5), ...repeat(1, 10)]) })], ctx)).toEqual([
      {
        severity: 'warning',
        kind: 'alb_elb_5xx_count',
        resource: 'api',
        messageKey: 'messages.alb_elb_5xx_count',
        values: { loadBalancer: 'api', count: 10 },
        href: '/c/abc123def456/eu-west-1/load-balancers/api',
      },
    ]);
    expect(albInsights([albSignals({ elb5xx: series([...repeat(0, 6), ...repeat(1, 9)]) })], ctx)).toEqual([]);
    const critical = albInsights([albSignals({ elb5xx: series(repeat(10, 10)) })], ctx);
    expect(critical).toHaveLength(1);
    expect(critical[0]).toMatchObject({ severity: 'critical', kind: 'alb_elb_5xx_count', values: { loadBalancer: 'api', count: 100 } });
  });

  it('reports unhealthy hosts per target group', () => {
    const held = albSignals({ targetGroups: [{ group: targetGroup, unhealthy: series([...repeat(0, 12), 1, 1, 1]) }] });
    expect(albInsights([held], ctx)).toEqual([
      {
        severity: 'warning',
        kind: 'alb_unhealthy_hosts',
        resource: 'api/web',
        messageKey: 'messages.alb_unhealthy_hosts',
        values: { loadBalancer: 'api', targetGroup: 'web', count: 1 },
        href: '/c/abc123def456/eu-west-1/load-balancers/api',
      },
    ]);
    const recovered = albSignals({ targetGroups: [{ group: targetGroup, unhealthy: series([...repeat(0, 12), 1, 1, 0]) }] });
    expect(albInsights([recovered], ctx)).toEqual([]);
  });
});

describe('alarmInsights', () => {
  it('keeps firing alarms and drops target tracking and healthy ones', () => {
    const alarms = [alarm(), alarm({ name: 'TargetTracking-x', targetTracking: true }), alarm({ name: 'ok', state: 'OK' })];
    expect(alarmInsights(alarms, ctx)).toEqual([
      {
        severity: 'critical',
        kind: 'alarm_firing',
        resource: 'db-cpu',
        messageKey: 'messages.alarm_firing',
        values: { alarm: 'db-cpu' },
        href: '/c/abc123def456/eu-west-1/alarms?state=ALARM',
      },
    ]);
  });
});

describe('sortInsights and formatInsightValues', () => {
  it('sorts by severity, then kind, then resource', () => {
    const insight = (severity: Insight['severity'], kind: InsightKind, resource: string): Insight => ({
      severity,
      kind,
      resource,
      messageKey: `messages.${kind}`,
      values: {},
      href: '/',
    });
    const sorted = sortInsights([
      insight('warning', 'ecs_cpu_high', 'b'),
      insight('critical', 'ecs_rollout_failed', 'a'),
      insight('warning', 'ecs_cpu_high', 'a'),
      insight('critical', 'alarm_firing', 'z'),
    ]);
    expect(sorted.map((item) => [item.severity, item.kind, item.resource])).toEqual([
      ['critical', 'alarm_firing', 'z'],
      ['critical', 'ecs_rollout_failed', 'a'],
      ['warning', 'ecs_cpu_high', 'a'],
      ['warning', 'ecs_cpu_high', 'b'],
    ]);
  });

  it('formats only the values that carry a metric unit', () => {
    expect(formatInsightValues('messages.ecs_cpu_high', { service: 'web', value: 91.24, threshold: 85 }, 'en')).toEqual({
      service: 'web',
      value: '91.2%',
      threshold: '85%',
    });
    expect(formatInsightValues('messages.alb_elb_5xx_count', { loadBalancer: 'api', count: 12 }, 'en')).toEqual({ loadBalancer: 'api', count: 12 });
  });
});

describe('insight messages', () => {
  const KINDS: InsightKind[] = [
    'ecs_tasks_below_desired',
    'ecs_cpu_high',
    'ecs_memory_high',
    'ecs_rollout_failed',
    'ecs_rollout_stuck',
    'rds_cpu_high',
    'rds_freeable_memory_low',
    'aurora_replica_lag',
    'alb_5xx_rate',
    'alb_elb_5xx_count',
    'alb_unhealthy_hosts',
    'alarm_firing',
  ];

  it('has an English message for every kind', () => {
    for (const kind of KINDS) {
      expect(typeof en.Insights.messages[kind], kind).toBe('string');
      expect(en.Insights.messages[kind].trim(), kind).not.toBe('');
    }
  });

  it('has group messages for the ECS kinds and a member message for replica lag', () => {
    expect(Object.keys(en.Insights.groups).sort()).toEqual(
      ['ecs_tasks_below_desired', 'ecs_cpu_high', 'ecs_memory_high', 'ecs_rollout_failed', 'ecs_rollout_stuck'].sort(),
    );
    expect(en.Insights.members.aurora_replica_lag.trim()).not.toBe('');
  });
});
