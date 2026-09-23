import { describe, expect, it } from 'vitest';
import { TIMELINE_FACT_LIMIT, readInvestigation, type InvestigationLabels } from '@/lib/read/investigation';
import { bucketOf } from '@/lib/detect/baseline';
import { opswatchDbProvider } from '@/lib/history/opswatch-db';
import { writeBaselines } from '@/lib/store/baselines';
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


describe('§8 — traffic_surge, from a stored baseline', () => {
  const STEP = 5 * 60_000;
  const key = { ...env, subjectId: 'prod/web', metric: 'requests' };

  /** A baseline for the hour the problem opens in, and the reading it opened at. */
  const seedTraffic = async (db: ReturnType<typeof createTestDb>, mad: number, value: number | null) => {
    writeBaselines(db, key, new Map([[bucketOf(NOW), { median: 100, mad, samples: 40 }]]), NOW);
    if (value === null) return;
    await opswatchDbProvider(db).write(
      [{
        category: 'metric' as const, ...key, ...env,
        intervalStart: Math.floor(NOW / STEP) * STEP,
        resolution: '5m' as const, value, samples: 1,
      }],
      NOW,
    );
  };

  const hypotheses = (db: ReturnType<typeof createTestDb>, problem: ReturnType<typeof seedProblem>) =>
    readInvestigation(db, problem, labels, NOW).timeline.filter((one) => one.kind === 'hypothesis').map((one) => one.type);

  it('THE RULING: a surge above §8’s threshold becomes a hypothesis', async () => {
    const db = createTestDb();
    const problem = seedProblem(db);
    await seedTraffic(db, 10, 1000);
    expect(hypotheses(db, problem)).toContain('traffic_surge');
  });

  it('THE RULING: ordinary traffic does not, and nor does no baseline at all', async () => {
    const quiet = createTestDb();
    const one = seedProblem(quiet);
    await seedTraffic(quiet, 10, 105);
    expect(hypotheses(quiet, one)).not.toContain('traffic_surge');

    // No baseline: the question was never asked, which must look the same as it does here and mean
    // something different — hence `notEvaluated` staying honest about the rest of the catalogue.
    const blank = createTestDb();
    const two = seedProblem(blank);
    expect(hypotheses(blank, two)).not.toContain('traffic_surge');
  });

  it('THE RULING: a baseline with no spread says nothing rather than calling everything a surge', async () => {
    const db = createTestDb();
    const problem = seedProblem(db);
    // A series that has been exactly 100 for a month. Every arithmetic answer is zero or infinity.
    await seedTraffic(db, 0, 100_000);
    expect(hypotheses(db, problem)).not.toContain('traffic_surge');
  });

  it('a baseline with no reading to compare against says nothing', async () => {
    const db = createTestDb();
    const problem = seedProblem(db);
    await seedTraffic(db, 10, null);
    expect(hypotheses(db, problem)).not.toContain('traffic_surge');
  });

  it('a problem with no service is compared with nothing, rather than with the account', async () => {
    const db = createTestDb();
    const problem = seedProblem(db, { serviceId: null, subjectId: 'prod/web' });
    await seedTraffic(db, 10, 1000);
    expect(hypotheses(db, problem)).not.toContain('traffic_surge');
  });
});
