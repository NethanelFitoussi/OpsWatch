import { describe, expect, it } from 'vitest';
import { healthSchema } from '@opswatch/contract';
import { HEALTH_FAMILIES, changesFrom, hasBeenRead, overallStatus, readHealth, type HealthFamily } from '@/lib/read/health';
import { recordFamilySnapshot } from '@/lib/store/health';
import { applyTransitions, insertProblem } from '@/lib/store/problems';
import { listEvents } from '@/lib/store/events';
import type { Family } from '@opswatch/contract';
import { createTestDb } from '../helpers/db';
import { detected, newProblem } from '../helpers/detect';

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const env = { connectionId: 'c1', scope: 'us-east-1' };
const labels = {
  family: (family: string) => `family:${family}`,
  unavailable: (reason: string, values: Record<string, string | number>) => ({
    messageKey: `Monitoring.health.unavailable.${reason}`,
    message: `cannot read ${values.family}`,
  }),
  change: (kind: string, values: Record<string, string | number>) => `${kind} on ${values.subject}`,
};
const context = { nowMs: NOW, render: (key: string) => key, labels };

const snapshot = (over: Partial<Parameters<typeof recordFamilySnapshot>[1]> = {}) => ({
  ...env,
  family: 'ecs',
  status: 'healthy' as const,
  total: 4,
  affected: 0,
  readAt: NOW,
  unavailableReason: null,
  unavailableCode: null,
  ...over,
});

const family = (over: Partial<Family> = {}): Family =>
  ({ family: 'ecs', label: 'Containers', status: 'healthy', total: 4, affected: 0, ...over });

describe('the families OpsWatch checks', () => {
  it('are the four the detect job reads, and nothing it does not', () => {
    // A family named here that no job reads would show as permanently unknown; one the job reads but which
    // is missing here would never reach the page at all.
    const names: HealthFamily[] = ['ecs', 'rds', 'alb', 'alarms'];
    expect([...HEALTH_FAMILIES]).toEqual(names);
  });
});

describe('"healthy" and "we could not look" are different answers', () => {
  it('is unknown when nothing has been read at all', () => {
    const db = createTestDb();
    expect(hasBeenRead(db, env)).toBe(false);
    const health = readHealth(db, env, context);
    // The single most important assertion on this page: an instance that has read nothing must never say
    // production is healthy.
    expect(health.status).toBe('unknown');
    expect(health.families.every((entry) => entry.status === 'unknown')).toBe(true);
  });

  it('is healthy only when every family was read and none is affected', () => {
    const db = createTestDb();
    for (const name of HEALTH_FAMILIES) recordFamilySnapshot(db, snapshot({ family: name }));
    expect(readHealth(db, env, context).status).toBe('healthy');
  });

  it('is degraded, not healthy, when one family could not be read', () => {
    const db = createTestDb();
    for (const name of HEALTH_FAMILIES) recordFamilySnapshot(db, snapshot({ family: name }));
    recordFamilySnapshot(db, snapshot({ family: 'rds', status: 'unknown', total: null, affected: null, unavailableReason: 'denied' }));
    expect(readHealth(db, env, context).status).toBe('degraded');
  });

  it('ranks a known critical above an unread family', () => {
    expect(overallStatus([family({ status: 'critical' }), family({ family: 'rds', status: 'unknown' })], { critical: 1, warning: 0 })).toBe('critical');
  });

  it('never calls an environment healthy merely because its problems list is empty', () => {
    expect(overallStatus([family({ status: 'unknown' }), family({ family: 'rds', status: 'unknown' })], { critical: 0, warning: 0 })).toBe('unknown');
  });
});

describe('what a family says about itself', () => {
  it('carries the counts it measured', () => {
    const db = createTestDb();
    recordFamilySnapshot(db, snapshot({ total: 10, affected: 3, status: 'degraded' }));
    const ecs = readHealth(db, env, context).families.find((entry) => entry.family === 'ecs');
    expect({ total: ecs?.total, affected: ecs?.affected, status: ecs?.status }).toEqual({ total: 10, affected: 3, status: 'degraded' });
  });

  it('says why it could not be read, twice, keeping the codes logic uses', () => {
    const db = createTestDb();
    recordFamilySnapshot(db, snapshot({ status: 'unknown', total: null, affected: null, unavailableReason: 'denied', unavailableCode: 'AccessDenied' }));
    const ecs = readHealth(db, env, context).families.find((entry) => entry.family === 'ecs');
    expect(ecs?.unavailable).toMatchObject({
      reason: 'denied',
      code: 'AccessDenied',
      messageKey: 'Monitoring.health.unavailable.denied',
      message: 'cannot read family:ecs',
    });
    // Not measured is null, never 0 — 0 would read as "you have no containers".
    expect(ecs?.total).toBeNull();
  });

  it('reports service counts as not measured rather than zero when ECS was never read', () => {
    const db = createTestDb();
    recordFamilySnapshot(db, snapshot({ family: 'rds' }));
    const health = readHealth(db, env, context);
    expect(health.counts.totalServices).toBeNull();
    expect(health.counts.healthyServices).toBeNull();
  });

  it('computes healthy services from what was measured', () => {
    const db = createTestDb();
    recordFamilySnapshot(db, snapshot({ total: 9, affected: 2 }));
    const health = readHealth(db, env, context);
    expect({ healthy: health.counts.healthyServices, total: health.counts.totalServices }).toEqual({ healthy: 7, total: 9 });
  });
});

describe('what has changed', () => {
  it('reads the lifecycle events the collector wrote, newest first', () => {
    const db = createTestDb();
    applyTransitions(db, env, [
      { type: 'open', key: 'a'.repeat(32), at: NOW - 60_000, problem: detected({ subjectId: 'prod/web' }), previousProblemId: null },
    ]);
    // The spine was written to by applying the transition, not by the page.
    expect(listEvents(db, {}, null, 10).items.map((event) => event.kind)).toEqual(['problem_opened']);
    const changes = changesFrom(db, { ...env, sinceMs: NOW - 3_600_000, untilMs: NOW }, labels);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ direction: 'new', text: 'problem_opened on prod/web' });
    expect(changes[0].ref?.type).toBe('problem');
  });

  it('leaves out what happened outside the period', () => {
    const db = createTestDb();
    applyTransitions(db, env, [
      { type: 'open', key: 'a'.repeat(32), at: NOW - 3 * 24 * 3_600_000, problem: detected(), previousProblemId: null },
    ]);
    expect(changesFrom(db, { ...env, sinceMs: NOW - 3_600_000, untilMs: NOW }, labels)).toEqual([]);
  });
});

describe('the whole shape', () => {
  it('is exactly what every client already parses', () => {
    const db = createTestDb();
    for (const name of HEALTH_FAMILIES) recordFamilySnapshot(db, snapshot({ family: name }));
    insertProblem(db, newProblem({ firstSeenAt: NOW, lastSeenAt: NOW, lastEvaluatedAt: NOW }));
    const health = readHealth(db, env, context);
    expect(healthSchema.safeParse(health).success).toBe(true);
    expect(health.topProblem).not.toBeNull();
  });

  it('says null for what it does not measure, rather than zero', () => {
    const db = createTestDb();
    recordFamilySnapshot(db, snapshot());
    const health = readHealth(db, env, context);
    // Nothing in this build measures alerts or synthetics. `null` is the contract's word for that.
    expect(health.activeAlerts).toBeNull();
    expect(health.synthetics).toBeNull();
    expect(health.recentIncidents).toEqual([]);
  });
});
