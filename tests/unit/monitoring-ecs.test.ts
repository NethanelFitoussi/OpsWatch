import {
  DescribeClustersCommand,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  DescribeTasksCommand,
  ECSClient,
  ListClustersCommand,
  ListServicesCommand,
  ListTasksCommand,
} from '@aws-sdk/client-ecs';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createTtlCache } from '@/lib/monitoring/cache';
import {
  DESCRIBE_SERVICES_BATCH,
  MAX_EVENTS,
  MAX_TASKS,
  describeService,
  listClusters,
  listServiceTasks,
  listServices,
  serviceTaskCountQueries,
  serviceUtilizationQueries,
  taskDefinitionLabel,
  taskDefinitionLogs,
} from '@/lib/monitoring/ecs';

const ecs = mockClient(ECSClient);
const target = { connectionId: 'abc123def456', region: 'eu-west-1', credentials: { accessKeyId: 'ASIA', secretAccessKey: 's' } };
const arn = (kind: string, name: string) => `arn:aws:ecs:eu-west-1:111122223333:${kind}/${name}`;
const clusterArn = arn('cluster', 'prod');
let deps: { cache: ReturnType<typeof createTtlCache>; log: Mock };

beforeEach(() => {
  ecs.reset();
  deps = { cache: createTtlCache(), log: vi.fn() };
});

const svcName = (i: number) => `svc-${String(i).padStart(2, '0')}`;

function fakeDescribeServices() {
  ecs.on(DescribeServicesCommand).callsFake((input: { services?: string[] }) => ({
    services: (input.services ?? []).map((serviceName) => ({
      serviceName,
      serviceArn: arn('service', `prod/${serviceName}`),
      clusterArn,
      status: 'ACTIVE',
      desiredCount: 2,
      runningCount: 2,
      pendingCount: 0,
      taskDefinition: 'arn:aws:ecs:eu-west-1:111122223333:task-definition/web:7',
      deployments: [],
      events: [],
      loadBalancers: [],
    })),
  }));
}

describe('listClusters', () => {
  it('paginates and reads Container Insights', async () => {
    const stagingArn = arn('cluster', 'staging');
    ecs.on(ListClustersCommand).resolvesOnce({ clusterArns: [stagingArn], nextToken: 'n' }).resolvesOnce({ clusterArns: [clusterArn] });
    ecs.on(DescribeClustersCommand).resolves({
      clusters: [
        {
          clusterName: 'staging',
          clusterArn: stagingArn,
          status: 'ACTIVE',
          settings: [{ name: 'containerInsights', value: 'disabled' }],
          activeServicesCount: 2,
          runningTasksCount: 3,
          pendingTasksCount: 0,
        },
        {
          clusterName: 'prod',
          clusterArn,
          status: 'ACTIVE',
          settings: [{ name: 'containerInsights', value: 'enhanced' }],
          activeServicesCount: 12,
          runningTasksCount: 30,
          pendingTasksCount: 1,
        },
      ],
    });
    const result = await listClusters(target, deps);
    expect(ecs.commandCalls(ListClustersCommand).map((c) => c.args[0].input)).toEqual([{ maxResults: 100 }, { maxResults: 100, nextToken: 'n' }]);
    expect(ecs.commandCalls(DescribeClustersCommand).map((c) => c.args[0].input)).toEqual([{ clusters: [stagingArn, clusterArn], include: ['SETTINGS'] }]);
    expect(result).toEqual({
      ok: true,
      data: [
        { name: 'prod', arn: clusterArn, status: 'ACTIVE', containerInsights: true, activeServices: 12, runningTasks: 30, pendingTasks: 1 },
        { name: 'staging', arn: stagingArn, status: 'ACTIVE', containerInsights: false, activeServices: 2, runningTasks: 3, pendingTasks: 0 },
      ],
    });
  });
});

describe('listServices', () => {
  it('searches names before describing, in batches of 10', async () => {
    const all = Array.from({ length: 25 }, (_, i) => arn('service', `prod/${svcName(i)}`));
    // Reversed pages so the name sort is observable.
    ecs.on(ListServicesCommand).resolvesOnce({ serviceArns: all.slice(10).reverse(), nextToken: 'p2' }).resolvesOnce({ serviceArns: all.slice(0, 10).reverse() });
    fakeDescribeServices();

    const result = await listServices(target, 'prod', '', deps);
    expect(ecs.commandCalls(ListServicesCommand).map((c) => c.args[0].input)).toEqual([
      { cluster: 'prod', maxResults: 100 },
      { cluster: 'prod', maxResults: 100, nextToken: 'p2' },
    ]);
    const described = ecs.commandCalls(DescribeServicesCommand).map((c) => c.args[0].input.services);
    expect(DESCRIBE_SERVICES_BATCH).toBe(10);
    expect(described.map((names) => names?.length)).toEqual([10, 10, 5]);
    expect(described.flat()).toEqual(Array.from({ length: 25 }, (_, i) => svcName(i)));
    expect(result.ok && result.data.matched).toBe(25);
    expect(result.ok && result.data.truncated).toBe(false);
    expect(result.ok && result.data.services.map((s) => s.name)).toEqual(Array.from({ length: 25 }, (_, i) => svcName(i)));
    expect(result.ok && result.data.services[0].taskDefinition).toBe('web:7');

    ecs.reset();
    ecs.on(ListServicesCommand).resolvesOnce({ serviceArns: all.slice(10).reverse(), nextToken: 'p2' }).resolvesOnce({ serviceArns: all.slice(0, 10).reverse() });
    fakeDescribeServices();
    const searched = await listServices(target, 'prod', 'SVC-1', { ...deps, cache: createTtlCache() });
    expect(ecs.commandCalls(DescribeServicesCommand).map((c) => c.args[0].input)).toEqual([
      { cluster: 'prod', services: Array.from({ length: 10 }, (_, i) => svcName(10 + i)) },
    ]);
    expect(searched.ok && searched.data.matched).toBe(10);
  });

  it('caps at 100 services', async () => {
    const names = Array.from({ length: 230 }, (_, i) => `svc-${String(i).padStart(3, '0')}`);
    const arns = names.map((n) => arn('service', `prod/${n}`));
    ecs
      .on(ListServicesCommand)
      .resolvesOnce({ serviceArns: arns.slice(0, 100), nextToken: 'a' })
      .resolvesOnce({ serviceArns: arns.slice(100, 200), nextToken: 'b' })
      .resolvesOnce({ serviceArns: arns.slice(200) });
    fakeDescribeServices();
    const result = await listServices(target, 'prod', '', deps);
    const calls = ecs.commandCalls(DescribeServicesCommand);
    expect(calls).toHaveLength(10);
    expect(calls.flatMap((c) => c.args[0].input.services ?? [])).toEqual(names.slice(0, 100));
    expect(result.ok && result.data.matched).toBe(230);
    expect(result.ok && result.data.truncated).toBe(true);
    expect(result.ok && result.data.services).toHaveLength(100);
  });
});

describe('describeService', () => {
  it('maps deployments, events and load balancers', async () => {
    const targetGroupArn = 'arn:aws:elasticloadbalancing:eu-west-1:111122223333:targetgroup/web/73e2d6bc24d8a067';
    ecs.on(DescribeServicesCommand).resolves({
      services: [
        {
          serviceName: 'web',
          serviceArn: arn('service', 'prod/web'),
          clusterArn,
          status: 'ACTIVE',
          desiredCount: 2,
          runningCount: 2,
          pendingCount: 0,
          launchType: 'FARGATE',
          taskDefinition: arn('task-definition', 'web:42'),
          deployments: [
            {
              id: 'ecs-svc/2',
              status: 'PRIMARY',
              rolloutState: 'FAILED',
              rolloutStateReason: 'ECS deployment circuit breaker: tasks failed to start.',
              taskDefinition: arn('task-definition', 'web:42'),
              desiredCount: 2,
              runningCount: 0,
              pendingCount: 0,
              failedTasks: 4,
              createdAt: new Date('2026-09-17T09:00:00Z'),
              updatedAt: new Date('2026-09-17T09:20:00Z'),
            },
            {
              id: 'ecs-svc/1',
              status: 'ACTIVE',
              rolloutState: 'COMPLETED',
              taskDefinition: arn('task-definition', 'web:41'),
              desiredCount: 2,
              runningCount: 2,
              pendingCount: 0,
              failedTasks: 0,
              createdAt: new Date('2026-09-16T09:00:00Z'),
              updatedAt: new Date('2026-09-16T09:20:00Z'),
            },
          ],
          events: Array.from({ length: 25 }, (_, i) => ({
            id: `e${24 - i}`,
            createdAt: new Date(Date.parse('2026-09-17T10:00:00Z') - i * 60_000),
            message: `(service web) event ${24 - i}`,
          })),
          loadBalancers: [{ targetGroupArn, containerName: 'web', containerPort: 8080 }],
        },
      ],
    });
    const result = await describeService(target, 'prod', 'web', deps);
    expect(ecs.commandCalls(DescribeServicesCommand).map((c) => c.args[0].input)).toEqual([{ cluster: 'prod', services: ['web'] }]);
    if (!result.ok || !result.data) throw new Error('expected a service');
    const service = result.data;
    expect(service.primaryDeployment).toEqual({
      id: 'ecs-svc/2',
      status: 'PRIMARY',
      rolloutState: 'FAILED',
      rolloutStateReason: 'ECS deployment circuit breaker: tasks failed to start.',
      taskDefinition: 'web:42',
      desiredCount: 2,
      runningCount: 0,
      pendingCount: 0,
      failedTasks: 4,
      createdAt: Date.parse('2026-09-17T09:00:00Z'),
      updatedAt: Date.parse('2026-09-17T09:20:00Z'),
    });
    expect(service.deployments.map((d) => [d.id, d.rolloutState, d.rolloutStateReason, d.taskDefinition])).toEqual([
      ['ecs-svc/2', 'FAILED', 'ECS deployment circuit breaker: tasks failed to start.', 'web:42'],
      ['ecs-svc/1', 'COMPLETED', null, 'web:41'],
    ]);
    expect(service.events).toHaveLength(MAX_EVENTS);
    expect(MAX_EVENTS).toBe(20);
    expect(service.events[0]).toEqual({ id: 'e24', createdAt: Date.parse('2026-09-17T10:00:00Z'), message: '(service web) event 24' });
    expect(service.loadBalancers).toEqual([{ targetGroupArn, containerName: 'web', containerPort: 8080 }]);
    expect([service.name, service.cluster, service.launchType, service.taskDefinitionArn, service.taskDefinition]).toEqual([
      'web',
      'prod',
      'FARGATE',
      arn('task-definition', 'web:42'),
      'web:42',
    ]);
  });

  it('returns null for a missing service or cluster', async () => {
    ecs.on(DescribeServicesCommand).resolves({ services: [], failures: [{ arn: arn('service', 'prod/web'), reason: 'MISSING' }] });
    expect(await describeService(target, 'prod', 'web', deps)).toEqual({ ok: true, data: null });

    ecs.reset();
    ecs.on(DescribeServicesCommand).rejects(Object.assign(new Error('no'), { name: 'ClusterNotFoundException' }));
    expect(await describeService(target, 'gone', 'web', deps)).toEqual({ ok: true, data: null });

    ecs.reset();
    ecs.on(DescribeServicesCommand).rejects(Object.assign(new Error('no'), { name: 'AccessDeniedException' }));
    expect(await describeService(target, 'prod', 'api', deps)).toEqual({ ok: false, reason: 'denied', code: 'AccessDeniedException', action: 'ecs:DescribeServices' });
  });
});

describe('listServiceTasks', () => {
  it('lists running tasks, newest first', async () => {
    const a1 = 'arn:aws:ecs:eu-west-1:111122223333:task/prod/0f9a1111';
    const a2 = 'arn:aws:ecs:eu-west-1:111122223333:task/prod/0f9a2222';
    ecs.on(ListTasksCommand).resolves({ taskArns: [a1, a2] });
    const task = (taskArn: string, startedAt: string) => ({
      taskArn,
      taskDefinitionArn: arn('task-definition', 'web:42'),
      lastStatus: 'RUNNING',
      desiredStatus: 'RUNNING',
      healthStatus: 'HEALTHY' as const,
      startedAt: new Date(startedAt),
      availabilityZone: 'eu-west-1a',
      launchType: 'FARGATE' as const,
    });
    ecs.on(DescribeTasksCommand).resolves({ tasks: [task(a1, '2026-09-17T09:00:00Z'), task(a2, '2026-09-17T09:30:00Z')] });

    const result = await listServiceTasks(target, 'prod', 'web', deps);
    expect(ecs.commandCalls(ListTasksCommand).map((c) => c.args[0].input)).toEqual([{ cluster: 'prod', serviceName: 'web', desiredStatus: 'RUNNING', maxResults: MAX_TASKS }]);
    expect(ecs.commandCalls(DescribeTasksCommand).map((c) => c.args[0].input)).toEqual([{ cluster: 'prod', tasks: [a1, a2] }]);
    expect(result).toEqual({
      ok: true,
      data: [
        { id: '0f9a2222', arn: a2, taskDefinition: 'web:42', lastStatus: 'RUNNING', desiredStatus: 'RUNNING', healthStatus: 'HEALTHY', startedAt: Date.parse('2026-09-17T09:30:00Z'), availabilityZone: 'eu-west-1a', launchType: 'FARGATE' },
        { id: '0f9a1111', arn: a1, taskDefinition: 'web:42', lastStatus: 'RUNNING', desiredStatus: 'RUNNING', healthStatus: 'HEALTHY', startedAt: Date.parse('2026-09-17T09:00:00Z'), availabilityZone: 'eu-west-1a', launchType: 'FARGATE' },
      ],
    });
  });

  it('does not describe when no task runs', async () => {
    ecs.on(ListTasksCommand).resolves({ taskArns: [] });
    expect(await listServiceTasks(target, 'prod', 'web', deps)).toEqual({ ok: true, data: [] });
    expect(ecs.commandCalls(DescribeTasksCommand)).toHaveLength(0);
  });
});

describe('taskDefinitionLogs', () => {
  it('keeps awslogs containers only', async () => {
    const taskDefinition = arn('task-definition', 'web:42');
    ecs.on(DescribeTaskDefinitionCommand).resolves({
      taskDefinition: {
        containerDefinitions: [
          {
            name: 'web',
            logConfiguration: { logDriver: 'awslogs', options: { 'awslogs-group': '/ecs/web', 'awslogs-region': 'eu-west-1', 'awslogs-stream-prefix': 'web' } },
          },
          { name: 'log_router', logConfiguration: { logDriver: 'awsfirelens' } },
        ],
      },
    });
    const result = await taskDefinitionLogs(target, taskDefinition, deps);
    expect(ecs.commandCalls(DescribeTaskDefinitionCommand).map((c) => c.args[0].input)).toEqual([{ taskDefinition }]);
    expect(result).toEqual({ ok: true, data: [{ container: 'web', logGroup: '/ecs/web', region: 'eu-west-1', streamPrefix: 'web' }] });
  });
});

describe('query builders', () => {
  it('builds service utilization and task count queries', () => {
    const dimensions = { ClusterName: 'prod', ServiceName: 'web' };
    expect(serviceUtilizationQueries('prod', 'web', 's0')).toEqual([
      { id: 's0cpu', namespace: 'AWS/ECS', metricName: 'CPUUtilization', dimensions, stat: 'Average' },
      { id: 's0mem', namespace: 'AWS/ECS', metricName: 'MemoryUtilization', dimensions, stat: 'Average' },
    ]);
    expect(serviceTaskCountQueries('prod', 'web', 's0')).toEqual([
      { id: 's0running', namespace: 'ECS/ContainerInsights', metricName: 'RunningTaskCount', dimensions, stat: 'Average' },
      { id: 's0desired', namespace: 'ECS/ContainerInsights', metricName: 'DesiredTaskCount', dimensions, stat: 'Average' },
    ]);
    expect(taskDefinitionLabel('arn:aws:ecs:eu-west-1:111122223333:task-definition/web:42')).toBe('web:42');
  });
});
