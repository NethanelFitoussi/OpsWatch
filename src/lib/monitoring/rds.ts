import 'server-only';
import { DescribeDBClustersCommand, DescribeDBInstancesCommand, RDSClient, type DBCluster, type DBInstance } from '@aws-sdk/client-rds';
import { clientConfig } from '../aws/client-config';
import { sendWithTimeout } from '../aws/timeout';
import { describeCall, describeTimeout, type AwsTarget, type MonitoringDeps } from './call';
import { instanceMemoryGiB } from './instance-memory';
import type { MetricQuery } from './metrics';
import type { MonitoringResult } from './result';
import type { MetricUnit } from './shared/format';

export type DbRole = 'writer' | 'reader' | 'standalone';
export type RdsInstance = {
  id: string;
  arn: string | null;
  resourceId: string | null;
  engine: string;
  engineVersion: string | null;
  instanceClass: string;
  status: string;
  availabilityZone: string | null;
  clusterId: string | null;
  role: DbRole;
  aurora: boolean;
  performanceInsights: boolean;
  memoryGiB: number | null;
};
export type RdsCluster = { id: string; engine: string; status: string; writer: string | null; readers: string[] };
export type RdsMetric =
  | 'CPUUtilization'
  | 'DatabaseConnections'
  | 'FreeableMemory'
  | 'ReadIOPS'
  | 'WriteIOPS'
  | 'ReadLatency'
  | 'WriteLatency'
  | 'AuroraReplicaLag';

export const RDS_METRIC_UNITS: Record<RdsMetric, MetricUnit> = {
  CPUUtilization: 'percent',
  DatabaseConnections: 'count',
  FreeableMemory: 'bytes',
  ReadIOPS: 'rate',
  WriteIOPS: 'rate',
  ReadLatency: 'seconds',
  WriteLatency: 'seconds',
  AuroraReplicaLag: 'milliseconds',
};

const BASE_METRICS: RdsMetric[] = ['CPUUtilization', 'DatabaseConnections', 'FreeableMemory', 'ReadIOPS', 'WriteIOPS', 'ReadLatency', 'WriteLatency'];

const MAX_PAGES = 50;
const PAGE_SIZE = 100;

const byName = (a: string, b: string) => a.localeCompare(b, 'en');
const rdsClient = (target: AwsTarget) => new RDSClient(clientConfig(target.region, target.credentials));
const errorName = (error: unknown) => (error as { name?: string }).name;

function toCluster(c: DBCluster): RdsCluster {
  const members = c.DBClusterMembers ?? [];
  return {
    id: c.DBClusterIdentifier ?? '',
    engine: c.Engine ?? '',
    status: c.Status ?? '',
    writer: members.find((m) => m.IsClusterWriter)?.DBInstanceIdentifier ?? null,
    readers: members.filter((m) => !m.IsClusterWriter).map((m) => m.DBInstanceIdentifier ?? '').sort(byName),
  };
}

function toInstance(i: DBInstance, cluster: RdsCluster | null): RdsInstance {
  const id = i.DBInstanceIdentifier ?? '';
  const engine = i.Engine ?? '';
  const instanceClass = i.DBInstanceClass ?? '';
  const replicaOf = i.ReadReplicaSourceDBInstanceIdentifier;
  const role: DbRole = cluster?.writer === id ? 'writer' : cluster?.readers.includes(id) || replicaOf ? 'reader' : 'standalone';
  return {
    id,
    arn: i.DBInstanceArn ?? null,
    resourceId: i.DbiResourceId ?? null,
    engine,
    engineVersion: i.EngineVersion ?? null,
    instanceClass,
    status: i.DBInstanceStatus ?? '',
    availabilityZone: i.AvailabilityZone ?? null,
    clusterId: cluster?.id ?? i.DBClusterIdentifier ?? null,
    role,
    aurora: engine.startsWith('aurora'),
    performanceInsights: i.PerformanceInsightsEnabled === true,
    memoryGiB: instanceMemoryGiB(instanceClass),
  };
}

async function paginate<T>(load: (marker: string | undefined) => Promise<{ items: T[]; marker: string | undefined }>): Promise<T[]> {
  const all: T[] = [];
  let marker: string | undefined;
  let pages = 0;
  do {
    const { items, marker: next } = await load(marker);
    all.push(...items);
    marker = next;
    pages += 1;
  } while (marker && pages < MAX_PAGES);
  return all;
}

function describeClusters(target: AwsTarget, deps: MonitoringDeps) {
  return describeCall(target, 'rds:DescribeDBClusters', {}, async () => {
    const client = rdsClient(target);
    const clusters = await paginate<DBCluster>(async (Marker) => {
      const out = await sendWithTimeout(client, new DescribeDBClustersCommand({ MaxRecords: PAGE_SIZE, ...(Marker ? { Marker } : {}) }), describeTimeout(deps));
      return { items: out.DBClusters ?? [], marker: out.Marker };
    });
    return clusters.map(toCluster);
  }, deps);
}

function describeInstances(target: AwsTarget, deps: MonitoringDeps) {
  return describeCall(target, 'rds:DescribeDBInstances', {}, async () => {
    const client = rdsClient(target);
    return paginate<DBInstance>(async (Marker) => {
      const out = await sendWithTimeout(client, new DescribeDBInstancesCommand({ MaxRecords: PAGE_SIZE, ...(Marker ? { Marker } : {}) }), describeTimeout(deps));
      return { items: out.DBInstances ?? [], marker: out.Marker };
    });
  }, deps);
}

/** Every RDS/Aurora instance of the region with its cluster role; instances are grouped by cluster, writer first. */
export async function listDatabases(target: AwsTarget, deps: MonitoringDeps = {}): Promise<MonitoringResult<{ clusters: RdsCluster[]; instances: RdsInstance[] }>> {
  const [clusters, instances] = await Promise.all([describeClusters(target, deps), describeInstances(target, deps)]);
  if (!clusters.ok) return clusters;
  if (!instances.ok) return instances;
  const byId = new Map(clusters.data.map((c) => [c.id, c]));
  const ROLE_ORDER: Record<DbRole, number> = { writer: 0, reader: 1, standalone: 2 };
  const mapped = instances.data
    .map((i) => toInstance(i, i.DBClusterIdentifier ? byId.get(i.DBClusterIdentifier) ?? null : null))
    .sort((a, b) => byName(a.clusterId ?? a.id, b.clusterId ?? b.id) || ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || byName(a.id, b.id));
  return { ok: true, data: { clusters: clusters.data.sort((a, b) => byName(a.id, b.id)), instances: mapped } };
}

function findCluster(target: AwsTarget, clusterId: string, deps: MonitoringDeps) {
  return describeCall(target, 'rds:DescribeDBClusters', { clusterId }, async () => {
    try {
      const out = await sendWithTimeout(rdsClient(target), new DescribeDBClustersCommand({ DBClusterIdentifier: clusterId }), describeTimeout(deps));
      const cluster = out.DBClusters?.[0];
      return cluster ? toCluster(cluster) : null;
    } catch (error) {
      if (errorName(error) === 'DBClusterNotFoundFault') return null;
      throw error;
    }
  }, deps);
}

/** One instance with its cluster, or `null` when the region has no instance with that id. */
export async function findInstance(
  target: AwsTarget,
  id: string,
  deps: MonitoringDeps = {},
): Promise<MonitoringResult<{ instance: RdsInstance; cluster: RdsCluster | null } | null>> {
  const found = await describeCall(target, 'rds:DescribeDBInstances', { id }, async () => {
    try {
      const out = await sendWithTimeout(rdsClient(target), new DescribeDBInstancesCommand({ DBInstanceIdentifier: id }), describeTimeout(deps));
      return out.DBInstances?.[0] ?? null;
    } catch (error) {
      if (errorName(error) === 'DBInstanceNotFoundFault') return null;
      throw error;
    }
  }, deps);
  if (!found.ok) return found;
  if (!found.data) return { ok: true, data: null };
  const clusterId = found.data.DBClusterIdentifier;
  if (!clusterId) return { ok: true, data: { instance: toInstance(found.data, null), cluster: null } };
  const cluster = await findCluster(target, clusterId, deps);
  if (!cluster.ok) return cluster;
  return { ok: true, data: { instance: toInstance(found.data, cluster.data), cluster: cluster.data } };
}

export function rdsMetricQueries(instanceId: string, metrics: readonly RdsMetric[], idPrefix: string): MetricQuery[] {
  const dimensions = { DBInstanceIdentifier: instanceId };
  return metrics.map((metricName) => ({ id: `${idPrefix}${metricName}`, namespace: 'AWS/RDS', metricName, dimensions, stat: 'Average' }));
}

/** Replica lag only exists on Aurora readers. */
export function detailMetrics(instance: RdsInstance): RdsMetric[] {
  return instance.aurora && instance.role === 'reader' ? [...BASE_METRICS, 'AuroraReplicaLag'] : [...BASE_METRICS];
}
