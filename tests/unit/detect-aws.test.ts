import { describe, expect, it } from 'vitest';
import { INSIGHT_DETECTOR_KINDS, outcomesFromInsights, type EvaluatedPair } from '@/lib/detect/aws';
import { INSIGHT_WINDOW_MINUTES, type Insight, type InsightKind } from '@/lib/monitoring/insights';
import type { SubjectRef } from '@/lib/detect/types';

const NOW = Date.UTC(2026, 8, 19, 9, 0, 0);

const insight = (over: Partial<Insight> = {}): Insight => ({
  severity: 'critical',
  kind: 'ecs_cpu_high',
  resource: 'prod/web',
  messageKey: 'messages.ecs_cpu_high',
  values: { service: 'web', value: 96 },
  href: '/c/c1/us-east-1/containers/services',
  ...over,
});

const subject = (id: string, type: SubjectRef['type'] = 'service'): SubjectRef => ({
  type,
  id,
  name: id,
  serviceId: type === 'service' ? id : null,
});

const pair = (id: string, kinds: InsightKind[], type: SubjectRef['type'] = 'service'): EvaluatedPair => ({
  subject: subject(id, type),
  kinds,
});

const run = (over: Partial<Parameters<typeof outcomesFromInsights>[0]> = {}) =>
  outcomesFromInsights({ insights: [], evaluated: [], nowMs: NOW, ...over });

describe('the Stage 2 rules as detectors', () => {
  it('covers every insight kind the rules can produce', () => {
    // A kind the adapter does not know would throw at runtime when that rule first fires in the field.
    const kinds: InsightKind[] = [
      'ecs_tasks_below_desired', 'ecs_cpu_high', 'ecs_memory_high', 'ecs_rollout_failed', 'ecs_rollout_stuck',
      'rds_cpu_high', 'rds_freeable_memory_low', 'aurora_replica_lag',
      'alb_5xx_rate', 'alb_elb_5xx_count', 'alb_unhealthy_hosts', 'alarm_firing',
    ];
    expect([...INSIGHT_DETECTOR_KINDS].sort()).toEqual([...kinds].sort());
  });

  it('keeps the rule\'s own severity as the detector level, and its catalogue key as the title', () => {
    const [outcome] = run({ insights: [insight({ severity: 'warning' })] });
    expect(outcome).toMatchObject({ state: 'fired', kind: 'ecs_cpu_high' });
    if (outcome.state !== 'fired') throw new Error('expected a fired outcome');
    expect(outcome.problem.level).toBe('warning');
    // The existing catalogue, at EN/FR parity already. Nothing is retranslated (§24).
    expect(outcome.problem.titleKey).toBe('messages.ecs_cpu_high');
    expect(outcome.problem.values).toEqual({ service: 'web', value: 96 });
  });

  it('types an ECS subject as a service and carries its service id', () => {
    const [outcome] = run({ insights: [insight()] });
    expect(outcome.subject).toEqual({ type: 'service', id: 'prod/web', name: 'prod/web', serviceId: 'prod/web' });
  });

  it('types a database or load balancer subject as a resource, with no service id', () => {
    for (const kind of ['rds_cpu_high', 'alb_5xx_rate', 'alarm_firing'] as InsightKind[]) {
      const [outcome] = run({ insights: [insight({ kind, resource: 'db-1' })] });
      expect(outcome.subject, kind).toMatchObject({ type: 'resource', id: 'db-1', serviceId: null });
    }
  });

  it('always produces evidence, because a problem without it cannot exist', () => {
    const [outcome] = run({ insights: [insight()] });
    if (outcome.state !== 'fired') throw new Error('expected a fired outcome');
    expect(outcome.problem.evidence.length).toBeGreaterThan(0);
    expect(outcome.problem.evidence[0]).toMatchObject({ kind: 'metric', labelKey: 'messages.ecs_cpu_high', at: NOW });
  });

  it('reads the measurement when the rule carries one and answers null when it does not', () => {
    const measured = run({ insights: [insight({ values: { service: 'web', value: 96 } })] })[0];
    const unmeasured = run({ insights: [insight({ values: { service: 'web' } })] })[0];
    if (measured.state !== 'fired' || unmeasured.state !== 'fired') throw new Error('expected fired outcomes');
    expect(measured.problem.evidence[0].value).toBe(96);
    // Not measured is null and renders as such. It is never 0 (§2.4).
    expect(unmeasured.problem.evidence[0].value).toBeNull();
  });
});

describe('§33.8 — a rendering collapse is expanded back into members', () => {
  const grouped = insight({
    kind: 'ecs_cpu_high',
    resource: 'prod',
    messageKey: 'groups.ecs_cpu_high',
    values: { cluster: 'prod', count: 4 },
    members: [
      { resource: 'prod/a', severity: 'critical', messageKey: 'messages.ecs_cpu_high', values: { value: 97 }, href: '/a' },
      { resource: 'prod/b', severity: 'warning', messageKey: 'messages.ecs_cpu_high', values: { value: 88 }, href: '/b' },
      { resource: 'prod/c', severity: 'warning', messageKey: 'messages.ecs_cpu_high', values: { value: 87 }, href: '/c' },
      { resource: 'prod/d', severity: 'warning', messageKey: 'messages.ecs_cpu_high', values: { value: 86 }, href: '/d' },
    ],
  });

  it('yields one outcome per member, never one for the cluster', () => {
    const outcomes = run({ insights: [grouped] });
    expect(outcomes.map((outcome) => outcome.subject.id)).toEqual(['prod/a', 'prod/b', 'prod/c', 'prod/d']);
    // The cluster must not appear as a subject here: §33.8 makes the collapse a lifecycle transition, and
    // planFleet performs it at the problem level. A cluster outcome here would pre-empt that and leave the
    // children - whose evidence and history §33.8 requires to survive - never created at all.
    expect(outcomes.some((outcome) => outcome.subject.id === 'prod')).toBe(false);
  });

  it('gives each member its own severity and its own link, not the group\'s', () => {
    const outcomes = run({ insights: [grouped] });
    const levels = outcomes.map((outcome) => (outcome.state === 'fired' ? outcome.problem.level : null));
    expect(levels).toEqual(['critical', 'warning', 'warning', 'warning']);
    const first = outcomes[0];
    if (first.state !== 'fired') throw new Error('expected a fired outcome');
    expect(first.problem.href).toBe('/a');
  });
});

describe('§33.5 — clear and not-evaluated are told apart, never inferred', () => {
  it('reports a pair that was evaluated and stayed silent as clear', () => {
    const outcomes = run({ insights: [], evaluated: [pair('prod/web', ['ecs_cpu_high', 'ecs_memory_high'])] });
    expect(outcomes.map((outcome) => [outcome.state, outcome.kind])).toEqual([
      ['clear', 'ecs_cpu_high'],
      ['clear', 'ecs_memory_high'],
    ]);
  });

  it('does not report a pair as clear when it fired', () => {
    const outcomes = run({ insights: [insight()], evaluated: [pair('prod/web', ['ecs_cpu_high', 'ecs_memory_high'])] });
    expect(outcomes.filter((outcome) => outcome.state === 'fired').map((o) => o.kind)).toEqual(['ecs_cpu_high']);
    expect(outcomes.filter((outcome) => outcome.state === 'clear').map((o) => o.kind)).toEqual(['ecs_memory_high']);
  });

  it('reports not-evaluated only when the caller says so, never from absence', () => {
    // A subject that is in neither list produces nothing at all: the adapter does not guess which it was.
    expect(run({ insights: [], evaluated: [] })).toEqual([]);
    const outcomes = run({ insights: [], notEvaluated: [pair('prod/web', ['ecs_cpu_high'])] });
    expect(outcomes).toEqual([{ state: 'not_evaluated', kind: 'ecs_cpu_high', subject: subject('prod/web') }]);
  });

  it('never turns a capped subject into a clear one', () => {
    const outcomes = run({ insights: [], evaluated: [], notEvaluated: [pair('prod/web', ['ecs_cpu_high'])] });
    expect(outcomes.some((outcome) => outcome.state === 'clear')).toBe(false);
  });
});

describe('score inputs are filled only where the rule knows them', () => {
  it('leaves exposure and deviation unknown rather than zero-filling them', () => {
    const [outcome] = run({ insights: [insight()] });
    if (outcome.state !== 'fired') throw new Error('expected a fired outcome');
    // §17's dependency map and §8's baselines do not exist yet. A 0 here is precisely what §33.7 forbids.
    expect(outcome.problem.userFacing).toBeNull();
    expect(outcome.problem.robustZ).toBeNull();
  });

  it('reads a blast radius only when the rule measured both halves of it', () => {
    const withBoth = run({
      insights: [insight({ kind: 'aurora_replica_lag', resource: 'cluster-1', values: { lagging: 2, readers: 5 } })],
    })[0];
    const withNeither = run({ insights: [insight()] })[0];
    if (withBoth.state !== 'fired' || withNeither.state !== 'fired') throw new Error('expected fired outcomes');
    expect(withBoth.problem.blast).toEqual({ affected: 2, members: 5 });
    expect(withNeither.problem.blast).toBeNull();
  });

  it('defaults persistence to the rules\' own window and lets the caller supply the real figure', () => {
    const fallback = run({ insights: [insight()] })[0];
    const supplied = run({ insights: [insight()], breachingMinutes: () => 240 })[0];
    if (fallback.state !== 'fired' || supplied.state !== 'fired') throw new Error('expected fired outcomes');
    expect(fallback.problem.minutesBreaching).toBe(INSIGHT_WINDOW_MINUTES);
    expect(supplied.problem.minutesBreaching).toBe(240);
  });
});

describe('the two floors, read from the rule rather than assumed', () => {
  it('floors zero healthy targets at critical, which §4.3 names', () => {
    const [outcome] = run({
      insights: [insight({ kind: 'alb_unhealthy_hosts', resource: 'tg-1', values: { healthy: 0, total: 3 } })],
    });
    if (outcome.state !== 'fired') throw new Error('expected a fired outcome');
    expect(outcome.problem.floorCritical).toBe(true);
    expect(outcome.problem.totalFailure).toBe(true);
  });

  it('does not floor a load balancer that still has healthy targets', () => {
    const [outcome] = run({
      insights: [insight({ kind: 'alb_unhealthy_hosts', resource: 'tg-1', values: { healthy: 2, total: 3 } })],
    });
    if (outcome.state !== 'fired') throw new Error('expected a fired outcome');
    expect(outcome.problem.floorCritical).toBeUndefined();
  });

  it('calls zero running tasks a total failure, which §33.7 floors at 70', () => {
    const [outcome] = run({
      insights: [insight({ kind: 'ecs_tasks_below_desired', values: { running: 0, desired: 4 } })],
    });
    if (outcome.state !== 'fired') throw new Error('expected a fired outcome');
    expect(outcome.problem.totalFailure).toBe(true);
  });

  it('does not call a partial shortfall a total failure', () => {
    const [outcome] = run({
      insights: [insight({ kind: 'ecs_tasks_below_desired', values: { running: 2, desired: 4 } })],
    });
    if (outcome.state !== 'fired') throw new Error('expected a fired outcome');
    expect(outcome.problem.totalFailure).toBeUndefined();
  });
});
