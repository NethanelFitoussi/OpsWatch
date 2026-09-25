import { describe, expect, it } from 'vitest';
import { investigationSchema } from '@opswatch/contract';
import { readInvestigationById } from '@/lib/read/investigations';
import type { InvestigationLabels } from '@/lib/read/investigation';
import { insertProblem, updateProblem } from '@/lib/store/problems';
import { createTestDb } from '../helpers/db';
import { newProblem } from '../helpers/detect';

/**
 * INV-1 — the investigation as `/api/v1` serves it.
 *
 * It is derived from a problem rather than stored beside one, and every field has to follow from that.
 * The temptation this guards against is the tidy-looking lie: a `summary` nobody wrote, a `concludedAt`
 * of `0` for something still open, or an id that implies a record a client could create.
 */

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const env = { connectionId: 'c1', scope: 'us-east-1' };

const labels: InvestigationLabels = {
  fact: (type) => `fact:${type}`,
  correlation: ({ minutes, relation }) => `pair:${minutes}:${relation}`,
  hypothesis: (id) => `hypothesis:${id}`,
  confirmedBy: (key) => `confirm:${key}`,
  notEvaluated: (ids) => `notEvaluated:${ids.length}`,
};
const render = (key: string, values: Record<string, string | number>) => `said:${key}:${values.service ?? ''}`;
const context = { nowMs: NOW, labels, render };

const seed = (db: ReturnType<typeof createTestDb>, over: Record<string, unknown> = {}) =>
  insertProblem(db, newProblem({ firstSeenAt: NOW, lastSeenAt: NOW, lastEvaluatedAt: NOW, ...over }));

describe('the investigation of a problem', () => {
  it('carries the problem’s id, because there is no separate record', () => {
    const db = createTestDb();
    const problem = seed(db);
    const investigation = readInvestigationById(db, { ...env, id: problem.id }, context);
    expect(investigation?.id).toBe(problem.id);
    expect(investigation?.subject).toEqual({ type: 'problem', id: problem.id, label: problem.subjectName });
    expect(investigationSchema.safeParse(investigation).success).toBe(true);
  });

  it('is titled with what is being investigated, rendered rather than stored', () => {
    const db = createTestDb();
    const problem = seed(db);
    expect(readInvestigationById(db, { ...env, id: problem.id }, context)?.title).toBe(render(problem.titleKey, problem.values));
  });

  it('THE RULING: it never writes a summary nobody wrote', () => {
    const db = createTestDb();
    const problem = seed(db);
    // The engine lays evidence out in three bands. A generated sentence here would be a conclusion
    // carrying an author's authority, which is exactly what §7 separates the bands to prevent.
    expect(readInvestigationById(db, { ...env, id: problem.id }, context)?.summary).toBeUndefined();
  });

  it('is open while the problem is, and concluded when it resolved', () => {
    const db = createTestDb();
    const open = seed(db);
    expect(readInvestigationById(db, { ...env, id: open.id }, context)?.status).toBe('open');
    // Absent rather than zero: `concludedAt: 0` would date the conclusion to 1970.
    expect(readInvestigationById(db, { ...env, id: open.id }, context)?.concludedAt).toBeUndefined();

    const resolved = seed(db, { key: 'r'.padEnd(32, 'x') });
    updateProblem(db, resolved.id, { status: 'resolved', resolvedAt: NOW + 60_000 });
    const after = readInvestigationById(db, { ...env, id: resolved.id }, context);
    expect(after?.status).toBe('concluded');
    expect(after?.concludedAt).toBe(NOW + 60_000);
  });

  it('is scoped like the problem: an id from another environment reads as absent', () => {
    const db = createTestDb();
    const problem = seed(db);
    // Not "somebody else's" and not an empty timeline — absent, which is the only honest answer.
    expect(readInvestigationById(db, { connectionId: 'c2', scope: 'us-east-1', id: problem.id }, context)).toBeNull();
    expect(readInvestigationById(db, { ...env, scope: 'eu-west-1', id: problem.id }, context)).toBeNull();
    expect(readInvestigationById(db, { ...env, id: 'nothing' }, context)).toBeNull();
  });

  it('serves the same timeline the Problem page renders, in the three bands', () => {
    const db = createTestDb();
    const problem = seed(db, { kind: 'ecs_tasks_below_desired' });
    const timeline = readInvestigationById(db, { ...env, id: problem.id }, context)?.timeline ?? [];
    expect(timeline.length).toBeGreaterThan(0);
    for (const entry of timeline) expect(['fact', 'correlation', 'hypothesis']).toContain(entry.kind);
    // A hypothesis carries a confidence; a fact is not a judgement and carries none.
    for (const entry of timeline.filter((one) => one.kind === 'fact')) expect(entry.confidence).toBeUndefined();
  });
});
