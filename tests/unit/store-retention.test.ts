import { describe, expect, it } from 'vitest';
import { insertProblem, pageProblems, updateProblem } from '@/lib/store/problems';
import { appendEvent, listEvents } from '@/lib/store/events';
import {
  COLLECTOR_RUN_RETENTION_MS,
  LIFECYCLE_EVENT_RETENTION_MS,
  OBSERVATION_EVENT_KINDS,
  OBSERVATION_EVENT_RETENTION_MS,
  RESOLVED_RETENTION_MS,
  runRetention,
} from '@/lib/store/retention';
import { EVENT_KINDS } from '@/lib/db/schema';
import { startRun } from '@/lib/store/collector';
import { createTestDb } from '../helpers/db';
import { newProblem } from '../helpers/detect';

const AT = Date.UTC(2026, 8, 19, 9, 0, 0);

describe('retention', () => {
  it('keeps a resolved problem for 30 days and then deletes it with its evidence', () => {
    const db = createTestDb();
    const old = insertProblem(db, newProblem({ key: 'a'.repeat(32) }));
    const fresh = insertProblem(db, newProblem({ key: 'b'.repeat(32), subjectId: 's2' }));
    updateProblem(db, old.id, { status: 'resolved', resolvedAt: AT });
    updateProblem(db, fresh.id, { status: 'resolved', resolvedAt: AT + 1 });
    const report = runRetention(db, AT + RESOLVED_RETENTION_MS + 1);
    expect(report.resolvedProblems).toBe(1);
    const left = pageProblems(db, { connectionId: 'c1', scope: 'us-east-1', status: ['resolved'] }, null, 10).items;
    expect(left.map((p) => p.id)).toEqual([fresh.id]);
    expect(db.$client.prepare('select count(*) as n from problem_evidence').get()).toEqual({ n: 1 });
  });

  it('never deletes an open problem, however old', () => {
    const db = createTestDb();
    insertProblem(db, newProblem({ firstSeenAt: 0, lastSeenAt: 0 }));
    expect(runRetention(db, AT + RESOLVED_RETENTION_MS * 10).resolvedProblems).toBe(0);
  });

  it('purges observation events at 90 days and lifecycle events at 13 months', () => {
    const db = createTestDb();
    appendEvent(db, { at: AT, connectionId: 'c1', scope: 'us-east-1', kind: 'resource_appeared', subjectType: 'resource', subjectId: 'r1', serviceId: null, severity: null, source: 'aws', payload: {}, dedupeKey: null });
    appendEvent(db, { at: AT, connectionId: 'c1', scope: 'us-east-1', kind: 'problem_opened', subjectType: 'service', subjectId: 's1', serviceId: null, severity: 'critical', source: 'aws', payload: {}, dedupeKey: null });
    const report = runRetention(db, AT + 91 * 24 * 60 * 60_000);
    expect({ obs: report.observationEvents, life: report.lifecycleEvents }).toEqual({ obs: 1, life: 0 });
    expect(listEvents(db, {}, null, 10).items.map((e) => e.kind)).toEqual(['problem_opened']);
  });
});

const DAY = 24 * 60 * 60_000;

describe('the retention windows themselves', () => {
  // These are data-loss boundaries: a silent change here deletes history nobody asked to lose, and no behavioural
  // test would notice because the deletion is exactly what the code is for. So the windows are pinned to §9.4.
  it('holds the windows §9.4 and §33.2 fix', () => {
    expect(RESOLVED_RETENTION_MS).toBe(30 * DAY);
    expect(OBSERVATION_EVENT_RETENTION_MS).toBe(90 * DAY);
    // 13 months, so a year-on-year comparison always has the year before it to compare with.
    expect(LIFECYCLE_EVENT_RETENTION_MS).toBe(396 * DAY);
    expect(COLLECTOR_RUN_RETENTION_MS).toBe(30 * DAY);
    expect(OBSERVATION_EVENT_RETENTION_MS).toBeLessThan(LIFECYCLE_EVENT_RETENTION_MS);
  });

  it('names only real event kinds as observations, and leaves a non-empty lifecycle family behind', () => {
    // Every kind is purged by exactly one of the two families: observations, or the complement that is everything
    // else. A name here that is not a real kind would silently purge nothing and leave that family growing.
    const observations = new Set<string>(OBSERVATION_EVENT_KINDS);
    expect(OBSERVATION_EVENT_KINDS.filter((kind) => !(EVENT_KINDS as readonly string[]).includes(kind))).toEqual([]);
    expect(EVENT_KINDS.filter((kind) => !observations.has(kind)).length).toBeGreaterThan(0);
    expect(observations.size).toBe(OBSERVATION_EVENT_KINDS.length);
  });

  it('purges collector runs older than the window and keeps the rest', () => {
    const db = createTestDb();
    startRun(db, { job: 'inventory', connectionId: null, scope: null, startedAt: AT });
    startRun(db, { job: 'detect', connectionId: null, scope: null, startedAt: AT + COLLECTOR_RUN_RETENTION_MS });
    expect(runRetention(db, AT + COLLECTOR_RUN_RETENTION_MS + 1).collectorRuns).toBe(1);
  });
});
