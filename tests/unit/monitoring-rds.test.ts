import { DescribeDBClustersCommand, DescribeDBInstancesCommand, RDSClient, type DBInstance } from '@aws-sdk/client-rds';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createTtlCache } from '@/lib/monitoring/cache';
import { instanceMemoryGiB } from '@/lib/monitoring/instance-memory';
import { RDS_METRIC_UNITS, detailMetrics, findInstance, listDatabases, rdsMetricQueries, type DbRole, type RdsInstance } from '@/lib/monitoring/rds';

const rds = mockClient(RDSClient);
const target = { connectionId: 'abc123def456', region: 'eu-west-1', credentials: { accessKeyId: 'ASIA', secretAccessKey: 's' } };
let deps: { cache: ReturnType<typeof createTtlCache>; log: Mock };

beforeEach(() => {
  rds.reset();
  deps = { cache: createTtlCache(), log: vi.fn() };
});

const ordersCluster = {
  DBClusterIdentifier: 'orders',
  Engine: 'aurora-mysql',
  Status: 'available',
  DBClusterMembers: [
    { DBInstanceIdentifier: 'orders-1', IsClusterWriter: true },
    { DBInstanceIdentifier: 'orders-2', IsClusterWriter: false },
  ],
};

const auroraInstance = (id: string, resourceId: string): DBInstance => ({
  DBInstanceIdentifier: id,
  DBInstanceArn: `arn:aws:rds:eu-west-1:111122223333:db:${id}`,
  DbiResourceId: resourceId,
  Engine: 'aurora-mysql',
  EngineVersion: '8.0.mysql_aurora.3.08.0',
  DBInstanceClass: 'db.r6g.large',
  DBInstanceStatus: 'available',
  AvailabilityZone: 'eu-west-1a',
  DBClusterIdentifier: 'orders',
  PerformanceInsightsEnabled: true,
});

const legacy: DBInstance = {
  DBInstanceIdentifier: 'legacy',
  Engine: 'mysql',
  EngineVersion: '8.0.39',
  DBInstanceClass: 'db.t3.medium',
  DBInstanceStatus: 'available',
  PerformanceInsightsEnabled: false,
};

describe('instanceMemoryGiB', () => {
  it.each([
    ['db.r6g.large', 16],
    ['db.r8g.xlarge', 32],
    ['db.r5.24xlarge', 768],
    ['db.m6g.2xlarge', 32],
    ['db.m7i.large', 8],
    ['db.t3.medium', 4],
    ['db.t4g.micro', 1],
    ['db.serverless', null],
    ['db.x2g.large', null],
    ['db.r6g.metal', null],
    ['nonsense', null],
  ])('%s → %s', (instanceClass, expected) => {
    expect(instanceMemoryGiB(instanceClass)).toBe(expected);
  });
});

describe('listDatabases', () => {
  it('paginates and assigns roles', async () => {
    rds.on(DescribeDBClustersCommand).resolvesOnce({ DBClusters: [ordersCluster], Marker: 'm' }).resolvesOnce({ DBClusters: [] });
    rds.on(DescribeDBInstancesCommand).resolves({ DBInstances: [auroraInstance('orders-2', 'db-ORDERS2'), legacy, auroraInstance('orders-1', 'db-ORDERS1')] });

    const result = await listDatabases(target, deps);
    expect(rds.commandCalls(DescribeDBClustersCommand).map((c) => c.args[0].input)).toEqual([{ MaxRecords: 100 }, { MaxRecords: 100, Marker: 'm' }]);
    expect(rds.commandCalls(DescribeDBInstancesCommand).map((c) => c.args[0].input)).toEqual([{ MaxRecords: 100 }]);
    if (!result.ok) throw new Error('expected success');
    expect(result.data.instances.map((i) => [i.id, i.role, i.aurora, i.memoryGiB, i.performanceInsights])).toEqual([
      ['legacy', 'standalone', false, 4, false],
      ['orders-1', 'writer', true, 16, true],
      ['orders-2', 'reader', true, 16, true],
    ]);
    expect(result.data.instances[1]).toEqual({
      id: 'orders-1',
      arn: 'arn:aws:rds:eu-west-1:111122223333:db:orders-1',
      resourceId: 'db-ORDERS1',
      engine: 'aurora-mysql',
      engineVersion: '8.0.mysql_aurora.3.08.0',
      instanceClass: 'db.r6g.large',
      status: 'available',
      availabilityZone: 'eu-west-1a',
      clusterId: 'orders',
      role: 'writer',
      aurora: true,
      performanceInsights: true,
      memoryGiB: 16,
    });
    expect(result.data.clusters).toEqual([{ id: 'orders', engine: 'aurora-mysql', status: 'available', writer: 'orders-1', readers: ['orders-2'] }]);
  });

  it('treats a read replica without a cluster as a reader', async () => {
    rds.on(DescribeDBClustersCommand).resolves({ DBClusters: [] });
    rds.on(DescribeDBInstancesCommand).resolves({ DBInstances: [legacy, { ...legacy, DBInstanceIdentifier: 'legacy-replica', ReadReplicaSourceDBInstanceIdentifier: 'legacy' }] });
    const result = await listDatabases(target, deps);
    expect(result.ok && result.data.instances.map((i) => [i.id, i.role, i.clusterId])).toEqual([
      ['legacy', 'standalone', null],
      ['legacy-replica', 'reader', null],
    ]);
  });

  it('returns the first failure', async () => {
    rds.on(DescribeDBClustersCommand).resolves({ DBClusters: [] });
    rds.on(DescribeDBInstancesCommand).rejects(Object.assign(new Error('no'), { name: 'AccessDenied' }));
    expect(await listDatabases(target, deps)).toEqual({ ok: false, reason: 'denied', code: 'AccessDenied', action: 'rds:DescribeDBInstances' });
  });
});

describe('findInstance', () => {
  it('describes the instance, then its cluster', async () => {
    rds.on(DescribeDBInstancesCommand).resolves({ DBInstances: [auroraInstance('orders-2', 'db-ORDERS2')] });
    rds.on(DescribeDBClustersCommand).resolves({ DBClusters: [ordersCluster] });
    const result = await findInstance(target, 'orders-2', deps);
    expect(rds.commandCalls(DescribeDBInstancesCommand).map((c) => c.args[0].input)).toEqual([{ DBInstanceIdentifier: 'orders-2' }]);
    expect(rds.commandCalls(DescribeDBClustersCommand).map((c) => c.args[0].input)).toEqual([{ DBClusterIdentifier: 'orders' }]);
    expect(result).toEqual({
      ok: true,
      data: {
        instance: expect.objectContaining({ id: 'orders-2', role: 'reader', resourceId: 'db-ORDERS2', clusterId: 'orders' }),
        cluster: { id: 'orders', engine: 'aurora-mysql', status: 'available', writer: 'orders-1', readers: ['orders-2'] },
      },
    });
  });

  it('skips the cluster call for a standalone instance', async () => {
    rds.on(DescribeDBInstancesCommand).resolves({ DBInstances: [legacy] });
    const result = await findInstance(target, 'legacy', deps);
    expect(rds.commandCalls(DescribeDBClustersCommand)).toHaveLength(0);
    expect(result).toEqual({ ok: true, data: { instance: expect.objectContaining({ id: 'legacy', role: 'standalone' }), cluster: null } });
  });

  it('keeps the instance when its cluster is gone', async () => {
    rds.on(DescribeDBInstancesCommand).resolves({ DBInstances: [auroraInstance('orders-2', 'db-ORDERS2')] });
    rds.on(DescribeDBClustersCommand).rejects(Object.assign(new Error('gone'), { name: 'DBClusterNotFoundFault' }));
    const result = await findInstance(target, 'orders-2', deps);
    expect(result).toEqual({ ok: true, data: { instance: expect.objectContaining({ id: 'orders-2', role: 'standalone' }), cluster: null } });
  });

  it('returns null for a missing instance', async () => {
    rds.on(DescribeDBInstancesCommand).rejects(Object.assign(new Error('missing'), { name: 'DBInstanceNotFoundFault' }));
    expect(await findInstance(target, 'ghost', deps)).toEqual({ ok: true, data: null });
    expect(deps.log).not.toHaveBeenCalled();
  });

  it('reports a denied call', async () => {
    rds.on(DescribeDBInstancesCommand).rejects(Object.assign(new Error('no'), { name: 'AccessDenied' }));
    expect(await findInstance(target, 'orders-2', deps)).toEqual({ ok: false, reason: 'denied', code: 'AccessDenied', action: 'rds:DescribeDBInstances' });
  });
});

describe('metrics', () => {
  const instance = (role: DbRole, aurora: boolean): RdsInstance => ({
    id: 'orders-2',
    arn: null,
    resourceId: null,
    engine: aurora ? 'aurora-mysql' : 'mysql',
    engineVersion: null,
    instanceClass: 'db.r6g.large',
    status: 'available',
    availabilityZone: null,
    clusterId: aurora ? 'orders' : null,
    role,
    aurora,
    performanceInsights: false,
    memoryGiB: 16,
  });
  const base = ['CPUUtilization', 'DatabaseConnections', 'FreeableMemory', 'ReadIOPS', 'WriteIOPS', 'ReadLatency', 'WriteLatency'];

  it('builds AWS/RDS queries per instance', () => {
    const dimensions = { DBInstanceIdentifier: 'orders-2' };
    expect(rdsMetricQueries('orders-2', ['CPUUtilization', 'AuroraReplicaLag'], 'm')).toEqual([
      { id: 'mCPUUtilization', namespace: 'AWS/RDS', metricName: 'CPUUtilization', dimensions, stat: 'Average' },
      { id: 'mAuroraReplicaLag', namespace: 'AWS/RDS', metricName: 'AuroraReplicaLag', dimensions, stat: 'Average' },
    ]);
  });

  it('adds replica lag for Aurora readers only', () => {
    expect(detailMetrics(instance('reader', true))).toEqual([...base, 'AuroraReplicaLag']);
    expect(detailMetrics(instance('writer', true))).toEqual(base);
    expect(detailMetrics(instance('standalone', false))).toEqual(base);
    expect(detailMetrics(instance('reader', false))).toEqual(base);
  });

  it('knows the unit of each metric', () => {
    expect(RDS_METRIC_UNITS).toEqual({
      CPUUtilization: 'percent',
      DatabaseConnections: 'count',
      FreeableMemory: 'bytes',
      ReadIOPS: 'rate',
      WriteIOPS: 'rate',
      ReadLatency: 'seconds',
      WriteLatency: 'seconds',
      AuroraReplicaLag: 'milliseconds',
    });
  });
});
