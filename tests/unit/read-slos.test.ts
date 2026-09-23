import { describe, expect, it } from 'vitest';
import { writeHistorySettings } from '@/lib/history/settings';
import { opswatchDbProvider } from '@/lib/history/opswatch-db';
import { bucketsFor, expectedBuckets, listSloSummaries, measure, windowLabel, windowOf, MAX_WINDOW_DAYS } from '@/lib/read/slos';
import { listSloDefinitions, objectiveFor, upsertSloDefinition } from '@/lib/store/slos';
import { createTestDb } from '../helpers/db';

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const STEP = 5 * 60_000;
const env = { connectionId: 'c1', scope: 'us-east-1' };
const SUBJECT = 'app/prod-web/1a2b3c';

const define = (db: ReturnType<typeof createTestDb>, over: Partial<Parameters<typeof upsertSloDefinition>[1]> = {}) =>
  upsertSloDefinition(
    db,
    {
      ...env,
      name: 'Checkout availability',
      kind: 'availability',
      subjectId: SUBJECT,
      objective: 0.99,
      latencyThresholdMs: null,
      // One day, so a test can fill enough intervals to clear the coverage floor without writing a month.
      windowDays: 1,
      enabled: true,
      ...over,
    },
    NOW,
  );

/** Fills a window with availability rollups. `bad` is how many of each interval's requests were 5xx. */
async function fill(db: ReturnType<typeof createTestDb>, intervals: number, requests: number, bad: number, subject = SUBJECT) {
  const base = Math.floor((NOW - intervals * STEP) / STEP) * STEP;
  const points = Array.from({ length: intervals }, (_, i) => i).flatMap((i) => [
    { metric: 'requests', value: requests },
    { metric: 'elb5xx', value: bad },
    { metric: 'target5xx', value: 0 },
  ].map((point) => ({
    category: 'metric' as const,
    subjectId: subject,
    ...env,
    intervalStart: base + i * STEP,
    resolution: '5m' as const,
    samples: 1,
    ...point,
  })));
  await opswatchDbProvider(db).write(points, NOW);
}

describe('defining an objective (§19, SLO-1)', () => {
  it('THE RULING: saving under an existing name changes that objective rather than adding a second', () => {
    const db = createTestDb();
    define(db);
    define(db, { objective: 0.999 });

    const all = listSloDefinitions(db, env.connectionId, env.scope);
    expect(all).toHaveLength(1);
    expect(all[0].objective).toBe(0.999);
  });

  it('is scoped to its environment, so another region does not inherit it', () => {
    const db = createTestDb();
    define(db);
    expect(listSloDefinitions(db, env.connectionId, 'eu-west-1')).toHaveLength(0);
  });

  it('answers which objective a subject was given, and null when nobody gave it one', () => {
    const db = createTestDb();
    define(db);
    expect(objectiveFor(db, env.connectionId, env.scope, SUBJECT)?.objective).toBe(0.99);
    expect(objectiveFor(db, env.connectionId, env.scope, 'app/other/9z')).toBeNull();
  });

  it('a disabled definition is not what a report measures against', () => {
    const db = createTestDb();
    define(db, { enabled: false });
    // Paused, not deleted: it is still listed, and it is not used.
    expect(listSloDefinitions(db, env.connectionId, env.scope)).toHaveLength(1);
    expect(objectiveFor(db, env.connectionId, env.scope, SUBJECT)).toBeNull();
  });

  it('a latency definition is not mistaken for the availability one of the same subject', () => {
    const db = createTestDb();
    define(db, { name: 'Checkout latency', kind: 'latency', latencyThresholdMs: 500 });
    expect(objectiveFor(db, env.connectionId, env.scope, SUBJECT)).toBeNull();
  });
});

describe('measuring one (§19, SLO-2)', () => {
  it('THE RULING: a sparse window states a target and no figure, rather than a ratio over what exists', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - STEP * 10);
    define(db);
    // Ten of a day's 288 intervals: three per cent covered, below the floor.
    await fill(db, 10, 100, 0);

    const result = measure(db, listSloDefinitions(db, env.connectionId, env.scope)[0], NOW);
    expect(result.current).toBeNull();
    expect(result.reason).toBe('not_enough_history');
    expect(result.status).toBe('unknown');
  });

  it('measures the ratio once enough of the window is covered', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - 2 * 24 * 60 * 60_000);
    define(db);
    // The whole day, one request in a hundred failing: exactly 99 %, which is the objective.
    await fill(db, 288, 100, 1);

    const result = measure(db, listSloDefinitions(db, env.connectionId, env.scope)[0], NOW);
    expect(result.current).toBeCloseTo(0.99, 6);
    // The budget is exactly spent, which §19 calls breached rather than healthy.
    expect(result.status).toBe('breached');
  });

  it('THE RULING: the same history against a stricter objective is a different verdict', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - 2 * 24 * 60 * 60_000);
    await fill(db, 288, 1000, 1);

    // A tenth of a per cent failing. Against 99 % that is comfortable; against 99.99 % it is spent.
    const lenient = measure(db, define(db, { name: 'Lenient', objective: 0.99 }), NOW);
    const strict = measure(db, define(db, { name: 'Strict', objective: 0.9999 }), NOW);
    expect(lenient.status).toBe('healthy');
    expect(strict.status).toBe('breached');
    // Same measurement, both times: the objective changed, not the history.
    expect(lenient.current).toBeCloseTo(strict.current ?? 0, 9);
  });

  it('a latency objective with no threshold measures nothing rather than passing every interval', () => {
    const db = createTestDb();
    const definition = define(db, { kind: 'latency', latencyThresholdMs: null });
    expect(bucketsFor(db, definition, windowOf(definition, NOW))).toHaveLength(0);
  });

  it('compares a stored p95 in seconds against a threshold typed in milliseconds', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - 2 * 24 * 60 * 60_000);
    const base = Math.floor((NOW - 4 * STEP) / STEP) * STEP;
    // 0.4 s and 0.6 s, against a 500 ms threshold: one good interval and one bad.
    await opswatchDbProvider(db).write(
      [0.4, 0.6].map((value, i) => ({
        category: 'metric' as const,
        subjectId: SUBJECT,
        ...env,
        metric: 'p95',
        intervalStart: base + i * STEP,
        resolution: '5m' as const,
        value,
        samples: 1,
      })),
      NOW,
    );

    const definition = define(db, { kind: 'latency', latencyThresholdMs: 500 });
    expect(bucketsFor(db, definition, windowOf(definition, NOW))).toEqual([{ good: 1, total: 1 }, { good: 0, total: 1 }]);
  });
});

describe('what a summary says when it cannot say anything', () => {
  it('THE RULING: with history off the objectives are still listed and none of them reports a figure', async () => {
    const db = createTestDb();
    define(db);
    // History was on long enough to store a full day, then turned off.
    writeHistorySettings(db, { enabled: true }, NOW - 2 * 24 * 60 * 60_000);
    await fill(db, 288, 100, 0);
    writeHistorySettings(db, { enabled: false }, NOW);

    const [summary] = listSloSummaries(db, env, NOW);
    // The target is the operator's and survives; the figure is a measurement and does not.
    expect(summary.target).toBe(0.99);
    expect(summary.current).toBeNull();
    expect(summary.status).toBe('unknown');
  });

  it('never puts an infinite burn rate into a summary, because no client can render one', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - 2 * 24 * 60 * 60_000);
    // A perfect objective leaves no budget at all, so any failure burns infinitely fast.
    define(db, { objective: 1 });
    await fill(db, 288, 100, 1);

    const [summary] = listSloSummaries(db, env, NOW);
    expect(summary.burnRate).toBeNull();
    expect(summary.status).toBe('breached');
  });

  it('only enabled objectives are measured, and a disabled one is simply not in the list', () => {
    const db = createTestDb();
    define(db, { name: 'Paused', enabled: false });
    expect(listSloSummaries(db, env, NOW)).toHaveLength(0);
  });
});

describe('the window', () => {
  it('is clamped, so a definition cannot ask a page to walk a decade', () => {
    expect(windowOf({ windowDays: 4000 }, NOW).from).toBe(NOW - MAX_WINDOW_DAYS * 24 * 60 * 60_000);
    expect(windowOf({ windowDays: 0 }, NOW).from).toBe(NOW - 24 * 60 * 60_000);
    expect(windowLabel(4000)).toBe('90d');
  });

  it('counts the intervals the window should contain, so a gap reads as a gap', () => {
    expect(expectedBuckets({ from: NOW - 24 * 60 * 60_000, to: NOW })).toBe(288);
  });
});
