import 'server-only';
import {
  DescribeClustersCommand,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  DescribeTasksCommand,
  ECSClient,
  ListClustersCommand,
  ListServicesCommand,
  ListTasksCommand,
  type Deployment,
  type Service,
  type Task,
} from '@aws-sdk/client-ecs';
import { clientConfig } from '../aws/client-config';
import { sendWithTimeout } from '../aws/timeout';
import { chunk, describeCall, describeTimeout, type AwsTarget, type MonitoringDeps } from './call';
import type { MetricQuery } from './metrics';
import type { MonitoringResult } from './result';

export type EcsCluster = { name: string; arn: string; status: string; containerInsights: boolean; activeServices: number; runningTasks: number; pendingTasks: number };
export type EcsDeployment = {
  id: string;
  status: string;
  rolloutState: string | null;
  rolloutStateReason: string | null;
  taskDefinition: string;
  desiredCount: number;
  runningCount: number;
  pendingCount: number;
  failedTasks: number;
  createdAt: number | null;
  updatedAt: number | null;
};
type EcsServiceEvent = { id: string; createdAt: number | null; message: string };
export type EcsService = {
  name: string;
  arn: string;
  cluster: string;
  status: string;
  desiredCount: number;
  runningCount: number;
  pendingCount: number;
  launchType: string | null;
  taskDefinitionArn: string;
  taskDefinition: string;
  deployments: EcsDeployment[];
  primaryDeployment: EcsDeployment | null;
  events: EcsServiceEvent[];
  loadBalancers: { targetGroupArn: string; containerName: string | null; containerPort: number | null }[];
};
export type EcsTask = {
  id: string;
  arn: string;
  taskDefinition: string;
  lastStatus: string;
  desiredStatus: string;
  healthStatus: string | null;
  startedAt: number | null;
  availabilityZone: string | null;
  launchType: string | null;
};
export type AwslogsTarget = { container: string; logGroup: string; region: string | null; streamPrefix: string | null };

export const MAX_SERVICES = 100;
export const DESCRIBE_SERVICES_BATCH = 10;
export const MAX_EVENTS = 20;
export const MAX_TASKS = 100;

const MAX_SERVICE_ARNS = 2000;
const MAX_CLUSTER_PAGES = 20;
const DESCRIBE_CLUSTERS_BATCH = 100;

const lastSegment = (arn: string) => arn.slice(arn.lastIndexOf('/') + 1);
/** `…:task-definition/web:42` → `web:42`. */
export const taskDefinitionLabel = (arn: string) => lastSegment(arn);
const ms = (d: Date | undefined) => d?.getTime() ?? null;
const byName = (a: string, b: string) => a.localeCompare(b, 'en');
const isClusterNotFound = (error: unknown) => (error as { name?: string }).name === 'ClusterNotFoundException';
const ecsClient = (target: AwsTarget) => new ECSClient(clientConfig(target.region, target.credentials));

function toDeployment(d: Deployment): EcsDeployment {
  return {
    id: d.id ?? '',
    status: d.status ?? '',
    rolloutState: d.rolloutState ?? null,
    rolloutStateReason: d.rolloutStateReason ?? null,
    taskDefinition: taskDefinitionLabel(d.taskDefinition ?? ''),
    desiredCount: d.desiredCount ?? 0,
    runningCount: d.runningCount ?? 0,
    pendingCount: d.pendingCount ?? 0,
    failedTasks: d.failedTasks ?? 0,
    createdAt: ms(d.createdAt),
    updatedAt: ms(d.updatedAt),
  };
}

function toService(s: Service, cluster: string): EcsService {
  const deployments = (s.deployments ?? []).map(toDeployment);
  const taskDefinitionArn = s.taskDefinition ?? '';
  return {
    name: s.serviceName ?? '',
    arn: s.serviceArn ?? '',
    cluster,
    status: s.status ?? '',
    desiredCount: s.desiredCount ?? 0,
    runningCount: s.runningCount ?? 0,
    pendingCount: s.pendingCount ?? 0,
    launchType: s.launchType ?? null,
    taskDefinitionArn,
    taskDefinition: taskDefinitionLabel(taskDefinitionArn),
    deployments,
    primaryDeployment: deployments.find((d) => d.status === 'PRIMARY') ?? null,
    // AWS returns events newest first.
    events: (s.events ?? []).slice(0, MAX_EVENTS).map((e) => ({ id: e.id ?? '', createdAt: ms(e.createdAt), message: e.message ?? '' })),
    loadBalancers: (s.loadBalancers ?? [])
      .filter((lb) => lb.targetGroupArn)
      .map((lb) => ({ targetGroupArn: lb.targetGroupArn ?? '', containerName: lb.containerName ?? null, containerPort: lb.containerPort ?? null })),
  };
}

function toTask(t: Task): EcsTask {
  const arn = t.taskArn ?? '';
  return {
    id: lastSegment(arn),
    arn,
    taskDefinition: taskDefinitionLabel(t.taskDefinitionArn ?? ''),
    lastStatus: t.lastStatus ?? '',
    desiredStatus: t.desiredStatus ?? '',
    healthStatus: t.healthStatus ?? null,
    startedAt: ms(t.startedAt),
    availabilityZone: t.availabilityZone ?? null,
    launchType: t.launchType ?? null,
  };
}

function listClusterArns(target: AwsTarget, deps: MonitoringDeps) {
  return describeCall(target, 'ecs:ListClusters', {}, async () => {
    const client = ecsClient(target);
    const arns: string[] = [];
    let nextToken: string | undefined;
    let pages = 0;
    do {
      const out = await sendWithTimeout(client, new ListClustersCommand({ maxResults: 100, ...(nextToken ? { nextToken } : {}) }), describeTimeout(deps));
      arns.push(...(out.clusterArns ?? []));
      nextToken = out.nextToken;
      pages += 1;
    } while (nextToken && pages < MAX_CLUSTER_PAGES);
    return arns;
  }, deps);
}

export async function listClusters(target: AwsTarget, deps: MonitoringDeps = {}): Promise<MonitoringResult<EcsCluster[]>> {
  const arns = await listClusterArns(target, deps);
  if (!arns.ok) return arns;
  if (arns.data.length === 0) return { ok: true, data: [] };
  return describeCall(target, 'ecs:DescribeClusters', { arns: arns.data }, async () => {
    const client = ecsClient(target);
    const clusters: EcsCluster[] = [];
    for (const batch of chunk(arns.data, DESCRIBE_CLUSTERS_BATCH)) {
      const out = await sendWithTimeout(client, new DescribeClustersCommand({ clusters: batch, include: ['SETTINGS'] }), describeTimeout(deps));
      for (const c of out.clusters ?? []) {
        clusters.push({
          name: c.clusterName ?? '',
          arn: c.clusterArn ?? '',
          status: c.status ?? '',
          containerInsights: (c.settings ?? []).some((x) => x.name === 'containerInsights' && (x.value === 'enabled' || x.value === 'enhanced')),
          activeServices: c.activeServicesCount ?? 0,
          runningTasks: c.runningTasksCount ?? 0,
          pendingTasks: c.pendingTasksCount ?? 0,
        });
      }
    }
    return clusters.sort((a, b) => byName(a.name, b.name));
  }, deps);
}

function listServiceArns(target: AwsTarget, cluster: string, deps: MonitoringDeps) {
  return describeCall(target, 'ecs:ListServices', { cluster }, async () => {
    const client = ecsClient(target);
    const arns: string[] = [];
    let nextToken: string | undefined;
    try {
      do {
        const out = await sendWithTimeout(client, new ListServicesCommand({ cluster, maxResults: 100, ...(nextToken ? { nextToken } : {}) }), describeTimeout(deps));
        arns.push(...(out.serviceArns ?? []));
        nextToken = out.nextToken;
      } while (nextToken && arns.length < MAX_SERVICE_ARNS);
    } catch (error) {
      if (isClusterNotFound(error)) return [];
      throw error;
    }
    return arns;
  }, deps);
}

function describeServicesBatch(target: AwsTarget, cluster: string, names: string[], deps: MonitoringDeps) {
  return describeCall(target, 'ecs:DescribeServices', { cluster, names }, async () => {
    const client = ecsClient(target);
    try {
      const out = await sendWithTimeout(client, new DescribeServicesCommand({ cluster, services: names }), describeTimeout(deps));
      return (out.services ?? []).map((s) => toService(s, cluster));
    } catch (error) {
      if (isClusterNotFound(error)) return [];
      throw error;
    }
  }, deps);
}

/** Filters service names by `search` before describing, so at most MAX_SERVICES services are described. */
export async function listServices(
  target: AwsTarget,
  cluster: string,
  search: string,
  deps: MonitoringDeps = {},
): Promise<MonitoringResult<{ services: EcsService[]; matched: number; truncated: boolean }>> {
  const arns = await listServiceArns(target, cluster, deps);
  if (!arns.ok) return arns;
  const needle = search.trim().toLowerCase();
  const names = arns.data.map(lastSegment).filter((n) => n.toLowerCase().includes(needle)).sort(byName);
  const shown = names.slice(0, MAX_SERVICES);
  const batches = await Promise.all(chunk(shown, DESCRIBE_SERVICES_BATCH).map((batch) => describeServicesBatch(target, cluster, batch, deps)));
  const failure = batches.find((b) => !b.ok);
  if (failure && !failure.ok) return failure;
  const services = batches.flatMap((b) => (b.ok ? b.data : [])).sort((a, b) => byName(a.name, b.name));
  return { ok: true, data: { services, matched: names.length, truncated: names.length > MAX_SERVICES } };
}

export async function describeService(target: AwsTarget, cluster: string, service: string, deps: MonitoringDeps = {}): Promise<MonitoringResult<EcsService | null>> {
  // A missing service comes back in `failures`, which leaves `services` empty.
  const result = await describeServicesBatch(target, cluster, [service], deps);
  return result.ok ? { ok: true, data: result.data[0] ?? null } : result;
}

function listTaskArns(target: AwsTarget, cluster: string, service: string, deps: MonitoringDeps) {
  return describeCall(target, 'ecs:ListTasks', { cluster, service }, async () => {
    const client = ecsClient(target);
    const arns: string[] = [];
    let nextToken: string | undefined;
    try {
      do {
        const out = await sendWithTimeout(
          client,
          new ListTasksCommand({ cluster, serviceName: service, desiredStatus: 'RUNNING', maxResults: 100, ...(nextToken ? { nextToken } : {}) }),
          describeTimeout(deps),
        );
        arns.push(...(out.taskArns ?? []));
        nextToken = out.nextToken;
      } while (nextToken && arns.length < MAX_TASKS);
    } catch (error) {
      if (isClusterNotFound(error)) return [];
      throw error;
    }
    return arns.slice(0, MAX_TASKS);
  }, deps);
}

export async function listServiceTasks(target: AwsTarget, cluster: string, service: string, deps: MonitoringDeps = {}): Promise<MonitoringResult<EcsTask[]>> {
  const arns = await listTaskArns(target, cluster, service, deps);
  if (!arns.ok) return arns;
  if (arns.data.length === 0) return { ok: true, data: [] };
  return describeCall(target, 'ecs:DescribeTasks', { cluster, arns: arns.data }, async () => {
    const out = await sendWithTimeout(ecsClient(target), new DescribeTasksCommand({ cluster, tasks: arns.data }), describeTimeout(deps));
    return (out.tasks ?? []).map(toTask).sort((a, b) => (b.startedAt ?? -Infinity) - (a.startedAt ?? -Infinity));
  }, deps);
}

export function taskDefinitionLogs(target: AwsTarget, taskDefinitionArn: string, deps: MonitoringDeps = {}): Promise<MonitoringResult<AwslogsTarget[]>> {
  return describeCall(target, 'ecs:DescribeTaskDefinition', { taskDefinitionArn }, async () => {
    const out = await sendWithTimeout(ecsClient(target), new DescribeTaskDefinitionCommand({ taskDefinition: taskDefinitionArn }), describeTimeout(deps));
    return (out.taskDefinition?.containerDefinitions ?? []).flatMap((c): AwslogsTarget[] => {
      const config = c.logConfiguration;
      const logGroup = config?.logDriver === 'awslogs' ? config.options?.['awslogs-group'] : undefined;
      if (!logGroup) return [];
      return [{ container: c.name ?? '', logGroup, region: config?.options?.['awslogs-region'] ?? null, streamPrefix: config?.options?.['awslogs-stream-prefix'] ?? null }];
    });
  }, deps);
}

const serviceDimensions = (cluster: string, service: string) => ({ ClusterName: cluster, ServiceName: service });

export function serviceUtilizationQueries(cluster: string, service: string, idPrefix: string): MetricQuery[] {
  const dimensions = serviceDimensions(cluster, service);
  return [
    { id: `${idPrefix}cpu`, namespace: 'AWS/ECS', metricName: 'CPUUtilization', dimensions, stat: 'Average' },
    { id: `${idPrefix}mem`, namespace: 'AWS/ECS', metricName: 'MemoryUtilization', dimensions, stat: 'Average' },
  ];
}

export function serviceTaskCountQueries(cluster: string, service: string, idPrefix: string): MetricQuery[] {
  const dimensions = serviceDimensions(cluster, service);
  return [
    { id: `${idPrefix}running`, namespace: 'ECS/ContainerInsights', metricName: 'RunningTaskCount', dimensions, stat: 'Average' },
    { id: `${idPrefix}desired`, namespace: 'ECS/ContainerInsights', metricName: 'DesiredTaskCount', dimensions, stat: 'Average' },
  ];
}
