import { describe, expect, it } from 'vitest';
import { ERRORS_QUERY_LIMIT, ERRORS_WINDOW_MS, errorQuery, ingest } from '@/lib/collector/errors-job';
import { BYTES_PER_GB, DAY_MS, budgetState, dayOf, readUsage, recordBudgetStop, recordScan, usageForDay } from '@/lib/store/logs-budget';
import { countOccurrences, pageErrorGroups, upsertLogSource } from '@/lib/store/errors';
import { parseLine, parseStack } from '@/lib/detect/log-parse';
import { fingerprint } from '@/lib/detect/fingerprint';
import { createTestDb } from '../helpers/db';

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const env = { connectionId: 'c1', scope: 'us-east-1' };

const source = (over = {}) => ({
  ...env,
  logGroup: '/aws/ecs/web',
  serviceId: 'prod/web',
  enabled: true,
  format: 'json' as const,
  fieldMap: { level: '$.level', type: '$.err.type', message: '$.err.message', stack: '$.err.stack' },
  ...over,
});

const line = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    level: 'error',
    err: {
      type: 'TypeError',
      message: "Cannot read properties of undefined (reading 'id')",
      stack: "TypeError: boom\n    at chargeCard (/app/src/payment/charge.ts:184:7)\n    at run (/app/node_modules/x/y.js:1:1)",
    },
    ...over,
  });

describe('the budget is a hard stop, not a warning (§9.5)', () => {
  it('starts each UTC day at zero', () => {
    const db = createTestDb();
    const usage = readUsage(db, NOW);
    expect({ scanned: usage.bytesScanned, queries: usage.queries }).toEqual({ scanned: 0, queries: 0 });
    expect(budgetState(db, NOW, 1).exhausted).toBe(false);
  });

  it('measures what AWS reported as scanned, and adds it up across queries', () => {
    const db = createTestDb();
    recordScan(db, NOW, 100);
    recordScan(db, NOW, 250);
    const state = budgetState(db, NOW, 1);
    expect(state.bytesScanned).toBe(350);
    expect(readUsage(db, NOW).queries).toBe(2);
  });

  it('is exhausted exactly at the budget, not after it', () => {
    const db = createTestDb();
    recordScan(db, NOW, BYTES_PER_GB - 1);
    expect(budgetState(db, NOW, 1).exhausted).toBe(false);
    recordScan(db, NOW, 1);
    expect(budgetState(db, NOW, 1).exhausted).toBe(true);
    expect(budgetState(db, NOW, 1).remainingBytes).toBe(0);
  });

  it('treats a budget of zero as "never touch Logs Insights", which is a real choice', () => {
    const db = createTestDb();
    expect(budgetState(db, NOW, 0).exhausted).toBe(true);
  });

  it('resets the next day, and yesterday stays readable', () => {
    const db = createTestDb();
    recordScan(db, NOW, BYTES_PER_GB);
    expect(budgetState(db, NOW, 1).exhausted).toBe(true);
    const tomorrow = NOW + 24 * 60 * 60_000;
    expect(budgetState(db, tomorrow, 1).exhausted).toBe(false);
    // Settings shows yesterday's spend, so an operator can see what this actually costs.
    expect(usageForDay(db, NOW)?.bytesScanned).toBe(BYTES_PER_GB);
  });

  it('records why it stopped, so a reader is not left wondering where the errors went', () => {
    const db = createTestDb();
    recordBudgetStop(db, NOW);
    expect(budgetState(db, NOW, 1).stoppedAt).toBe(NOW);
  });

  it('uses UTC days, so an instance does not get two budgets at a timezone edge', () => {
    expect(DAY_MS).toBe(24 * 60 * 60_000);
    expect(dayOf(NOW)).toBe(Date.UTC(2026, 8, 22));
    expect(dayOf(Date.UTC(2026, 8, 22, 23, 59, 59))).toBe(Date.UTC(2026, 8, 22));
    expect(dayOf(NOW + DAY_MS)).toBe(Date.UTC(2026, 8, 23));
  });
});

describe('the query it runs', () => {
  it('asks for named fields rather than a wildcard, so the scan is bounded', () => {
    const query = errorQuery(ERRORS_QUERY_LIMIT);
    expect(query).toContain('fields @timestamp, @message');
    expect(query).not.toContain('fields *');
    expect(query).toContain(`limit ${ERRORS_QUERY_LIMIT}`);
    // It filters in the query rather than downloading everything and filtering here.
    expect(query).toContain('| filter');
  });

  it('asks about a window wider than its own cadence, so nothing falls between two cycles', () => {
    // The job runs every fifteen minutes; asking about exactly fifteen would lose whatever arrived during
    // the query itself.
    expect(ERRORS_WINDOW_MS).toBeGreaterThan(15 * 60_000);
  });
});

describe('turning log lines into groups', () => {
  it('groups identical errors from one batch into one group with a count', () => {
    const db = createTestDb();
    const logSource = upsertLogSource(db, source());
    const groups = ingest({ db, ...env, nowMs: NOW }, logSource, [
      { '@message': line(), '@timestamp': String(NOW) },
      { '@message': line(), '@timestamp': String(NOW) },
      { '@message': line(), '@timestamp': String(NOW) },
    ]);
    expect(groups).toBe(1);
    const [group] = pageErrorGroups(db, env, null, 10).items;
    expect(countOccurrences(db, group.id).count).toBe(3);
    expect(group.exceptionType).toBe('TypeError');
    // Vendor frames are dropped, so the group is identified by the application's own code.
    expect(group.topFrames).toEqual(['/app/src/payment/charge.ts:chargeCard']);
  });

  it('separates two genuinely different errors', () => {
    const db = createTestDb();
    const logSource = upsertLogSource(db, source());
    ingest({ db, ...env, nowMs: NOW }, logSource, [
      { '@message': line(), '@timestamp': String(NOW) },
      { '@message': line({ err: { type: 'RangeError', message: 'out of range', stack: '' } }), '@timestamp': String(NOW) },
    ]);
    expect(pageErrorGroups(db, env, null, 10).items).toHaveLength(2);
  });

  it('keeps one group across two occurrences that differ only by an id', () => {
    const db = createTestDb();
    const logSource = upsertLogSource(db, source());
    ingest({ db, ...env, nowMs: NOW }, logSource, [
      { '@message': line({ err: { type: 'E', message: 'user 3f2504e0-4f89-11d3-9a0c-0305e82c3301 missing', stack: '' } }), '@timestamp': String(NOW) },
      { '@message': line({ err: { type: 'E', message: 'user 7a1b2c3d-1111-2222-3333-444455556666 missing', stack: '' } }), '@timestamp': String(NOW) },
    ]);
    expect(pageErrorGroups(db, env, null, 10).items).toHaveLength(1);
  });

  it('survives a line that is not the shape the map expects', () => {
    const db = createTestDb();
    const logSource = upsertLogSource(db, source());
    expect(() =>
      ingest({ db, ...env, nowMs: NOW }, logSource, [
        { '@message': 'not json at all', '@timestamp': String(NOW) },
        { '@message': '{}', '@timestamp': String(NOW) },
        { '@timestamp': String(NOW) },
      ]),
    ).not.toThrow();
    // The raw line is still the most useful thing left, so it becomes the message rather than being dropped.
    expect(pageErrorGroups(db, env, null, 10).items.length).toBeGreaterThan(0);
  });
});

describe('parsing a line', () => {
  it('reads a nested JSON field map', () => {
    const parsed = parseLine(line(), 'json', { type: '$.err.type', message: '$.err.message', stack: '$.err.stack' });
    expect(parsed.type).toBe('TypeError');
    expect(parsed.message).toContain('Cannot read properties');
  });

  it('answers null for a field the map names but the line does not have', () => {
    expect(parseLine('{"a":1}', 'json', { message: '$.missing' }).message).toBeNull();
  });

  it('reads a regex source through its capture groups', () => {
    const parsed = parseLine('ERROR TypeError: boom', 'regex', { message: '(?<level>\\w+) (?<type>\\w+): (?<message>.*)' });
    expect({ level: parsed.level, type: parsed.type, message: parsed.message }).toEqual({
      level: 'ERROR',
      type: 'TypeError',
      message: 'boom',
    });
  });

  it('survives a regex an operator typed wrongly rather than taking the cycle down', () => {
    expect(() => parseLine('anything', 'regex', { message: '([unclosed' })).not.toThrow();
  });
});

describe('parsing a stack', () => {
  it('reads Node frames, with and without a function name, and keeps where in the file', () => {
    expect(parseStack('at chargeCard (/app/a.ts:184:7)\n    at /app/b.ts:9:1')).toEqual([
      { file: '/app/a.ts', function: 'chargeCard', line: 184, column: 7 },
      { file: '/app/b.ts', line: 9, column: 1 },
    ]);
  });

  it('reads Python frames, with the line it names', () => {
    expect(parseStack('  File "/app/x.py", line 12, in charge')).toEqual([{ file: '/app/x.py', function: 'charge', line: 12 }]);
  });

  it('ignores lines that are not frames, such as the message itself', () => {
    expect(parseStack("TypeError: boom\n    at run (/app/a.ts:1:1)")).toEqual([{ file: '/app/a.ts', function: 'run', line: 1, column: 1 }]);
  });

  it('THE RULING: a line number never reaches the fingerprint, so a blank line cannot split a group', () => {
    // §4.4 groups on the file and the function. The line is kept on the frame for a *sighting* to point
    // at, and `normalizeFrame` — which is what the fingerprint reads — does not carry it.
    const before = parseStack('at charge (/app/a.ts:184:7)');
    const after = parseStack('at charge (/app/a.ts:203:7)');
    expect(before[0].line).not.toBe(after[0].line);
    expect(fingerprint({ type: 'TypeError', message: 'boom', frames: before })).toBe(
      fingerprint({ type: 'TypeError', message: 'boom', frames: after }),
    );
  });

  it('answers an empty list for no stack at all', () => {
    expect(parseStack(null)).toEqual([]);
  });
});
