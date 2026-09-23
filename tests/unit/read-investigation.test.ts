import { describe, expect, it } from 'vitest';
import { TIMELINE_FACT_LIMIT, readInvestigation, type InvestigationLabels } from '@/lib/read/investigation';
import { appendEvent } from '@/lib/store/events';
import { insertProblem } from '@/lib/store/problems';
import { createTestDb } from '../helpers/db';
import { newProblem } from '../helpers/detect';

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const MINUTE = 60_000;
const env = { connectionId: 'c1', scope: 'us-east-1' };

/** Deterministic, so a test asserts structure rather than copy. */
const labels: InvestigationLabels = {
  fact: (type) => `fact:${type}`,
  correlation: ({ minutes, relation }) => `pair:${minutes}:${relation}`,
  hypothesis: (id) => `hypothesis:${id}`,
  confirmedBy: (key) => `confirm:${key}`,
  notEvaluated: (ids) => `notEvaluated:${ids.length}`,
};

const seedProblem = (db: ReturnType<typeof createTestDb>, over = {}) =>
  insertProblem(db, newProblem({ firstSeenAt: NOW, lastSeenAt: NOW, lastEvaluatedAt: NOW, ...over }));

const seedEvent = (db: ReturnType<typeof createTestDb>, kind: string, at: number, over: Record<string, unknown> = {}) =>
  appendEvent(db, {
    at,
    ...env,
    kind: kind as Parameters<typeof appendEvent>[1]['kind'],
    subjectType: 'service',
    subjectId: 'prod/web',
    serviceId: 'prod/web',
    severity: null,
    source: 'aws',
    payload: {},
    dedupeKey: `${kind}:${at}`,
    ...over,
  });

describe('§7 — the three bands reach the wire as three kinds', () => {
  it('THE RULING: a hypothesis is never emitted with kind "fact"', () => {
    const db = createTestDb();
    const problem = seedProblem(db, { kind: 'ecs_tasks_below_desired' });
    const { timeline } = readInvestigation(db, problem, labels, NOW);

    const hypotheses = timeline.filter((item) => item.type === 'capacity_shortfall');
    expect(hypotheses).toHaveLength(1);
    // Merging the bands would let a guess inherit the authority of a measurement.
    expect(hypotheses[0]?.kind).toBe('hypothesis');
    expect(timeline.filter((item) => item.kind === 'fact').map((item) => item.type)).not.toContain('capacity_shortfall');
  });

  it('THE RULING: only a hypothesis carries a confidence', () => {
    const db = createTestDb();
    seedEvent(db, 'deployment_started', NOW - 5 * MINUTE, { payload: { taskDefinition: 'web:42' } });
    const problem = seedProblem(db);
    const { timeline } = readInvestigation(db, problem, labels, NOW);

    for (const item of timeline) {
      // A confidence on a fact would be a category error: a fact is not a judgement.
      if (item.kind !== 'hypothesis') expect(item.confidence, item.id).toBeUndefined();
    }
    expect(timeline.some((item) => item.kind === 'hypothesis' && item.confidence !== undefined)).toBe(true);
  });

  it('emits a fact for each recorded event in the window', () => {
    const db = createTestDb();
    seedEvent(db, 'deployment_started', NOW - 5 * MINUTE, { payload: { taskDefinition: 'web:42' } });
    seedEvent(db, 'error_group_appeared', NOW - 2 * MINUTE);
    const problem = seedProblem(db);

    const facts = readInvestigation(db, problem, labels, NOW).timeline.filter((item) => item.kind === 'fact');
    expect(facts.map((item) => item.type).sort()).toEqual(['deployment_started', 'error_group_appeared']);
  });

  it('pairs facts with the problem and states the measured gap', () => {
    const db = createTestDb();
    seedEvent(db, 'deployment_started', NOW - 8 * MINUTE, { payload: { taskDefinition: 'web:42' } });
    const problem = seedProblem(db);

    const correlations = readInvestigation(db, problem, labels, NOW).timeline.filter((item) => item.kind === 'correlation');
    expect(correlations).toHaveLength(1);
    expect(correlations[0]?.title).toBe('pair:8:same_subject');
  });

  it('declares the catalogue entries it could not evaluate', () => {
    const db = createTestDb();
    const { notEvaluated } = readInvestigation(db, seedProblem(db), labels, NOW);
    expect(notEvaluated.length).toBeGreaterThan(0);
  });

  it('counts reopenings in §5\u2019s window, so an old flap does not read as noise today', () => {
    const db = createTestDb();
    const problem = seedProblem(db);
    // Three reopenings, but a year ago: outside the window, so not noise.
    for (let i = 0; i < 3; i += 1) {
      seedEvent(db, 'problem_reopened', NOW - 365 * 24 * 60 * 60_000 - i * 1000, {
        payload: { problemId: problem.id },
        dedupeKey: `old-reopen-${i}`,
      });
    }
    expect(readInvestigation(db, problem, labels, NOW).timeline.map((item) => item.type)).not.toContain('noise');

    for (let i = 0; i < 3; i += 1) {
      seedEvent(db, 'problem_reopened', NOW - (i + 1) * 60 * 60_000, {
        payload: { problemId: problem.id },
        dedupeKey: `recent-reopen-${i}`,
      });
    }
    expect(readInvestigation(db, problem, labels, NOW).timeline.map((item) => item.type)).toContain('noise');
  });

  it('is empty when nothing was recorded, rather than offering a guess with no facts', () => {
    const db = createTestDb();
    const { timeline } = readInvestigation(db, seedProblem(db), labels, NOW);
    expect(timeline).toEqual([]);
  });

  it('bounds how many facts one timeline can carry', () => {
    expect(TIMELINE_FACT_LIMIT).toBeGreaterThan(0);
    expect(TIMELINE_FACT_LIMIT).toBeLessThanOrEqual(200);
  });

  it('ignores events from another environment', () => {
    const db = createTestDb();
    seedEvent(db, 'deployment_started', NOW - 5 * MINUTE, { connectionId: 'other', payload: { taskDefinition: 'x' } });
    const { timeline } = readInvestigation(db, seedProblem(db), labels, NOW);
    expect(timeline.filter((item) => item.kind === 'fact')).toEqual([]);
  });
});
