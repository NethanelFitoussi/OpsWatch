import { describe, expect, it } from 'vitest';
import { problemSummarySchema, problemDetailSchema, decodeCursor } from '@opswatch/contract';
import {
  PROBLEM_NEW_MS,
  countBySeverity,
  getProblem,
  listProblems,
  problemIsStale,
  topProblems,
  trendOf,
  wireStatus,
} from '@/lib/read/problems';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, TOP_PROBLEMS_LIMIT, pageLimit } from '@/lib/read/paging';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@opswatch/contract';
import { STALE_AFTER_MS } from '@/lib/detect/lifecycle';
import { insertProblem, updateProblem } from '@/lib/store/problems';
import type { ProblemRow } from '@/lib/db/schema';
import { createTestDb } from '../helpers/db';
import { newProblem } from '../helpers/detect';

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const env = { connectionId: 'c1', scope: 'us-east-1' };
/** The API and the pages each bind their own; a test only needs something deterministic. */
const context = { nowMs: NOW, render: (key: string, values: Record<string, string | number>) => `${key}:${JSON.stringify(values)}` };

const seed = (db: ReturnType<typeof createTestDb>, over = {}) =>
  insertProblem(db, newProblem({ firstSeenAt: NOW - 3 * 60 * 60_000, lastSeenAt: NOW, lastEvaluatedAt: NOW, ...over }));

describe('a problem on the wire', () => {
  it('is exactly what every client already parses', () => {
    const db = createTestDb();
    seed(db);
    const [summary] = listProblems(db, env, context).items;
    // The contract is the acceptance criterion: if this parses, the phone renders it.
    expect(problemSummarySchema.safeParse(summary).success).toBe(true);
  });

  it('carries the detector id as the category, untranslated', () => {
    const db = createTestDb();
    seed(db, { kind: 'ecs_cpu_high' });
    expect(listProblems(db, env, context).items[0].category).toBe('ecs_cpu_high');
  });

  it('renders the title through the catalogue rather than storing a sentence', () => {
    const db = createTestDb();
    seed(db, { titleKey: 'messages.ecs_cpu_high', values: { service: 'web' } });
    const [summary] = listProblems(db, env, context).items;
    expect(summary.title).toBe('messages.ecs_cpu_high:{"service":"web"}');
    // The key travels too, so a client holding the catalogue renders in its own locale (§12.2).
    expect(summary.key).toHaveLength(32);
  });

  it('names the service, and does not repeat it as a resource', () => {
    const db = createTestDb();
    seed(db, { subjectType: 'service', subjectId: 'prod/web', subjectName: 'web', serviceId: 'prod/web' });
    const [summary] = listProblems(db, env, context).items;
    expect(summary.service).toEqual({ type: 'service', id: 'prod/web', label: 'web' });
    expect(summary.resource).toBeUndefined();
  });

  it('names a resource subject as a resource', () => {
    const db = createTestDb();
    seed(db, { subjectType: 'resource', subjectId: 'db-1', subjectName: 'db-1', serviceId: null });
    const [summary] = listProblems(db, env, context).items;
    expect(summary.resource).toBe('db-1');
    expect(summary.service).toBeUndefined();
  });
});

describe('D1\'s status mapping', () => {
  const row = (over: Partial<ProblemRow>) => ({ status: 'open', firstSeenAt: NOW, ...over }) as ProblemRow;

  it('calls a problem opened within the hour `new`, and `active` after that', () => {
    expect(wireStatus(row({ firstSeenAt: NOW - PROBLEM_NEW_MS + 1 }), NOW)).toBe('new');
    expect(wireStatus(row({ firstSeenAt: NOW - PROBLEM_NEW_MS }), NOW)).toBe('active');
  });

  it('passes acknowledgement through, and folds closed into resolved', () => {
    expect(wireStatus(row({ status: 'acknowledged' }), NOW)).toBe('acknowledged');
    expect(wireStatus(row({ status: 'resolved' }), NOW)).toBe('resolved');
    // A client has no use for the difference, and the contract has no word for it.
    expect(wireStatus(row({ status: 'closed' }), NOW)).toBe('resolved');
  });
});

describe('trend', () => {
  const reading = (at: number, value: number | null) =>
    ({ kind: 'metric', at, value }) as Parameters<typeof trendOf>[0][number];

  it('is null with nothing to compare, which is what phase 1 usually has', () => {
    expect(trendOf([])).toBeNull();
    expect(trendOf([reading(NOW, 90)])).toBeNull();
  });

  it('reads rising, falling and stable from the two most recent readings', () => {
    expect(trendOf([reading(NOW - 1, 90), reading(NOW, 96)])).toBe('rising');
    expect(trendOf([reading(NOW - 1, 96), reading(NOW, 80)])).toBe('falling');
    expect(trendOf([reading(NOW - 1, 96), reading(NOW, 97)])).toBe('stable');
  });

  it('ignores a reading that was not measured, rather than treating it as zero', () => {
    expect(trendOf([reading(NOW - 1, 90), reading(NOW, null)])).toBeNull();
  });
});

describe('paging', () => {
  it('pages on exactly the sizes the contract promises, not its own idea of them', () => {
    // The browser and the phone read the same endpoint; a server with its own page size would page
    // differently from what every client was told to expect.
    expect(DEFAULT_PAGE_LIMIT).toBe(DEFAULT_PAGE_SIZE);
    expect(MAX_PAGE_LIMIT).toBe(MAX_PAGE_SIZE);
  });

  it('clamps whatever was asked for into the range the contract promises', () => {
    expect(pageLimit(undefined)).toBe(50);
    expect(pageLimit(1)).toBe(1);
    expect(pageLimit(1000)).toBe(100);
    expect(pageLimit(0)).toBe(1);
    expect(pageLimit(Number.NaN)).toBe(50);
  });

  it('answers a cursor this server can decode, on the immutable axis', () => {
    const db = createTestDb();
    for (let i = 0; i < 3; i += 1) seed(db, { key: String(i).padStart(32, 'k'), subjectId: `s${i}` });
    const first = listProblems(db, { ...env, limit: 2 }, context);
    expect(first.items).toHaveLength(2);
    const decoded = decodeCursor(first.nextCursor ?? '');
    expect(decoded?.seq).toBe(2);

    const second = listProblems(db, { ...env, limit: 2, cursor: decoded }, context);
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });
});

describe('the bounded top-N (§33.6)', () => {
  it('ranks by score with no cursor at all', () => {
    const db = createTestDb();
    for (const [i, score] of [10, 90, 50].entries()) {
      const row = seed(db, { key: String(i).padStart(32, 'k'), subjectId: `s${i}` });
      updateProblem(db, row.id, { score });
    }
    const top = topProblems(db, env, context);
    expect(top.map((problem) => problem.score)).toEqual([90, 50, 10]);
    expect(top.length).toBeLessThanOrEqual(TOP_PROBLEMS_LIMIT);
  });

  it('leaves a resolved problem out of the ranking', () => {
    const db = createTestDb();
    const row = seed(db);
    updateProblem(db, row.id, { status: 'resolved', resolvedAt: NOW });
    expect(topProblems(db, env, context)).toEqual([]);
  });

  it('counts by severity over what is still open', () => {
    const db = createTestDb();
    seed(db, { key: 'a'.repeat(32), subjectId: 's1', severity: 'critical' });
    seed(db, { key: 'b'.repeat(32), subjectId: 's2', severity: 'warning' });
    expect(countBySeverity(db, env)).toEqual({ critical: 1, warning: 1, info: 0 });
  });
});

describe('one problem', () => {
  it('answers the detail shape, with its evidence as observed facts', () => {
    const db = createTestDb();
    const row = seed(db);
    const found = getProblem(db, { ...env, id: row.id }, context);
    expect(found).not.toBeNull();
    expect(problemDetailSchema.safeParse(found?.detail).success).toBe(true);
    // Phase 1 records only what a detector read, so nothing may be presented as a correlation or a hypothesis.
    expect(found?.detail.evidence.every((item) => item.kind === 'fact')).toBe(true);
    expect(found?.detail.evidence[0].detail).toBe('96.2 percent');
  });

  it('offers acknowledgement once, and not again once acknowledged', () => {
    const db = createTestDb();
    const row = seed(db);
    expect(getProblem(db, { ...env, id: row.id }, context)?.detail.allowedActions).toEqual(['acknowledge']);
    updateProblem(db, row.id, { status: 'acknowledged' });
    expect(getProblem(db, { ...env, id: row.id }, context)?.detail.allowedActions).toEqual([]);
  });

  it('reads as absent from another environment, not as somebody else\'s', () => {
    const db = createTestDb();
    const row = seed(db);
    expect(getProblem(db, { connectionId: 'other', scope: 'us-east-1', id: row.id }, context)).toBeNull();
    expect(getProblem(db, { ...env, scope: 'eu-west-1', id: row.id }, context)).toBeNull();
    expect(getProblem(db, { ...env, id: 'no-such-problem' }, context)).toBeNull();
  });
});

describe('staleness is said, not hidden', () => {
  it('marks a problem whose subject nobody has evaluated for an hour', () => {
    const db = createTestDb();
    const fresh = seed(db);
    expect(problemIsStale(fresh, NOW)).toBe(false);
    const neglected = { ...fresh, lastEvaluatedAt: NOW - STALE_AFTER_MS - 1 };
    expect(problemIsStale(neglected, NOW)).toBe(true);
  });

  it('never calls a resolved problem stale', () => {
    const db = createTestDb();
    const row = seed(db);
    expect(problemIsStale({ ...row, resolvedAt: NOW, lastEvaluatedAt: 0 }, NOW)).toBe(false);
  });
});
