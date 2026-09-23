import { describe, expect, it } from 'vitest';
import { readDiagnosis } from '@/lib/read/diagnosis';
import { opswatchDbProvider } from '@/lib/history/opswatch-db';
import { writeHistorySettings } from '@/lib/history/settings';
import { appendEvent } from '@/lib/store/events';
import { insertProblem, listLiveProblems } from '@/lib/store/problems';
import { createTestDb } from '../helpers/db';
import { newProblem } from '../helpers/detect';

/**
 * What a problem page can draw (UX-18).
 *
 * The rulings are about the two kinds of empty. A chart with no line and a chart nobody collected data for
 * look identical and mean opposite things, and only one of them is something an operator can change.
 */

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const MINUTE = 60_000;
const env = { connectionId: 'c1', scope: 'us-east-1' };

const seed = (db: ReturnType<typeof createTestDb>, over = {}) =>
  insertProblem(db, newProblem({ kind: 'alb_elb_5xx_count', subjectId: 'alb-prod', subjectName: 'alb-prod', values: { loadBalancer: 'alb-prod', count: 23 }, firstSeenAt: NOW - 30 * MINUTE, lastSeenAt: NOW, lastEvaluatedAt: NOW, ...over }));

const row = (db: ReturnType<typeof createTestDb>) => listLiveProblems(db, env.connectionId, env.scope)[0].row;

describe('the lifecycle a reader can see', () => {
  it('carries the moment it opened, from the events spine', () => {
    const db = createTestDb();
    const problem = seed(db);
    // The lifecycle writes this in production; the test writes it directly rather than driving a cycle.
    appendEvent(db, {
      at: NOW - 30 * MINUTE,
      ...env,
      kind: 'problem_opened',
      subjectType: 'resource',
      subjectId: 'alb-prod',
      serviceId: null,
      severity: 'warning',
      source: 'aws',
      payload: { problemId: problem.id },
      dedupeKey: `problem_opened:${problem.id}`,
    });

    const marks = readDiagnosis(db, row(db)).timeline;
    // The spine is written whether or not historical collection is on, so this is always available.
    expect(marks.map((mark) => mark.kind)).toContain('opened');
    expect(marks.every((mark, index) => index === 0 || mark.at >= marks[index - 1].at)).toBe(true);
  });
});

describe('THE RULING: two kinds of empty, never rendered the same', () => {
  it('draws nothing and says history is off, when it is', () => {
    const db = createTestDb();
    seed(db);
    const diagnosis = readDiagnosis(db, row(db));
    expect(diagnosis.historyEnabled).toBe(false);
    expect(diagnosis.series).toEqual([]);
  });

  it('with history on and nothing stored, still draws nothing — but says which emptiness it is', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - 24 * 60 * MINUTE);
    seed(db);
    const diagnosis = readDiagnosis(db, row(db));
    expect(diagnosis.historyEnabled).toBe(true);
    // A line at zero would claim a measurement of zero, which nobody took.
    expect(diagnosis.series).toEqual([]);
  });

  it('draws the stored signal once there is one', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - 24 * 60 * MINUTE);
    seed(db);
    const step = 5 * MINUTE;
    const base = Math.floor((NOW - 25 * MINUTE) / step) * step;
    await opswatchDbProvider(db).write(
      [0, 1, 2].flatMap((i) => [
        { category: 'metric' as const, subjectId: 'alb-prod', metric: 'elb5xx', ...env, intervalStart: base + i * step, resolution: '5m' as const, value: 5 + i, samples: 1 },
        { category: 'metric' as const, subjectId: 'alb-prod', metric: 'requests', ...env, intervalStart: base + i * step, resolution: '5m' as const, value: 1000, samples: 1 },
      ]),
      NOW,
    );

    const series = readDiagnosis(db, row(db)).series;
    expect(series.map((one) => one.metric).sort()).toEqual(['elb5xx', 'requests']);
    expect(series.find((one) => one.metric === 'elb5xx')?.values).toEqual([5, 6, 7]);
  });

  it('THE RULING: an unmeasured interval is left out of the line, not drawn as zero', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - 24 * 60 * MINUTE);
    seed(db);
    const step = 5 * MINUTE;
    const base = Math.floor((NOW - 25 * MINUTE) / step) * step;
    await opswatchDbProvider(db).write(
      [5, null, 7].map((value, i) => ({
        category: 'metric' as const, subjectId: 'alb-prod', metric: 'elb5xx', ...env,
        intervalStart: base + i * step, resolution: '5m' as const, value, samples: 1,
      })),
      NOW,
    );
    expect(readDiagnosis(db, row(db)).series.find((one) => one.metric === 'elb5xx')?.values).toEqual([5, 7]);
  });

  it('THE RULING: history turned off stops the chart, even where rollups from before it remain', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - 24 * 60 * MINUTE);
    seed(db);
    const step = 5 * MINUTE;
    const base = Math.floor((NOW - 25 * MINUTE) / step) * step;
    await opswatchDbProvider(db).write(
      [0, 1].map((i) => ({
        category: 'metric' as const, subjectId: 'alb-prod', metric: 'elb5xx', ...env,
        intervalStart: base + i * step, resolution: '5m' as const, value: 5, samples: 1,
      })),
      NOW,
    );
    expect(readDiagnosis(db, row(db)).series).toHaveLength(1);

    // Turned off after those rollups were stored. The switch is the operator's decision about what this
    // instance collects, and a page that kept drawing would be ignoring it.
    writeHistorySettings(db, { enabled: false }, NOW);
    const after = readDiagnosis(db, row(db));
    expect(after.historyEnabled).toBe(false);
    expect(after.series).toEqual([]);
  });

  it('draws nothing for a detector family with no series worth showing', () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - 24 * 60 * MINUTE);
    seed(db, { kind: 'alarm_firing', values: { alarm: 'x' } });
    expect(readDiagnosis(db, row(db)).series).toEqual([]);
  });
});
