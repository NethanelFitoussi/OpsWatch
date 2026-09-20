import { describe, expect, it } from 'vitest';
import {
  countProblemsBySeverity, findLastProblemForKey, findLiveProblem, findProblemById, findRecentResolved,
  insertProblem, listEvidence, pageProblems, replaceEvidence, updateProblem, type NewProblem,
} from '@/lib/store/problems';
import { createTestDb } from '../helpers/db';

const AT = Date.UTC(2026, 8, 19, 9, 0, 0);
const base = (over: Partial<NewProblem> = {}): NewProblem => ({
  key: 'k1'.padEnd(32, '0'),
  connectionId: 'c1', scope: 'us-east-1', kind: 'ecs_cpu_high',
  subjectType: 'service', subjectId: 'prod/web', subjectName: 'web', serviceId: 'prod/web',
  source: 'aws', titleKey: 'Insights.messages.ecs_cpu_high', values: { service: 'web', value: 96 },
  severity: 'critical', score: 82,
  scoreTerms: { s: 1, b: 0.5, t: 1, u: 1, d: 0, weights: { s: 40, b: 20, t: 15, u: 15, d: 10 }, availableWeight: 100, rescaled: false, floored: false, score: 82 },
  href: '/c/c1/us-east-1/containers/services/prod/web',
  firstSeenAt: AT, lastSeenAt: AT, lastEvaluatedAt: AT, previousProblemId: null,
  evidence: [{ kind: 'metric', labelKey: 'Problems.evidence.cpu', values: {}, value: 96.2, unit: 'percent', at: AT }],
  ...over,
});

describe('the problem store', () => {
  it('assigns a monotonic seq and keeps one live row per key', () => {
    const db = createTestDb();
    const a = insertProblem(db, base());
    expect(a.seq).toBe(1);
    expect(findLiveProblem(db, a.key)?.id).toBe(a.id);
    expect(() => insertProblem(db, base())).toThrow();
  });

  it('lets a new row take the key once the old one is resolved, and finds the old one inside the reopen window', () => {
    const db = createTestDb();
    const a = insertProblem(db, base());
    updateProblem(db, a.id, { status: 'resolved', resolvedAt: AT + 60_000 });
    expect(findLiveProblem(db, a.key)).toBeNull();
    expect(findRecentResolved(db, a.key, AT)?.id).toBe(a.id);
    expect(findRecentResolved(db, a.key, AT + 120_000)).toBeNull();
    const b = insertProblem(db, base({ previousProblemId: a.id }));
    expect(b.seq).toBe(2);
    expect(b.previousProblemId).toBe(a.id);
  });

  it('stores evidence in order, keeps null as not measured, and replaces the bundle wholesale', () => {
    const db = createTestDb();
    const a = insertProblem(db, base({
      evidence: [
        { kind: 'metric', labelKey: 'Problems.evidence.cpu', values: {}, value: 96.2, unit: 'percent', at: AT },
        { kind: 'inventory', labelKey: 'Problems.evidence.tasks', values: {}, value: null, unit: null, at: AT },
      ],
    }));
    const stored = listEvidence(db, a.id);
    expect(stored.map((e) => e.position)).toEqual([0, 1]);
    expect(stored[1].value).toBeNull();
    replaceEvidence(db, a.id, [{ kind: 'check', labelKey: 'Problems.evidence.probe', values: {}, value: 1, unit: 'count', at: AT + 1 }]);
    expect(listEvidence(db, a.id)).toHaveLength(1);
  });

  it('pages on seq with the id as tiebreak, never on a mutable column', () => {
    const db = createTestDb();
    const rows = Array.from({ length: 5 }, (_, i) => insertProblem(db, base({ key: `k${i}`.padEnd(32, '0'), subjectId: `s${i}` })));
    // A later row is given a lower score: it must still come last.
    updateProblem(db, rows[4].id, { score: 1, severity: 'info', lastSeenAt: AT + 999 });
    const first = pageProblems(db, { connectionId: 'c1', scope: 'us-east-1' }, null, 2);
    expect(first.items.map((r) => r.subjectId)).toEqual(['s0', 's1']);
    expect(first.nextSeq).toBe(first.items[1].seq);
    const second = pageProblems(db, { connectionId: 'c1', scope: 'us-east-1' }, { afterSeq: first.nextSeq as number, afterId: first.nextId as string }, 2);
    expect(second.items.map((r) => r.subjectId)).toEqual(['s2', 's3']);
    const last = pageProblems(db, { connectionId: 'c1', scope: 'us-east-1' }, { afterSeq: second.nextSeq as number, afterId: second.nextId as string }, 2);
    expect(last.items.map((r) => r.subjectId)).toEqual(['s4']);
    expect(last.nextSeq).toBeNull();
  });

  it('hides grouped children and counts by severity', () => {
    const db = createTestDb();
    insertProblem(db, base({ key: 'a'.repeat(32), subjectId: 's1' }));
    const child = insertProblem(db, base({ key: 'b'.repeat(32), subjectId: 's2', severity: 'warning', score: 50 }));
    updateProblem(db, child.id, { grouped: true });
    const filter = { connectionId: 'c1', scope: 'us-east-1' } as const;
    expect(pageProblems(db, filter, null, 10).items).toHaveLength(1);
    expect(pageProblems(db, { ...filter, includeGrouped: true }, null, 10).items).toHaveLength(2);
    expect(countProblemsBySeverity(db, filter)).toEqual({ critical: 1, warning: 0, info: 0 });
  });

  it('deletes evidence with its problem', () => {
    const db = createTestDb();
    const a = insertProblem(db, base());
    db.$client.prepare('delete from problems where id = ?').run(a.id);
    expect(listEvidence(db, a.id)).toHaveLength(0);
  });
});

describe('looking a problem up', () => {
  it('finds the newest row for a key whatever its status, which is how a detector tells seen-before from never-seen', () => {
    const db = createTestDb();
    expect(findLastProblemForKey(db, 'a'.repeat(32))).toBeNull();
    const first = insertProblem(db, base({ key: 'a'.repeat(32) }));
    updateProblem(db, first.id, { status: 'resolved', resolvedAt: AT + 60_000 });
    // Resolved, so `findLiveProblem` cannot see it - but the key has been seen, and this is what says so.
    expect(findLiveProblem(db, 'a'.repeat(32))).toBeNull();
    expect(findLastProblemForKey(db, 'a'.repeat(32))?.id).toBe(first.id);
    const second = insertProblem(db, base({ key: 'a'.repeat(32), previousProblemId: first.id }));
    expect(findLastProblemForKey(db, 'a'.repeat(32))?.id).toBe(second.id);
  });

  it('finds a problem by its id, and answers null rather than throwing for one that does not exist', () => {
    const db = createTestDb();
    const a = insertProblem(db, base());
    expect(findProblemById(db, a.id)?.key).toBe(a.key);
    expect(findProblemById(db, 'no-such-problem')).toBeNull();
  });
});
