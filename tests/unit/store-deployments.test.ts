import { describe, expect, it } from 'vitest';
import { countDeployments, findDeployment, listDeployments, recordDeployments } from '@/lib/store/deployments';
import type { SeenDeployment } from '@/lib/detect/deployment';
import { listEvents } from '@/lib/store/events';
import { createTestDb } from '../helpers/db';

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const env = { connectionId: 'c1', scope: 'us-east-1' };

const seen = (over: Partial<SeenDeployment> = {}): SeenDeployment => ({
  deploymentId: 'ecs-svc/1',
  serviceId: 'prod/web',
  serviceName: 'web',
  cluster: 'prod',
  taskDefinition: 'web:42',
  status: 'in_progress',
  startedAt: NOW - 600_000,
  updatedAt: NOW - 60_000,
  desiredCount: 3,
  runningCount: 2,
  failedTasks: 0,
  ...over,
});

const kinds = (db: ReturnType<typeof createTestDb>) =>
  listEvents(db, { ...env, sinceMs: 0, untilMs: NOW + 24 * 60 * 60_000 }, null, 50).items.map((event) => event.kind);

describe('one deployment, seen repeatedly', () => {
  it('THE RULING: the same deployment seen again updates the row rather than adding another', () => {
    const db = createTestDb();
    expect(recordDeployments(db, env, [seen()], NOW)).toMatchObject({ inserted: 1, updated: 0 });
    // A five-minute job watching a ten-minute rollout must not produce a row per poll.
    expect(recordDeployments(db, env, [seen({ runningCount: 3 })], NOW + 300_000)).toMatchObject({ inserted: 0, updated: 1 });

    expect(listDeployments(db, env, 10)).toHaveLength(1);
    expect(findDeployment(db, env.connectionId, env.scope, 'ecs-svc/1')?.runningCount).toBe(3);
  });

  it('THE RULING: a settled deployment is never rewritten', () => {
    const db = createTestDb();
    recordDeployments(db, env, [seen({ status: 'completed', updatedAt: NOW - 60_000 })], NOW);
    // A later cycle still lists it. Moving its timestamps would make a finished rollout look like it
    // happened just now, and every timeline built on it would be wrong.
    recordDeployments(db, env, [seen({ status: 'completed', updatedAt: NOW + 900_000 })], NOW + 900_000);

    const row = findDeployment(db, env.connectionId, env.scope, 'ecs-svc/1');
    expect(row?.updatedAt).toBe(NOW - 60_000);
  });

  it('records the outcome when a rollout finishes', () => {
    const db = createTestDb();
    recordDeployments(db, env, [seen({ status: 'in_progress' })], NOW);
    expect(kinds(db)).toEqual(['deployment_started']);

    const result = recordDeployments(db, env, [seen({ status: 'failed', failedTasks: 2 })], NOW + 300_000);
    expect(result.settled).toBe(1);
    expect(kinds(db).sort()).toEqual(['deployment_failed', 'deployment_started']);
  });

  it('THE RULING: a deployment first seen already finished still records its outcome', () => {
    const db = createTestDb();
    // A rollout that completed between two cycles would otherwise never appear as having completed.
    recordDeployments(db, env, [seen({ status: 'completed' })], NOW);
    expect(kinds(db).sort()).toEqual(['deployment_completed', 'deployment_started']);
  });

  it('does not repeat an event when the same outcome is seen twice', () => {
    const db = createTestDb();
    recordDeployments(db, env, [seen({ status: 'completed' })], NOW);
    recordDeployments(db, env, [seen({ status: 'completed' })], NOW + 300_000);
    expect(kinds(db)).toHaveLength(2);
  });
});

describe('reading them back', () => {
  it('lists newest first, within a window', () => {
    const db = createTestDb();
    recordDeployments(
      db,
      env,
      [seen({ deploymentId: 'a', startedAt: NOW - 1000 }), seen({ deploymentId: 'b', startedAt: NOW - 90 * 24 * 60 * 60_000 })],
      NOW,
    );
    expect(listDeployments(db, env, 10).map((row) => row.deploymentId)).toEqual(['a', 'b']);
    expect(listDeployments(db, { ...env, sinceMs: NOW - 60_000 }, 10).map((row) => row.deploymentId)).toEqual(['a']);
  });

  it('scopes to a service when asked', () => {
    const db = createTestDb();
    recordDeployments(db, env, [seen({ deploymentId: 'a' }), seen({ deploymentId: 'b', serviceId: 'prod/api' })], NOW);
    expect(listDeployments(db, { ...env, serviceId: 'prod/api' }, 10).map((row) => row.deploymentId)).toEqual(['b']);
  });

  it('keeps two environments apart', () => {
    const db = createTestDb();
    recordDeployments(db, env, [seen()], NOW);
    recordDeployments(db, { connectionId: 'c1', scope: 'eu-west-1' }, [seen()], NOW);
    expect(listDeployments(db, env, 10)).toHaveLength(1);
    expect(listDeployments(db, { connectionId: 'c1', scope: 'eu-west-1' }, 10)).toHaveLength(1);
  });

  it('counts how many shipped and how many failed', () => {
    const db = createTestDb();
    recordDeployments(
      db,
      env,
      [seen({ deploymentId: 'a', status: 'completed' }), seen({ deploymentId: 'b', status: 'failed' }), seen({ deploymentId: 'c', status: 'in_progress' })],
      NOW,
    );
    expect(countDeployments(db, env)).toEqual({ total: 3, failed: 1 });
  });
});
