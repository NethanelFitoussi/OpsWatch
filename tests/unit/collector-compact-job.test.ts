import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runCompact, runCompactJob, totalRemoved } from '@/lib/collector/compact-job';
import { dueJobs } from '@/lib/collector/runner';
import { opswatchDbProvider } from '@/lib/history/opswatch-db';
import { writeHistorySettings } from '@/lib/history/settings';
import { insertProblem, updateProblem } from '@/lib/store/problems';
import { readHistoryRange } from '@/lib/store/history';
import { RESOLVED_RETENTION_MS } from '@/lib/store/retention';
import { createTestDb } from '../helpers/db';
import { newProblem } from '../helpers/detect';

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const DAY = 24 * 60 * 60_000;
const env = { connectionId: 'c1', scope: 'us-east-1' };

/**
 * `run-job.ts` reaches for the real database and the real environment, so both are replaced here. The point
 * of going through it at all is that the bug was in the dispatcher, not in the job.
 */
let dispatchDb: ReturnType<typeof createTestDb>;
vi.mock('@/lib/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/client')>()),
  getDb: () => dispatchDb,
}));
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  env: () => ({ OPSWATCH_LOGS_BUDGET_GB_PER_DAY: 1 }),
}));
const { runJob } = await import('@/lib/collector/run-job');

beforeEach(() => {
  dispatchDb = createTestDb();
});

describe('the bug this job had', () => {
  /**
   * `compact` is the only instance-scoped job, so `dueJobs` emits it with no connection. `runJob` returned
   * early for any job without one — which is every instance-scoped job — so it was scheduled every day and
   * discarded every time. Retention was a setting that did nothing at all.
   */
  it('THE RULING: the scheduler emits compact with no connection, and it must still run', () => {
    const due = dueJobs({ nowMs: NOW, environments: [], lastRunAt: new Map(), enabled: ['compact'] });
    expect(due).toEqual([{ id: 'compact', connectionId: null, scope: null }]);
  });

  it('is dispatched despite having no connection, unlike an environment job', async () => {
    const db = dispatchDb;
    const resolved = insertProblem(db, newProblem({ firstSeenAt: NOW - 400 * DAY, lastSeenAt: NOW - 400 * DAY, lastEvaluatedAt: NOW - 400 * DAY }));
    updateProblem(db, resolved.id, { status: 'resolved', resolvedAt: NOW - RESOLVED_RETENTION_MS - DAY });

    // Through the real dispatcher, which is where the bug lived.
    const outcome = await runJob({ id: 'compact', connectionId: null, scope: null }, NOW);
    expect(outcome.covered).toBeGreaterThan(0);

    // An environment job with no connection still does nothing, which is the behaviour that was correct.
    expect(await runJob({ id: 'detect', connectionId: null, scope: null }, NOW)).toEqual({ covered: 0, total: 0 });
  });
});

describe('what a pass forgets', () => {
  it('removes a problem resolved longer ago than the window, and keeps a recent one', () => {
    const db = createTestDb();
    const old = insertProblem(db, newProblem({ key: 'a'.padEnd(32, 'x'), lastEvaluatedAt: NOW }));
    updateProblem(db, old.id, { status: 'resolved', resolvedAt: NOW - RESOLVED_RETENTION_MS - DAY });
    const recent = insertProblem(db, newProblem({ key: 'b'.padEnd(32, 'x'), lastEvaluatedAt: NOW }));
    updateProblem(db, recent.id, { status: 'resolved', resolvedAt: NOW - DAY });

    expect(runCompact(db, NOW).resolvedProblems).toBe(1);
  });

  it('THE RULING: history is purged at the retention the operator chose', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true, retentionDays: 30 }, NOW - 200 * DAY);
    const provider = opswatchDbProvider(db);
    const step = 5 * 60_000;
    const align = (at: number) => Math.floor(at / step) * step;
    const point = (at: number) => ({
      category: 'metric' as const, subjectId: 'ecs', metric: 'affected', ...env,
      intervalStart: align(at), resolution: '5m' as const, value: 1, samples: 1,
    });
    await provider.write([point(NOW - 60 * DAY), point(NOW - 2 * DAY)], NOW);

    const report = runCompact(db, NOW);
    expect(report.historyPoints).toBe(1);

    const series = { category: 'metric' as const, subjectId: 'ecs', metric: 'affected', ...env, resolution: '5m' as const };
    const left = readHistoryRange(db, series, NOW - 365 * DAY, NOW);
    expect(left).toHaveLength(1);
    // The one kept is the recent one, not whichever happened to be written last.
    expect(left[0]?.intervalStart).toBe(align(NOW - 2 * DAY));
  });

  it('honours a longer retention by keeping what a shorter one would have taken', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true, retentionDays: 365 }, NOW - 200 * DAY);
    await opswatchDbProvider(db).write(
      [{ category: 'metric', subjectId: 'ecs', metric: 'affected', ...env, intervalStart: Math.floor((NOW - 60 * DAY) / 300000) * 300000, resolution: '5m', value: 1, samples: 1 }],
      NOW,
    );
    expect(runCompact(db, NOW).historyPoints).toBe(0);
  });

  it('removes nothing from an installation with nothing to forget', () => {
    const report = runCompact(createTestDb(), NOW);
    expect(totalRemoved(report)).toBe(0);
    expect(runCompactJob({ db: createTestDb(), nowMs: NOW })).toEqual({ covered: 0, total: 0 });
  });

  it('reports a pass as complete, never as a fraction', () => {
    const db = createTestDb();
    const old = insertProblem(db, newProblem({ lastEvaluatedAt: NOW }));
    updateProblem(db, old.id, { status: 'resolved', resolvedAt: NOW - RESOLVED_RETENTION_MS - DAY });
    const outcome = runCompactJob({ db, nowMs: NOW });
    // A cap never truncates this job, so covered and total are the same number by construction.
    expect(outcome.covered).toBe(outcome.total);
  });
});
