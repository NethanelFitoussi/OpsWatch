import { describe, expect, it } from 'vitest';
import { DEPLOYMENT_STATUSES as CONTRACT_STATUSES } from '@opswatch/contract';
import { DEPLOYMENT_STATUSES, deploymentStatus, isSettled, seenDeployments, toSeenDeployment, type EcsDeploymentInput } from '@/lib/detect/deployment';
import { DEPLOYMENT_STATUSES as STORED_STATUSES } from '@/lib/db/schema';

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);

const ecs = (over: Partial<EcsDeploymentInput> = {}): EcsDeploymentInput => ({
  id: 'ecs-svc/1',
  status: 'PRIMARY',
  rolloutState: 'COMPLETED',
  taskDefinition: 'web:42',
  desiredCount: 3,
  runningCount: 3,
  pendingCount: 0,
  failedTasks: 0,
  createdAt: NOW - 600_000,
  updatedAt: NOW - 60_000,
  ...over,
});

describe('the statuses agree everywhere', () => {
  it('THE RULING: the detect layer, the schema and the contract name the same statuses', () => {
    // Three copies exist because each layer must be readable on its own. A status stored but not in the
    // contract would fail to parse on the wire, on the row least likely to be ordinary.
    expect([...DEPLOYMENT_STATUSES]).toEqual([...CONTRACT_STATUSES]);
    expect([...DEPLOYMENT_STATUSES]).toEqual([...STORED_STATUSES]);
  });

  it('every status this build can produce is one of them', () => {
    for (const state of ['COMPLETED', 'FAILED', 'IN_PROGRESS', null, 'SOMETHING_NEW']) {
      expect(DEPLOYMENT_STATUSES).toContain(deploymentStatus({ status: 'PRIMARY', rolloutState: state, failedTasks: 0 }));
    }
  });
});

describe('a status is read, never inferred', () => {
  it('maps the three rollout states ECS actually reports', () => {
    expect(deploymentStatus({ status: 'PRIMARY', rolloutState: 'COMPLETED', failedTasks: 0 })).toBe('completed');
    expect(deploymentStatus({ status: 'PRIMARY', rolloutState: 'FAILED', failedTasks: 0 })).toBe('failed');
    expect(deploymentStatus({ status: 'PRIMARY', rolloutState: 'IN_PROGRESS', failedTasks: 0 })).toBe('in_progress');
  });

  it('THE RULING: no rollout state means unknown, not completed', () => {
    /**
     * ECS reports a rollout state only for the rolling deployment controller. Treating its absence as
     * success would report an outcome nobody observed — on exactly the deployments least likely to be
     * ordinary, since they are the ones using a different controller.
     */
    expect(deploymentStatus({ status: 'PRIMARY', rolloutState: null, failedTasks: 0 })).toBe('unknown');
    // And a superseded deployment still draining is not a failure either.
    expect(deploymentStatus({ status: 'ACTIVE', rolloutState: null, failedTasks: 0 })).toBe('unknown');
  });

  it('treats failed tasks as evidence of failure even with no rollout state, because it is evidence', () => {
    expect(deploymentStatus({ status: 'PRIMARY', rolloutState: null, failedTasks: 2 })).toBe('failed');
  });

  it('knows which statuses are final', () => {
    expect(isSettled('completed')).toBe(true);
    expect(isSettled('failed')).toBe(true);
    expect(isSettled('rolled_back')).toBe(true);
    // Both of these can still change, so a stored row must stay writable.
    expect(isSettled('in_progress')).toBe(false);
    expect(isSettled('unknown')).toBe(false);
  });
});

describe('what is stored about one deployment', () => {
  it('identifies the service by cluster and name, as everything else does', () => {
    const seen = toSeenDeployment(ecs(), { name: 'web', cluster: 'prod' }, NOW);
    expect(seen).toMatchObject({ serviceId: 'prod/web', serviceName: 'web', cluster: 'prod', taskDefinition: 'web:42' });
  });

  it('THE RULING: a deployment with no id is dropped, because it cannot be deduplicated', () => {
    // A row that duplicates on every five-minute cycle is worse than a missing one.
    expect(toSeenDeployment(ecs({ id: '' }), { name: 'web', cluster: 'prod' }, NOW)).toBeNull();
  });

  it('falls back to now when AWS gave no timestamp, because a timeline cannot place a null', () => {
    const seen = toSeenDeployment(ecs({ createdAt: null, updatedAt: null }), { name: 'web', cluster: 'prod' }, NOW);
    expect(seen?.startedAt).toBe(NOW);
    expect(seen?.updatedAt).toBe(NOW);
  });

  it('uses createdAt for updatedAt when only the second is missing', () => {
    const seen = toSeenDeployment(ecs({ updatedAt: null }), { name: 'web', cluster: 'prod' }, NOW);
    expect(seen?.updatedAt).toBe(NOW - 600_000);
  });
});

describe('across services', () => {
  it('returns every deployment, newest first', () => {
    const list = seenDeployments(
      [
        { name: 'web', cluster: 'prod', deployments: [ecs({ id: 'a', createdAt: NOW - 1000 }), ecs({ id: 'b', createdAt: NOW - 5000 })] },
        { name: 'api', cluster: 'prod', deployments: [ecs({ id: 'c', createdAt: NOW - 3000 })] },
      ],
      NOW,
    );
    expect(list.map((one) => one.deploymentId)).toEqual(['a', 'c', 'b']);
  });

  it('breaks a tie by id, so two loads of the same data do not reorder', () => {
    const list = seenDeployments(
      [{ name: 'web', cluster: 'prod', deployments: [ecs({ id: 'z', createdAt: NOW }), ecs({ id: 'a', createdAt: NOW })] }],
      NOW,
    );
    expect(list.map((one) => one.deploymentId)).toEqual(['a', 'z']);
  });

  it('skips a service with no deployments rather than inventing one', () => {
    expect(seenDeployments([{ name: 'idle', cluster: 'prod', deployments: [] }], NOW)).toEqual([]);
  });
});
