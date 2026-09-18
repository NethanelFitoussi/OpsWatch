import { DescribeDimensionKeysCommand, PIClient } from '@aws-sdk/client-pi';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createTtlCache } from '@/lib/monitoring/cache';
import { FLEET_SQL_LIMIT, TOP_SQL_LIMIT, piWindow, topDimensionKeys, topSql } from '@/lib/monitoring/pi';

const pi = mockClient(PIClient);
const target = { connectionId: 'abc123def456', region: 'eu-west-1', credentials: { accessKeyId: 'ASIA', secretAccessKey: 's' } };
let t: number;
let deps: { cache: ReturnType<typeof createTtlCache>; log: Mock };

beforeEach(() => {
  pi.reset();
  t = Date.parse('2026-09-17T10:07:42Z');
  deps = { cache: createTtlCache({ now: () => t }), log: vi.fn() };
});

describe('piWindow', () => {
  it('floors the end to 5 minutes and uses the range period', () => {
    expect(piWindow('7d', t).periodSeconds).toBe(3600);
    expect(piWindow('12h', t).end).toEqual(new Date('2026-09-17T10:05:00Z'));
    expect(piWindow('12h', t).start).toEqual(new Date('2026-09-16T22:05:00Z'));
  });
});

describe('topSql', () => {
  it('asks for the top 10 tokenized statements by average load', async () => {
    pi.on(DescribeDimensionKeysCommand).resolves({
      Keys: [
        { Dimensions: { 'db.sql_tokenized.id': 'A1', 'db.sql_tokenized.statement': 'SELECT * FROM orders WHERE id = ?' }, Total: 0.4 },
        { Dimensions: { 'db.sql_tokenized.id': 'B2', 'db.sql_tokenized.statement': 'UPDATE stock SET qty = qty - ? WHERE sku = ?' }, Total: 1.25 },
        { Dimensions: {}, Total: 0.1 },
      ],
    });
    const window = piWindow('1h', t);
    expect(window).toEqual({ start: new Date('2026-09-17T09:05:00Z'), end: new Date('2026-09-17T10:05:00Z'), periodSeconds: 60 });
    const result = await topSql(target, 'db-ORDERS1', window, deps);
    expect(pi.commandCalls(DescribeDimensionKeysCommand)[0].args[0].input).toEqual({
      ServiceType: 'RDS',
      Identifier: 'db-ORDERS1',
      StartTime: window.start,
      EndTime: window.end,
      PeriodInSeconds: 60,
      Metric: 'db.load.avg',
      GroupBy: { Group: 'db.sql_tokenized', Dimensions: ['db.sql_tokenized.id', 'db.sql_tokenized.statement'], Limit: 10 },
    });
    expect(result).toEqual({
      ok: true,
      data: [
        { id: 'B2', statement: 'UPDATE stock SET qty = qty - ? WHERE sku = ?', load: 1.25 },
        { id: 'A1', statement: 'SELECT * FROM orders WHERE id = ?', load: 0.4 },
        { id: null, statement: '', load: 0.1 },
      ],
    });
  });

  it('never returns more than 10 statements', async () => {
    pi.on(DescribeDimensionKeysCommand).resolves({
      Keys: Array.from({ length: 12 }, (_, i) => ({ Dimensions: { 'db.sql_tokenized.id': `S${i}`, 'db.sql_tokenized.statement': `SELECT ${i}` }, Total: i })),
    });
    const result = await topSql(target, 'db-ORDERS1', piWindow('1h', t), deps);
    expect(TOP_SQL_LIMIT).toBe(10);
    expect(result.ok && result.data.map((e) => e.id)).toEqual(['S11', 'S10', 'S9', 'S8', 'S7', 'S6', 'S5', 'S4', 'S3', 'S2']);
  });

  it('keeps top SQL for 5 minutes', async () => {
    pi.on(DescribeDimensionKeysCommand).resolves({ Keys: [] });
    const window = piWindow('3h', t);
    await topSql(target, 'db-ORDERS1', window, deps);
    t += 299_999;
    await topSql(target, 'db-ORDERS1', window, deps);
    expect(pi.commandCalls(DescribeDimensionKeysCommand)).toHaveLength(1);
    t += 1;
    await topSql(target, 'db-ORDERS1', window, deps);
    expect(pi.commandCalls(DescribeDimensionKeysCommand)).toHaveLength(2);
  });

  it('reports a denied call', async () => {
    pi.on(DescribeDimensionKeysCommand).rejects(Object.assign(new Error('no'), { name: 'NotAuthorizedException' }));
    expect(await topSql(target, 'db-ORDERS1', piWindow('1h', t), deps)).toEqual({ ok: false, reason: 'denied', code: 'NotAuthorizedException', action: 'pi:DescribeDimensionKeys' });
    expect(deps.log).toHaveBeenCalledWith({ event: 'monitoring_call', connectionId: 'abc123def456', region: 'eu-west-1', action: 'pi:DescribeDimensionKeys', reason: 'denied', code: 'NotAuthorizedException' });
  });
});

describe('topDimensionKeys', () => {
  it('groups by db.user with its own dimensions and the requested limit', async () => {
    pi.on(DescribeDimensionKeysCommand).resolves({
      Keys: [
        { Dimensions: { 'db.user.id': 'u1', 'db.user.name': 'app_rw' }, Total: 2.5 },
        { Dimensions: { 'db.user.id': 'u2', 'db.user.name': 'reporting' }, Total: 0.5 },
      ],
    });
    const window = piWindow('3h', t);
    const result = await topDimensionKeys(target, 'db-ORDERS1', window, 'user', 25, deps);
    expect(pi.commandCalls(DescribeDimensionKeysCommand)[0].args[0].input).toEqual({
      ServiceType: 'RDS',
      Identifier: 'db-ORDERS1',
      StartTime: window.start,
      EndTime: window.end,
      PeriodInSeconds: 60,
      Metric: 'db.load.avg',
      GroupBy: { Group: 'db.user', Dimensions: ['db.user.id', 'db.user.name'], Limit: 25 },
    });
    expect(result).toEqual({ ok: true, data: [{ id: 'u1', label: 'app_rw', load: 2.5 }, { id: 'u2', label: 'reporting', load: 0.5 }] });
  });

  it('groups by db.host', async () => {
    pi.on(DescribeDimensionKeysCommand).resolves({ Keys: [{ Dimensions: { 'db.host.id': 'h1', 'db.host.name': '10.0.3.7' }, Total: 1 }] });
    await topDimensionKeys(target, 'db-ORDERS1', piWindow('3h', t), 'host', 25, deps);
    expect(pi.commandCalls(DescribeDimensionKeysCommand)[0].args[0].input.GroupBy).toEqual({
      Group: 'db.host',
      Dimensions: ['db.host.id', 'db.host.name'],
      Limit: 25,
    });
  });

  it('sorts by load, truncates to the limit and keeps a key with no id', async () => {
    pi.on(DescribeDimensionKeysCommand).resolves({
      Keys: [
        { Dimensions: { 'db.sql_tokenized.statement': 'SELECT 1' }, Total: 9 },
        { Dimensions: { 'db.sql_tokenized.id': 'A', 'db.sql_tokenized.statement': 'SELECT 2' }, Total: 3 },
        { Dimensions: { 'db.sql_tokenized.id': 'B', 'db.sql_tokenized.statement': 'SELECT 3' }, Total: 5 },
      ],
    });
    const result = await topDimensionKeys(target, 'db-ORDERS1', piWindow('3h', t), 'sql', 2, deps);
    expect(result).toEqual({ ok: true, data: [{ id: null, label: 'SELECT 1', load: 9 }, { id: 'B', label: 'SELECT 3', load: 5 }] });
  });

  it('caches a different grouping and a different limit separately', async () => {
    pi.on(DescribeDimensionKeysCommand).resolves({ Keys: [] });
    const window = piWindow('3h', t);
    await topDimensionKeys(target, 'db-ORDERS1', window, 'sql', 25, deps);
    await topDimensionKeys(target, 'db-ORDERS1', window, 'sql', 25, deps);
    await topDimensionKeys(target, 'db-ORDERS1', window, 'user', 25, deps);
    await topDimensionKeys(target, 'db-ORDERS1', window, 'sql', 10, deps);
    expect(pi.commandCalls(DescribeDimensionKeysCommand)).toHaveLength(3);
  });

  it('keeps the fleet limit at 25 and the instance limit at 10', () => {
    expect(FLEET_SQL_LIMIT).toBe(25);
    expect(TOP_SQL_LIMIT).toBe(10);
  });
});
