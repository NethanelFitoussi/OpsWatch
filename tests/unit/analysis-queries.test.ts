import { DescribeDimensionKeysCommand, PIClient } from '@aws-sdk/client-pi';
import { DescribeDBClustersCommand, DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fleetQueries, mergeFleetKeys, parseQueryGroup, parseQuerySort } from '@/lib/analysis/queries';
import { createTtlCache } from '@/lib/monitoring/cache';

const rds = mockClient(RDSClient);
const pi = mockClient(PIClient);
const target = { connectionId: 'abc123def456', region: 'eu-west-1', credentials: { accessKeyId: 'ASIA', secretAccessKey: 's' } };
const href = (i: string) => `/c/abc123def456/eu-west-1/databases/instances/${i}`;
const instance = (id: string, extra: object = {}) => ({
  DBInstanceIdentifier: id,
  Engine: 'mysql',
  DBInstanceClass: 'db.t3.medium',
  DBInstanceStatus: 'available',
  DbiResourceId: `res-${id}`,
  PerformanceInsightsEnabled: true,
  ...extra,
});

let t: number;
let deps: { cache: ReturnType<typeof createTtlCache>; log: Mock };

beforeEach(() => {
  rds.reset();
  pi.reset();
  t = Date.parse('2026-09-17T10:07:42Z');
  deps = { cache: createTtlCache({ now: () => t }), log: vi.fn() };
});

describe('mergeFleetKeys', () => {
  it('merges the same digest across instances, sums the load and keeps each origin', () => {
    const { rows, totalLoad } = mergeFleetKeys(
      [
        {
          instance: 'db-a',
          href: href('db-a'),
          keys: [{ id: 'A1', label: 'SELECT * FROM orders WHERE id = ?', load: 3 }, { id: 'B2', label: 'UPDATE stock SET qty = ?', load: 1 }],
        },
        { instance: 'db-b', href: href('db-b'), keys: [{ id: 'A1', label: 'SELECT * FROM orders WHERE id = ?', load: 1 }] },
      ],
      'load',
    );
    expect(totalLoad).toBe(5);
    expect(rows).toEqual([
      {
        key: 'A1',
        label: 'SELECT * FROM orders WHERE id = ?',
        totalLoad: 4,
        sharePercent: 80,
        instanceCount: 2,
        origins: [
          { instance: 'db-a', load: 3, sharePercent: 75, href: href('db-a') },
          { instance: 'db-b', load: 1, sharePercent: 25, href: href('db-b') },
        ],
      },
      {
        key: 'B2',
        label: 'UPDATE stock SET qty = ?',
        totalLoad: 1,
        sharePercent: 20,
        instanceCount: 1,
        origins: [{ instance: 'db-a', load: 1, sharePercent: 100, href: href('db-a') }],
      },
    ]);
  });

  it('never merges two statements that only share their truncated text', () => {
    const { rows } = mergeFleetKeys(
      [{ instance: 'db-a', href: href('db-a'), keys: [{ id: 'A1', label: 'SELECT x FROM t WHERE', load: 2 }, { id: 'A2', label: 'SELECT x FROM t WHERE', load: 1 }] }],
      'load',
    );
    expect(rows.map((r) => r.key)).toEqual(['A1', 'A2']);
  });

  it('keeps a key with no id as its own row, per instance', () => {
    const { rows } = mergeFleetKeys(
      [
        { instance: 'db-a', href: href('db-a'), keys: [{ id: null, label: 'SELECT 1', load: 2 }] },
        { instance: 'db-b', href: href('db-b'), keys: [{ id: null, label: 'SELECT 1', load: 1 }] },
      ],
      'load',
    );
    expect(rows.map((r) => [r.key, r.instanceCount])).toEqual([['no-id:db-a:0', 1], ['no-id:db-b:0', 1]]);
  });

  it('shows the label of the heaviest occurrence', () => {
    const { rows } = mergeFleetKeys(
      [
        { instance: 'db-a', href: href('db-a'), keys: [{ id: 'A1', label: 'short', load: 1 }] },
        { instance: 'db-b', href: href('db-b'), keys: [{ id: 'A1', label: 'the longer truncated text', load: 9 }] },
      ],
      'load',
    );
    expect(rows[0].label).toBe('the longer truncated text');
  });

  it('sorts by most instances affected when asked', () => {
    const input = [
      { instance: 'db-a', href: href('db-a'), keys: [{ id: 'HEAVY', label: 'h', load: 10 }, { id: 'WIDE', label: 'w', load: 1 }] },
      { instance: 'db-b', href: href('db-b'), keys: [{ id: 'WIDE', label: 'w', load: 1 }] },
      { instance: 'db-c', href: href('db-c'), keys: [{ id: 'WIDE', label: 'w', load: 1 }] },
    ];
    expect(mergeFleetKeys(input, 'load').rows.map((r) => r.key)).toEqual(['HEAVY', 'WIDE']);
    expect(mergeFleetKeys(input, 'instances').rows.map((r) => r.key)).toEqual(['WIDE', 'HEAVY']);
  });

  it('gives every row a zero share when nothing carries load', () => {
    const { rows, totalLoad } = mergeFleetKeys([{ instance: 'db-a', href: href('db-a'), keys: [{ id: 'A', label: 'a', load: 0 }] }], 'load');
    expect(totalLoad).toBe(0);
    expect(rows[0]).toMatchObject({ sharePercent: 0, origins: [{ instance: 'db-a', load: 0, sharePercent: 0, href: href('db-a') }] });
  });

  it('returns nothing for no instances', () => {
    expect(mergeFleetKeys([], 'load')).toEqual({ rows: [], totalLoad: 0 });
  });
});

describe('parseQueryGroup and parseQuerySort', () => {
  it('default to statements sorted by load', () => {
    expect(parseQueryGroup(undefined)).toBe('sql');
    expect(parseQueryGroup('user')).toBe('user');
    expect(parseQueryGroup('nope')).toBe('sql');
    expect(parseQuerySort(['instances'])).toBe('instances');
    expect(parseQuerySort('nope')).toBe('load');
  });
});

describe('fleetQueries', () => {
  it('calls Performance Insights once per covered instance and merges the answers', async () => {
    rds.on(DescribeDBClustersCommand).resolves({ DBClusters: [] });
    rds.on(DescribeDBInstancesCommand).resolves({ DBInstances: [instance('db-a'), instance('db-b')] });
    pi.on(DescribeDimensionKeysCommand, { Identifier: 'res-db-a' }).resolves({
      Keys: [{ Dimensions: { 'db.sql_tokenized.id': 'A1', 'db.sql_tokenized.statement': 'SELECT 1' }, Total: 3 }],
    });
    pi.on(DescribeDimensionKeysCommand, { Identifier: 'res-db-b' }).resolves({
      Keys: [{ Dimensions: { 'db.sql_tokenized.id': 'A1', 'db.sql_tokenized.statement': 'SELECT 1' }, Total: 1 }],
    });

    const result = await fleetQueries(target, { group: 'sql', sort: 'load', range: '3h', nowMs: t }, deps);
    expect(pi.commandCalls(DescribeDimensionKeysCommand)).toHaveLength(2);
    expect(result.ok && result.data.rows[0]).toMatchObject({ key: 'A1', totalLoad: 4, instanceCount: 2 });
    expect(result.ok && result.data.rows[0].origins).toEqual([
      { instance: 'db-a', load: 3, sharePercent: 75, href: href('db-a') },
      { instance: 'db-b', load: 1, sharePercent: 25, href: href('db-b') },
    ]);
    expect(result.ok && result.data.coverage).toEqual({ covered: 2, total: 2, truncated: false });
    expect(result.ok && result.data.notCovered).toEqual([]);
    expect(result.ok && result.data.limitPerInstance).toBe(25);
  });

  it('lists an instance without Performance Insights as not covered instead of calling it', async () => {
    rds.on(DescribeDBClustersCommand).resolves({ DBClusters: [] });
    rds.on(DescribeDBInstancesCommand).resolves({
      DBInstances: [instance('db-a'), instance('db-off', { PerformanceInsightsEnabled: false }), instance('db-null', { DbiResourceId: undefined })],
    });
    pi.on(DescribeDimensionKeysCommand).resolves({ Keys: [] });

    const result = await fleetQueries(target, { group: 'sql', sort: 'load', range: '3h', nowMs: t }, deps);
    expect(pi.commandCalls(DescribeDimensionKeysCommand)).toHaveLength(1);
    expect(result.ok && result.data.notCovered).toEqual([
      { resource: 'db-null', reason: 'no_resource_id', code: null, action: null },
      { resource: 'db-off', reason: 'pi_disabled', code: null, action: null },
    ]);
    expect(result.ok && result.data.coverage).toEqual({ covered: 1, total: 3, truncated: true });
  });

  it('keeps a denied or failing instance in the list with its error code', async () => {
    rds.on(DescribeDBClustersCommand).resolves({ DBClusters: [] });
    rds.on(DescribeDBInstancesCommand).resolves({ DBInstances: [instance('db-a'), instance('db-bad')] });
    pi.on(DescribeDimensionKeysCommand, { Identifier: 'res-db-a' }).resolves({
      Keys: [{ Dimensions: { 'db.sql_tokenized.id': 'A1', 'db.sql_tokenized.statement': 'SELECT 1' }, Total: 2 }],
    });
    pi.on(DescribeDimensionKeysCommand, { Identifier: 'res-db-bad' }).rejects(Object.assign(new Error('no'), { name: 'AccessDeniedException' }));

    const result = await fleetQueries(target, { group: 'sql', sort: 'load', range: '3h', nowMs: t }, deps);
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.rows).toHaveLength(1);
    expect(result.ok && result.data.notCovered).toEqual([{ resource: 'db-bad', reason: 'denied', code: 'AccessDeniedException', action: 'pi:DescribeDimensionKeys' }]);
    expect(result.ok && result.data.coverage).toEqual({ covered: 1, total: 2, truncated: true });
  });

  it('fails as a whole only when the instance list fails', async () => {
    rds.on(DescribeDBClustersCommand).rejects(Object.assign(new Error('no'), { name: 'AccessDeniedException' }));
    rds.on(DescribeDBInstancesCommand).resolves({ DBInstances: [] });
    const result = await fleetQueries(target, { group: 'sql', sort: 'load', range: '3h', nowMs: t }, deps);
    expect(result).toEqual({ ok: false, reason: 'denied', code: 'AccessDeniedException', action: 'rds:DescribeDBClusters' });
  });

  it('asks each instance with the grouping the user chose', async () => {
    rds.on(DescribeDBClustersCommand).resolves({ DBClusters: [] });
    rds.on(DescribeDBInstancesCommand).resolves({ DBInstances: [instance('db-a')] });
    pi.on(DescribeDimensionKeysCommand).resolves({ Keys: [{ Dimensions: { 'db.user.id': 'u1', 'db.user.name': 'app_rw' }, Total: 1 }] });

    const result = await fleetQueries(target, { group: 'user', sort: 'load', range: '3h', nowMs: t }, deps);
    expect(pi.commandCalls(DescribeDimensionKeysCommand)).toHaveLength(1);
    expect(pi.commandCalls(DescribeDimensionKeysCommand)[0].args[0].input.GroupBy).toEqual({
      Group: 'db.user',
      Dimensions: ['db.user.id', 'db.user.name'],
      Limit: 25,
    });
    expect(result.ok && result.data.group).toBe('user');
    expect(result.ok && result.data.rows.map((r) => r.label)).toEqual(['app_rw']);
  });

  it('caps the fleet at 50 Performance Insights calls and says the rest was capped', async () => {
    rds.on(DescribeDBClustersCommand).resolves({ DBClusters: [] });
    rds.on(DescribeDBInstancesCommand).resolves({ DBInstances: Array.from({ length: 52 }, (_, i) => instance(`db-${String(i).padStart(2, '0')}`)) });
    pi.on(DescribeDimensionKeysCommand).resolves({ Keys: [] });
    const result = await fleetQueries(target, { group: 'sql', sort: 'load', range: '3h', nowMs: t }, deps);
    expect(pi.commandCalls(DescribeDimensionKeysCommand)).toHaveLength(50);
    expect(result.ok && result.data.coverage).toEqual({ covered: 50, total: 52, truncated: true });
    expect(result.ok && result.data.notCovered.map((r) => [r.resource, r.reason])).toEqual([['db-50', 'cap'], ['db-51', 'cap']]);
  });
});
