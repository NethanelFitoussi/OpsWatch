import { describe, expect, it } from 'vitest';
import { deploymentDetailSchema, deploymentSummarySchema, decodeCursor } from '@opswatch/contract';
import { getDeployment, listDeploymentSummaries, recentDeployments, toDeploymentSummary } from '@/lib/read/deployments';
import { recordDeployments } from '@/lib/store/deployments';
import { insertProblem } from '@/lib/store/problems';
import type { SeenDeployment } from '@/lib/detect/deployment';
import { createTestDb } from '../helpers/db';
import { newProblem } from '../helpers/detect';

/**
 * What shipped, as every client reads it (DEP-3).
 *
 * Two rules shape it. The cursor is the immutable `(seq, id)` axis, never `startedAt` — which moves while a
 * rollout is in progress. And the problems beside a deployment are a **correlation**: they started after it,
 * on the same service, within the window. Nothing here says one caused the other (§7, §J).
 */

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const MINUTE = 60_000;
const env = { connectionId: 'c1', scope: 'us-east-1' };
const context = { nowMs: NOW, render: (key: string) => key };

const seen = (over: Partial<SeenDeployment> = {}): SeenDeployment => ({
  deploymentId: 'ecs-svc/1',
  serviceId: 'prod/web',
  serviceName: 'web',
  cluster: 'prod',
  taskDefinition: 'web:42',
  status: 'completed',
  startedAt: NOW - 20 * MINUTE,
  updatedAt: NOW - 10 * MINUTE,
  desiredCount: 3,
  runningCount: 3,
  failedTasks: 0,
  ...over,
});

const record = (db: ReturnType<typeof createTestDb>, ...deployments: SeenDeployment[]) =>
  recordDeployments(db, env, deployments, NOW);

describe('a deployment on the wire', () => {
  it('is exactly what every client parses', () => {
    const db = createTestDb();
    record(db, seen());
    const [summary] = listDeploymentSummaries(db, { ...env, cursor: null, limit: 10 }).items;
    expect(() => deploymentSummarySchema.parse(summary)).not.toThrow();
    expect(summary).toMatchObject({ id: 'ecs-svc/1', version: 'web:42', environment: 'prod', status: 'completed' });
  });

  it('THE RULING: the page orders by when each deployment started, not by when the collector noticed it', () => {
    const db = createTestDb();
    // Recorded newest first, as a cycle that read the running rollout before the finished one would.
    record(db, seen({ deploymentId: 'new', startedAt: NOW - MINUTE }));
    record(db, seen({ deploymentId: 'old', startedAt: NOW - 3 * 60 * MINUTE }));
    // A history ordered by discovery would read backwards for exactly this environment.
    expect(recentDeployments(db, env, 10).map((one) => one.id)).toEqual(['new', 'old']);
  });

  it('is scoped to its environment', () => {
    const db = createTestDb();
    record(db, seen());
    expect(listDeploymentSummaries(db, { connectionId: 'c1', scope: 'eu-west-1', cursor: null, limit: 10 }).items).toEqual([]);
  });
});

describe('§33.6 — the cursor', () => {
  it('THE RULING: resumes on an axis a running rollout cannot move', () => {
    const db = createTestDb();
    for (const n of [1, 2, 3]) record(db, seen({ deploymentId: `d${n}`, startedAt: NOW - n * 60 * MINUTE }));

    const first = listDeploymentSummaries(db, { ...env, cursor: null, limit: 2 });
    // The cursored order is the one nothing can reorder: most recently recorded first.
    expect(first.items.map((one) => one.id)).toEqual(['d3', 'd2']);
    expect(first.nextCursor).not.toBeNull();

    // The oldest rollout finishes between the two requests, moving its `startedAt` forward. A cursor on
    // that axis would now skip or repeat; on `seq` the second page is exactly what is left.
    record(db, seen({ deploymentId: 'd3', status: 'completed', startedAt: NOW - MINUTE, updatedAt: NOW }));

    const cursor = decodeCursor(first.nextCursor ?? '');
    expect(cursor).not.toBeNull();
    const second = listDeploymentSummaries(db, { ...env, cursor, limit: 2 });
    expect(second.items.map((one) => one.id)).toEqual(['d1']);
    expect(second.nextCursor).toBeNull();
  });
});

describe('the problems beside one deployment', () => {
  const problemAt = (db: ReturnType<typeof createTestDb>, key: string, firstSeenAt: number, serviceId = 'prod/web') =>
    insertProblem(db, newProblem({ key: key.padEnd(32, 'x'), serviceId, subjectId: serviceId, firstSeenAt, lastSeenAt: firstSeenAt }));

  it('THE RULING: only problems that started AFTER it, within the window, on the same service', () => {
    const db = createTestDb();
    record(db, seen());
    // Twelve minutes after: correlated. Before it started: not. Another service: not.
    problemAt(db, 'after', NOW - 8 * MINUTE);
    problemAt(db, 'before', NOW - 40 * MINUTE);
    problemAt(db, 'elsewhere', NOW - 8 * MINUTE, 'prod/worker');

    const detail = getDeployment(db, { ...env, id: 'ecs-svc/1' }, context);
    expect(detail?.relatedProblems.map((one) => one.problem.key)).toEqual(['afterxxxxxxxxxxxxxxxxxxxxxxxxxxx']);
    expect(detail?.relatedProblems[0].minutesAfterDeployment).toBe(12);
  });

  it('THE RULING: nothing in the detail claims a cause — only the delay is carried', () => {
    const db = createTestDb();
    record(db, seen());
    problemAt(db, 'after', NOW - 8 * MINUTE);

    const detail = getDeployment(db, { ...env, id: 'ecs-svc/1' }, context);
    expect(() => deploymentDetailSchema.parse(detail)).not.toThrow();
    // The only field relating the two is named for the observation, not for a conclusion.
    expect(Object.keys(detail?.relatedProblems[0] ?? {}).sort()).toEqual(['minutesAfterDeployment', 'problem']);
    // And OpsWatch offers nothing to do about it: it reads AWS and never rolls anything back.
    expect(detail?.allowedActions).toEqual([]);
  });

  it('THE RULING: a noisy neighbour cannot crowd this deployment’s own problems out of the list', () => {
    const db = createTestDb();
    record(db, seen());
    // Far more open problems on another service than the detail will consider.
    for (let n = 0; n < 25; n += 1) problemAt(db, `noise${n}`, NOW - 8 * MINUTE, 'prod/worker');
    problemAt(db, 'mine', NOW - 8 * MINUTE);

    // Filtering after the limit would have spent all twenty places on the neighbour and found nothing.
    expect(getDeployment(db, { ...env, id: 'ecs-svc/1' }, context)?.relatedProblems).toHaveLength(1);
  });

  it('a problem more than half an hour later is outside the window', () => {
    const db = createTestDb();
    record(db, seen({ startedAt: NOW - 90 * MINUTE }));
    problemAt(db, 'late', NOW - 50 * MINUTE);
    expect(getDeployment(db, { ...env, id: 'ecs-svc/1' }, context)?.relatedProblems).toEqual([]);
  });

  it('one from another environment reads as absent, not as somebody else’s', () => {
    const db = createTestDb();
    record(db, seen());
    expect(getDeployment(db, { connectionId: 'c1', scope: 'eu-west-1', id: 'ecs-svc/1' }, context)).toBeNull();
  });

  it('the summary it is built from is the same one the list serves', () => {
    const db = createTestDb();
    const row = recordDeployments(db, env, [seen()], NOW);
    expect(row.inserted).toBe(1);
    const detail = getDeployment(db, { ...env, id: 'ecs-svc/1' }, context);
    const [listed] = listDeploymentSummaries(db, { ...env, cursor: null, limit: 1 }).items;
    expect(toDeploymentSummary).toBeTypeOf('function');
    expect({ ...detail, relatedProblems: [], evidence: [], allowedActions: [] }).toMatchObject(listed);
  });
});
