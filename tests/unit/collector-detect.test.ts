import { describe, expect, it } from 'vitest';
import { familyOfKind } from '@/lib/collector/detect';
import { INSIGHT_FAMILIES, type InsightFamily } from '@/lib/monitoring/overview';
import { applyTransitions, listLiveProblems, listRecentlyResolved, pageProblems, updateProblem } from '@/lib/store/problems';
import { applyCycle, REOPEN_WINDOW_MS, CLEAR_EVALUATIONS, CLEAR_MIN_MS } from '@/lib/detect/lifecycle';
import { RESOLVED_RETENTION_MS } from '@/lib/store/retention';
import { outcomesFromInsights, type EvaluatedPair } from '@/lib/detect/aws';
import { problemKey } from '@/lib/detect/key';
import type { Insight } from '@/lib/monitoring/insights';
import { createTestDb } from '../helpers/db';

const NOW = Date.UTC(2026, 8, 22, 9, 0, 0);
const CONNECTION = 'c1';
const SCOPE = 'us-east-1';
const context = { connectionId: CONNECTION, scope: SCOPE };

const insight = (over: Partial<Insight> = {}): Insight => ({
  severity: 'critical',
  kind: 'ecs_cpu_high',
  resource: 'prod/web',
  messageKey: 'messages.ecs_cpu_high',
  values: { service: 'web', value: 96 },
  href: '/c/c1/us-east-1/containers/services',
  ...over,
});

/**
 * One detect cycle, wired exactly as the job wires it but with the AWS read replaced by literal insights.
 * This is the seam worth testing: everything from "the rules fired" to "a row exists" is the product's own
 * code, and the AWS call is not.
 */
function cycle(
  db: ReturnType<typeof createTestDb>,
  insights: Insight[],
  nowMs: number,
  readFamilies: readonly InsightFamily[] = INSIGHT_FAMILIES,
) {
  const live = listLiveProblems(db, CONNECTION, SCOPE);
  const read = new Set<string>(readFamilies);
  const evaluated: EvaluatedPair[] = [];
  const notEvaluated: EvaluatedPair[] = [];
  for (const { row } of live) {
    const family = familyOfKind(row.kind);
    const pair = {
      subject: { type: row.subjectType, id: row.subjectId, name: row.subjectName, serviceId: row.serviceId },
      kinds: [row.kind as 'ecs_cpu_high'],
    };
    (family !== null && read.has(family) ? evaluated : notEvaluated).push(pair);
  }
  const outcomes = outcomesFromInsights({ insights, evaluated, notEvaluated, nowMs });
  const transitions = applyCycle({
    connectionId: CONNECTION,
    scope: SCOPE,
    live: live.map(({ live: projection }) => projection),
    resolvedInWindow: listRecentlyResolved(db, CONNECTION, SCOPE, nowMs - RESOLVED_RETENTION_MS),
    cycle: { at: nowMs, outcomes, failed: [] },
    nowMs,
  });
  return applyTransitions(db, context, transitions);
}

/** Only the live ones: `pageProblems` answers every status unless asked, resolved rows included. */
const openProblems = (db: ReturnType<typeof createTestDb>) =>
  pageProblems(db, { ...context, status: ['open'] }, null, 50).items;

describe('a detect cycle, end to end', () => {
  it('turns a firing rule into a persisted problem with its evidence and its score', () => {
    const db = createTestDb();
    expect(cycle(db, [insight()], NOW)).toBe(1);

    const [problem] = openProblems(db);
    expect(problem.key).toBe(problemKey({ connectionId: CONNECTION, scope: SCOPE, kind: 'ecs_cpu_high', subjectId: 'prod/web' }));
    expect({ kind: problem.kind, subjectId: problem.subjectId, status: problem.status }).toEqual({
      kind: 'ecs_cpu_high',
      subjectId: 'prod/web',
      status: 'open',
    });
    // The score is computed, not copied from the rule's severity, and the arithmetic is stored with it.
    expect(problem.score).toBeGreaterThan(0);
    expect(problem.scoreTerms.weights).toEqual({ s: 40, b: 20, t: 15, u: 15, d: 10 });
    expect(problem.titleKey).toBe('messages.ecs_cpu_high');
  });

  it('keeps one row across cycles, counting occurrences rather than opening a second', () => {
    const db = createTestDb();
    cycle(db, [insight()], NOW);
    cycle(db, [insight({ values: { service: 'web', value: 98 } })], NOW + 5 * 60_000);
    const problems = openProblems(db);
    expect(problems).toHaveLength(1);
    expect(problems[0].occurrences).toBe(2);
    expect(problems[0].lastSeenAt).toBe(NOW + 5 * 60_000);
    expect(problems[0].firstSeenAt).toBe(NOW);
  });

  it('resolves only after three evaluated-and-clear cycles over fifteen minutes', () => {
    const db = createTestDb();
    cycle(db, [insight()], NOW);
    cycle(db, [], NOW + 5 * 60_000);
    expect(openProblems(db)).toHaveLength(1);
    cycle(db, [], NOW + 10 * 60_000);
    expect(openProblems(db)).toHaveLength(1);
    // The fifteen minutes run from the first clear cycle, not from when the problem opened.
    cycle(db, [], NOW + 5 * 60_000 + CLEAR_MIN_MS);
    expect(openProblems(db)).toHaveLength(0);
  });

  it('THE REGRESSION: a family that could not be read resolves nothing, however many cycles pass', () => {
    const db = createTestDb();
    cycle(db, [insight()], NOW);
    // The ECS family fails to load on every subsequent cycle. §33.5: silence is not evidence of health.
    const withoutEcs = INSIGHT_FAMILIES.filter((family) => family !== 'ecs');
    for (let i = 1; i <= CLEAR_EVALUATIONS + 3; i += 1) cycle(db, [], NOW + i * 20 * 60_000, withoutEcs);
    expect(openProblems(db)).toHaveLength(1);
    // And the clear streak never advanced, so a genuine clear cycle still has to earn the resolution.
    expect(openProblems(db)[0].clearStreak).toBe(0);
  });

  it('reopens the same row when trouble returns inside the window, keeping its history', () => {
    const db = createTestDb();
    cycle(db, [insight()], NOW);
    const [before] = openProblems(db);
    updateProblem(db, before.id, { status: 'resolved', resolvedAt: NOW + 60_000 });

    cycle(db, [insight()], NOW + 30 * 60_000);
    const [after] = openProblems(db);
    expect(after.id).toBe(before.id);
    expect(after.firstSeenAt).toBe(NOW);
    expect(after.flapCount).toBe(1);
  });

  it('opens a successor beyond the window, carrying what it succeeds', () => {
    const db = createTestDb();
    cycle(db, [insight()], NOW);
    const [before] = openProblems(db);
    updateProblem(db, before.id, { status: 'resolved', resolvedAt: NOW + 60_000 });

    cycle(db, [insight()], NOW + REOPEN_WINDOW_MS + 5 * 60_000);
    const [after] = openProblems(db);
    expect(after.id).not.toBe(before.id);
    expect(after.previousProblemId).toBe(before.id);
  });

  it('opens one problem per member of a cluster-wide breach, never one for the cluster', () => {
    const db = createTestDb();
    const members = ['prod/a', 'prod/b', 'prod/c', 'prod/d'];
    const grouped = insight({
      resource: 'prod',
      messageKey: 'groups.ecs_cpu_high',
      values: { cluster: 'prod', count: 4 },
      members: members.map((resource) => ({
        resource,
        severity: 'critical' as const,
        messageKey: 'messages.ecs_cpu_high',
        values: { value: 97 },
        href: `/c/${resource}`,
      })),
    });
    expect(cycle(db, [grouped], NOW)).toBe(4);
    expect(openProblems(db).map((problem) => problem.subjectId)).toEqual(members);
  });

  it('scores a rule that reports total failure at critical, whatever the formula says', () => {
    const db = createTestDb();
    cycle(db, [insight({ kind: 'alb_unhealthy_hosts', resource: 'tg-1', values: { healthy: 0, total: 3 } })], NOW);
    const [problem] = openProblems(db);
    expect(problem.severity).toBe('critical');
    expect(problem.score).toBeGreaterThanOrEqual(70);
    expect(problem.scoreTerms.floored).toBe(true);
  });

  it('does nothing at all when nothing is firing and nothing is open', () => {
    const db = createTestDb();
    expect(cycle(db, [], NOW)).toBe(0);
    expect(openProblems(db)).toHaveLength(0);
  });
});

describe('which family answers for a detector', () => {
  it('maps every Stage 2 rule to the family that reads it', () => {
    expect(familyOfKind('ecs_cpu_high')).toBe('ecs');
    expect(familyOfKind('rds_cpu_high')).toBe('rds');
    expect(familyOfKind('aurora_replica_lag')).toBe('rds');
    expect(familyOfKind('alb_unhealthy_hosts')).toBe('alb');
    expect(familyOfKind('alarm_firing')).toBe('alarms');
  });

  it('answers null for a kind no family reads, so it is treated as not evaluated', () => {
    // A detector from a later phase whose family does not exist yet must never be counted as clear.
    expect(familyOfKind('synthetic_down')).toBeNull();
  });
});
