import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  GetQueryResultsCommand,
  StartQueryCommand,
  StopQueryCommand,
  type QueryStatus,
} from '@aws-sdk/client-cloudwatch-logs';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createTtlCache } from '@/lib/monitoring/cache';
import {
  LOGS_MAX_RANGE_SECONDS,
  LOGS_MAX_ROWS,
  getLogsQueryResults,
  parseLogsQueryInput,
  searchLogGroups,
  startLogsQuery,
  stopLogsQuery,
} from '@/lib/monitoring/logs';

const logs = mockClient(CloudWatchLogsClient);
const target = { connectionId: 'abc123def456', region: 'eu-west-1', credentials: { accessKeyId: 'ASIA', secretAccessKey: 's' } };
const NOW = Date.parse('2026-09-17T10:00:00Z');
const END = NOW / 1000;
const START = END - 3600;
let deps: { cache: ReturnType<typeof createTtlCache>; log: Mock };

const input = (overrides: Record<string, unknown> = {}) => ({ logGroups: ['/ecs/web'], query: 'fields @message', startSeconds: START, endSeconds: END, ...overrides });

beforeEach(() => {
  logs.reset();
  deps = { cache: createTtlCache(), log: vi.fn() };
});

describe('parseLogsQueryInput', () => {
  it('accepts a well-formed query and trims its text', () => {
    expect(parseLogsQueryInput(input({ query: '  fields @message  ' }), NOW)).toEqual({ ok: true, value: input() });
  });

  it.each([
    ['not an object', null],
    ['no log group', input({ logGroups: [] })],
    ['too many log groups', input({ logGroups: Array.from({ length: 21 }, (_, i) => `/ecs/${i}`) })],
    ['a log group name that is too long', input({ logGroups: ['a'.repeat(513)] })],
    ['a blank query', input({ query: '  ' })],
    ['a query that is too long', input({ query: 'f'.repeat(10_001) })],
    ['non-integer seconds', input({ startSeconds: START + 0.5 })],
    ['an end at or before the start', input({ startSeconds: END })],
    ['an end in the future', input({ endSeconds: END + 301 })],
  ])('rejects %s', (_label, body) => {
    expect(parseLogsQueryInput(body, NOW)).toEqual({ ok: false, error: 'invalid_query' });
  });

  it('rejects a range longer than 24 hours and accepts exactly 24 hours', () => {
    expect(parseLogsQueryInput(input({ startSeconds: END - LOGS_MAX_RANGE_SECONDS - 1 }), NOW)).toEqual({ ok: false, error: 'range_too_long' });
    expect(parseLogsQueryInput(input({ startSeconds: END - LOGS_MAX_RANGE_SECONDS }), NOW)).toEqual({
      ok: true,
      value: input({ startSeconds: END - LOGS_MAX_RANGE_SECONDS }),
    });
  });
});

describe('searchLogGroups', () => {
  it('searches names by substring, maps the groups and caches the answer', async () => {
    logs.on(DescribeLogGroupsCommand).resolves({ logGroups: [{ logGroupName: '/ecs/web', storedBytes: 1024, retentionInDays: 30 }, { logGroupName: '/ecs/api' }] });
    const result = await searchLogGroups(target, 'ecs', deps);
    // logGroupNamePattern matches anywhere in the name, and AWS refuses it together with logGroupNamePrefix.
    expect(logs.commandCalls(DescribeLogGroupsCommand).map((c) => c.args[0].input)).toEqual([{ logGroupNamePattern: 'ecs', limit: 50 }]);
    expect(result).toEqual({
      ok: true,
      data: [
        { name: '/ecs/web', storedBytes: 1024, retentionDays: 30 },
        { name: '/ecs/api', storedBytes: null, retentionDays: null },
      ],
    });
    await searchLogGroups(target, 'ecs', deps);
    expect(logs.commandCalls(DescribeLogGroupsCommand)).toHaveLength(1);
  });

  it('lists without any name filter for an empty search', async () => {
    logs.on(DescribeLogGroupsCommand).resolves({ logGroups: [] });
    expect(await searchLogGroups(target, '', deps)).toEqual({ ok: true, data: [] });
    expect(logs.commandCalls(DescribeLogGroupsCommand)[0].args[0].input).toEqual({ limit: 50 });
  });
});

describe('startLogsQuery', () => {
  it('starts a bounded query and never caches it', async () => {
    logs.on(StartQueryCommand).resolves({ queryId: 'q-1' });
    expect(await startLogsQuery(target, input(), deps)).toEqual({ ok: true, data: { queryId: 'q-1' } });
    expect(logs.commandCalls(StartQueryCommand)[0].args[0].input).toEqual({
      logGroupNames: ['/ecs/web'],
      queryString: 'fields @message',
      startTime: START,
      endTime: END,
      limit: LOGS_MAX_ROWS,
    });
    await startLogsQuery(target, input(), deps);
    expect(logs.commandCalls(StartQueryCommand)).toHaveLength(2);
  });

  it('reports a throttled start and a response without a query id', async () => {
    logs.on(StartQueryCommand).rejects(Object.assign(new Error('slow down'), { name: 'LimitExceededException' }));
    expect(await startLogsQuery(target, input(), deps)).toEqual({ ok: false, reason: 'throttled', code: 'LimitExceededException', action: 'logs:StartQuery' });

    logs.reset();
    logs.on(StartQueryCommand).resolves({});
    expect(await startLogsQuery(target, input(), deps)).toEqual({ ok: false, reason: 'error', code: 'MissingQueryId', action: 'logs:StartQuery' });
  });
});

describe('getLogsQueryResults', () => {
  it('maps rows and fields, dropping @ptr', async () => {
    logs.on(GetQueryResultsCommand).resolves({
      status: 'Complete',
      results: [
        [
          { field: '@timestamp', value: '2026-09-17 09:59:00.000' },
          { field: '@message', value: 'ERROR boom' },
          { field: '@ptr', value: 'abc' },
        ],
        [
          { field: '@message', value: 'ok' },
          { field: 'duration', value: '12' },
        ],
      ],
      statistics: { recordsMatched: 2, recordsScanned: 10, bytesScanned: 2048 },
    });
    expect(await getLogsQueryResults(target, 'q-1', deps)).toEqual({
      ok: true,
      data: {
        status: 'Complete',
        fields: ['@timestamp', '@message', 'duration'],
        rows: [{ '@timestamp': '2026-09-17 09:59:00.000', '@message': 'ERROR boom' }, { '@message': 'ok', duration: '12' }],
        statistics: { recordsMatched: 2, recordsScanned: 10, bytesScanned: 2048 },
      },
    });
  });

  it('reports an unknown status as Unknown, caps the rows and never caches', async () => {
    logs.on(GetQueryResultsCommand).resolves({ status: 'Weird' as unknown as QueryStatus, results: Array.from({ length: 1500 }, (_, i) => [{ field: '@message', value: String(i) }]) });
    const result = await getLogsQueryResults(target, 'q-1', deps);
    expect(result.ok && result.data.status).toBe('Unknown');
    expect(result.ok && result.data.rows).toHaveLength(LOGS_MAX_ROWS);
    expect(result.ok && result.data.statistics).toEqual({ recordsMatched: 0, recordsScanned: 0, bytesScanned: 0 });
    await getLogsQueryResults(target, 'q-1', deps);
    expect(logs.commandCalls(GetQueryResultsCommand)).toHaveLength(2);
  });
});

describe('stopLogsQuery', () => {
  it('reports the stop result and swallows nothing', async () => {
    logs.on(StopQueryCommand).resolves({ success: true });
    expect(await stopLogsQuery(target, 'q-1', deps)).toEqual({ ok: true, data: true });

    logs.reset();
    logs.on(StopQueryCommand).rejects(Object.assign(new Error('moto'), { name: 'SyntaxError' }));
    expect(await stopLogsQuery(target, 'q-1', deps)).toEqual({ ok: false, reason: 'error', code: 'SyntaxError', action: 'logs:StopQuery' });
  });
});
