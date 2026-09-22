import { describe, expect, it } from 'vitest';
import { appendEvent, appendEvents, deleteEventsBefore, listEvents, type NewEvent } from '@/lib/store/events';
import { deleteRunsBefore, finishRun, lastRuns, startRun } from '@/lib/store/collector';
import { createTestDb } from '../helpers/db';

const AT = Date.UTC(2026, 8, 19, 9, 0, 0);
const event = (over: Partial<NewEvent> = {}): NewEvent => ({
  at: AT, connectionId: 'c1', scope: 'us-east-1', kind: 'problem_opened',
  subjectType: 'service', subjectId: 'prod/web', serviceId: 'prod/web',
  severity: 'critical', source: 'aws', payload: { problemId: 'p1' }, dedupeKey: null, ...over,
});

describe('the events spine', () => {
  it('appends, pages on seq and filters by subject and window', () => {
    const db = createTestDb();
    appendEvent(db, event({ subjectId: 'a' }));
    appendEvent(db, event({ subjectId: 'b', at: AT + 1000 }));
    appendEvent(db, event({ subjectId: 'a', at: AT + 2000, kind: 'problem_resolved' }));
    expect(listEvents(db, { subjectId: 'a' }, null, 10).items).toHaveLength(2);
    expect(listEvents(db, { sinceMs: AT + 500 }, null, 10).items).toHaveLength(2);
    const page = listEvents(db, {}, null, 2);
    expect(page.items.map((e) => e.seq)).toEqual([1, 2]);
    expect(listEvents(db, {}, { afterSeq: page.nextSeq as number, afterId: page.nextId as string }, 2).items.map((e) => e.seq)).toEqual([3]);
  });

  it('never writes the same dedupeKey twice, and says so by returning null', () => {
    const db = createTestDb();
    expect(appendEvent(db, event({ dedupeKey: 'd1' }))).not.toBeNull();
    expect(appendEvent(db, event({ dedupeKey: 'd1', at: AT + 5 }))).toBeNull();
    expect(listEvents(db, {}, null, 10).items).toHaveLength(1);
    // Two null dedupe keys are not a conflict: the index is partial.
    appendEvent(db, event());
    appendEvent(db, event());
    expect(listEvents(db, {}, null, 10).items).toHaveLength(3);
  });

  it('writes a large batch in bounded transactions', async () => {
    const db = createTestDb();
    const written = await appendEvents(db, Array.from({ length: 2500 }, (_, i) => event({ at: AT + i, subjectId: `s${i}` })));
    expect(written).toBe(2500);
    expect(listEvents(db, {}, null, 1).items[0].seq).toBe(1);
  });

  it('purges only the kinds it is asked for', () => {
    const db = createTestDb();
    appendEvent(db, event({ at: AT, kind: 'resource_appeared' }));
    appendEvent(db, event({ at: AT, kind: 'problem_opened' }));
    expect(deleteEventsBefore(db, AT + 1, ['resource_appeared'])).toBe(1);
    expect(listEvents(db, {}, null, 10).items.map((e) => e.kind)).toEqual(['problem_opened']);
  });
});

describe('collector runs', () => {
  it('records what a job covered and what a cap truncated', () => {
    const db = createTestDb();
    const run = startRun(db, { job: 'inventory', connectionId: 'c1', scope: 'us-east-1', startedAt: AT });
    expect(run.status).toBe('running');
    finishRun(db, run.id, { finishedAt: AT + 2000, status: 'ok', covered: 40, total: 60, truncated: true });
    const [latest] = lastRuns(db, 10);
    expect({ status: latest.status, covered: latest.covered, total: latest.total, truncated: latest.truncated })
      .toEqual({ status: 'ok', covered: 40, total: 60, truncated: true });
    expect((latest.finishedAt as number) - latest.startedAt).toBe(2000);
  });
});

describe('what the collector keeps', () => {
  it('leaves a run that never finished as `running`, so a job that died is not mistaken for one that never ran', () => {
    const db = createTestDb();
    startRun(db, { job: 'detect', connectionId: 'c1', scope: 'us-east-1', startedAt: AT });
    const [latest] = lastRuns(db, 10);
    expect({ status: latest.status, finishedAt: latest.finishedAt, truncated: latest.truncated })
      .toEqual({ status: 'running', finishedAt: null, truncated: false });
  });

  it('returns the runs newest first and purges only the ones older than the window', () => {
    const db = createTestDb();
    const old = startRun(db, { job: 'inventory', connectionId: null, scope: null, startedAt: AT });
    const recent = startRun(db, { job: 'detect', connectionId: null, scope: null, startedAt: AT + 10_000 });
    expect(lastRuns(db, 10).map((run) => run.id)).toEqual([recent.id, old.id]);
    expect(deleteRunsBefore(db, AT + 1)).toBe(1);
    expect(lastRuns(db, 10).map((run) => run.id)).toEqual([recent.id]);
  });
});
