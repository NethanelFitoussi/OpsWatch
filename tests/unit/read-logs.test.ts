import { describe, expect, it } from 'vitest';
import { logSearchSchema, logSourceSchema } from '@opswatch/contract';
import { queryFor, toLogEntry, toLogSearch, toLogSource } from '@/lib/read/logs';
import type { LogsQueryResults } from '@/lib/monitoring/logs';

/**
 * LOG-5, the half that decides whether a client can be honest.
 *
 * Logs Insights answers with as many lines as the query's limit allowed, and separately with how many
 * matched. A client shown only the first will print "3 errors" when there were four hundred, and a client
 * shown a search that has not finished will print "nothing matched" when the answer has not arrived.
 */

const results = (over: Partial<LogsQueryResults> = {}): LogsQueryResults => ({
  status: 'Complete',
  fields: ['@timestamp', '@logStream', '@message'],
  rows: [{ '@timestamp': '2026-09-25 07:21:37.000', '@logStream': 'web/1', '@message': 'ERROR payment gateway timeout' }],
  statistics: { recordsMatched: 1, recordsScanned: 120, bytesScanned: 4096 },
  ...over,
});

describe('a log group, as the API names it', () => {
  it('says null where AWS said nothing, rather than zero', () => {
    // A name search answers without sizes, and `0` would claim the group is empty (§2.4).
    expect(toLogSource({ name: '/ecs/web', storedBytes: null, retentionDays: null })).toEqual({
      name: '/ecs/web',
      storedBytes: null,
      retentionDays: null,
    });
    expect(logSourceSchema.safeParse(toLogSource({ name: '/ecs/web', storedBytes: 0, retentionDays: 30 })).success).toBe(true);
  });
});

describe('the query the server composes', () => {
  it('builds it from bounded values, never from text the caller sent', () => {
    const query = queryFor({ logGroups: ['/ecs/web'], text: 'timeout', level: 'error', rangeSeconds: 3600 }, 100);
    expect(query).toBe('fields @timestamp, @logStream, @message | filter @message like /(?i)timeout/ | filter @message like /(?i)(error|err|fatal|critical|exception|panic|severe)/ | sort @timestamp desc | limit 100');
  });

  it('ignores a level the query builder has no filter for, rather than inventing one', () => {
    // `fatal` and `unknown` are levels a *line* can announce; they are not filters.
    expect(queryFor({ logGroups: ['/ecs/web'], level: 'unknown', rangeSeconds: 60 }, 10)).not.toContain('filter');
  });

  it('cannot be widened by the caller: there is nowhere to put query text', () => {
    // The request schema has no query field at all, which is the guard — not a filter on one.
    expect(queryFor({ logGroups: ['/ecs/web'], text: '| stats count(*)', rangeSeconds: 60 }, 10)).toContain('like /(?i)');
  });
});

describe('THE RULING: a sample is never answered as a total', () => {
  it('says `partial` when more matched than came back', () => {
    const search = toLogSearch('q1', 'fields @message', results({ statistics: { recordsMatched: 400, recordsScanned: 9000, bytesScanned: 1 } }));
    expect(search.status).toBe('partial');
    expect(search.items).toHaveLength(1);
    expect(search.statistics?.recordsMatched).toBe(400);
  });

  it('says `complete` only when everything that matched came back', () => {
    expect(toLogSearch('q1', 'q', results()).status).toBe('complete');
  });

  it('THE RULING: a search still running has no lines *yet*, which is not "nothing matched"', () => {
    for (const status of ['Scheduled', 'Running'] as const) {
      const search = toLogSearch('q1', 'q', results({ status }));
      expect(search.status).toBe('running');
      // Not the rows AWS has so far presented as the answer: the status is what a client reads first.
      expect(search.items).toEqual([]);
    }
  });

  it('never reads a failure as a finished search', () => {
    // Each of these would otherwise show as "nothing matched", which is a claim nobody measured.
    for (const status of ['Failed', 'Cancelled', 'Timeout', 'Unknown'] as const) {
      expect(toLogSearch('q1', 'q', results({ status })).status).toBe('failed');
    }
  });
});

describe('one line', () => {
  it('carries the level the line announced, and `unknown` where it announced none', () => {
    expect(toLogEntry({ '@message': 'ERROR boom' }, 'q1', 0).level).toBe('error');
    // Not `info`: colouring an unlabelled line would be inventing a severity nobody wrote.
    expect(toLogEntry({ '@message': 'GET /health 200' }, 'q1', 0).level).toBe('unknown');
  });

  it('reads the instant as UTC, which is what Logs Insights states', () => {
    expect(toLogEntry({ '@timestamp': '2026-09-25 07:21:37.000', '@message': 'x' }, 'q1', 0).timestamp).toBe(Date.UTC(2026, 8, 25, 7, 21, 37));
  });

  it('keeps a structured line’s own fields, and leaves the query’s three out of them', () => {
    const entry = toLogEntry({ '@timestamp': '2026-09-25 07:21:37.000', '@message': 'x', requestId: 'abc' }, 'q1', 0);
    expect(entry.fields).toEqual({ requestId: 'abc' });
    expect(entry.source).toBeUndefined();
  });

  it('drops a row with no readable instant rather than dating it to 1970', () => {
    const search = toLogSearch('q1', 'q', results({ rows: [{ '@message': 'no timestamp' }], statistics: { recordsMatched: 1, recordsScanned: 1, bytesScanned: 1 } }));
    expect(search.items).toEqual([]);
  });
});

describe('the shape the API promises', () => {
  it('validates, including the query that ran', () => {
    const parsed = logSearchSchema.safeParse(toLogSearch('q1', 'fields @message', results()));
    expect(parsed.success && parsed.data.query).toBe('fields @message');
  });

  it('omits the query on a poll rather than saying the search was for nothing', () => {
    // AWS remembers the query; OpsWatch remembers only who may ask for it.
    expect(toLogSearch('q1', null, results()).query).toBeUndefined();
  });
});
