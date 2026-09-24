import { describe, expect, it } from 'vitest';
import { evaluateEc2Instance } from '@/lib/monitoring/ec2-health';
import { evaluateEcsService } from '@/lib/monitoring/ecs-health';
import { ECS_UTILIZATION_LEVELS } from '@/lib/monitoring/insights';
import { FRESH_FOR_MS, evaluate, hasGaps, rollUp, type ResourceCheck } from '@/lib/monitoring/shared/evaluated-health';

/**
 * What OpsWatch is allowed to call healthy.
 *
 * Every ruling here is a refusal to show green. Green is the one colour a monitoring product can use to
 * lie comfortably — it is what the reader wants to see — so the rules that produce it are the rules worth
 * breaking on purpose.
 */

const NOW = Date.UTC(2026, 8, 24, 10, 0, 0);
const pass: ResourceCheck = { id: 'x.pass', outcome: 'pass' };

describe('a resource is green only when it earned it', () => {
  it('THE RULING: no checks means unknown, never healthy', () => {
    // The whole point. "No problem row exists" is the absence of evidence, not evidence of health.
    expect(evaluate({ checks: [], evaluatedAt: NOW, nowMs: NOW }).state).toBe('unknown');
    expect(evaluate({ checks: null, evaluatedAt: NOW, nowMs: NOW }).state).toBe('unknown');
  });

  it('THE RULING: a signal OpsWatch could not read blocks green, without becoming a failure', () => {
    const evaluation = evaluate({ checks: [pass], unread: ['ecs.cpu'], evaluatedAt: NOW, nowMs: NOW });
    expect(evaluation.state).toBe('unknown');
    // Not amber either: nothing is wrong. The page says what it could not read and stops there.
    expect(evaluation.unread).toEqual(['ecs.cpu']);
    expect(evaluate({ checks: [pass], evaluatedAt: NOW, nowMs: NOW }).state).toBe('healthy');
  });

  it('THE RULING: an old reading is stale, not healthy — and keeps its checks', () => {
    const old = evaluate({ checks: [pass], evaluatedAt: NOW - FRESH_FOR_MS - 1, nowMs: NOW });
    expect(old.state).toBe('stale');
    expect(old.checks).toHaveLength(1);
    expect(old.ageMs).toBe(FRESH_FOR_MS + 1);
    // Exactly at the boundary is still fresh: the rule is "older than", not "as old as".
    expect(evaluate({ checks: [pass], evaluatedAt: NOW - FRESH_FOR_MS, nowMs: NOW }).state).toBe('healthy');
  });

  it('never tells a resource it has been evaluated when it has not', () => {
    expect(evaluate({ checks: [pass], evaluatedAt: null, nowMs: NOW }).ageMs).toBeNull();
  });

  it('lets a failure outrank everything, including a gap', () => {
    const evaluation = evaluate({ checks: [pass, { id: 'x.fail', outcome: 'fail' }], unread: ['y'], evaluatedAt: NOW, nowMs: NOW });
    expect(evaluation.state).toBe('critical');
  });

  it('lets a warning outrank a gap, because something known to be wrong is more useful than a gap', () => {
    expect(evaluate({ checks: [{ id: 'x.warn', outcome: 'warn' }], unread: ['y'], evaluatedAt: NOW, nowMs: NOW }).state).toBe('warning');
  });
});

describe('a group of resources', () => {
  it('THE RULING: one unread member stops the whole group being green', () => {
    const group = rollUp(['healthy', 'healthy', 'unknown']);
    expect(group.state).toBe('unknown');
    // And the counts travel with it, so the word is never read alone: 2 healthy, 1 not evaluated.
    expect(group.counts).toMatchObject({ healthy: 2, unknown: 1 });
    expect(hasGaps(group)).toBe(true);
  });

  it('is green when every member is', () => {
    const group = rollUp(['healthy', 'healthy']);
    expect(group.state).toBe('healthy');
    expect(hasGaps(group)).toBe(false);
  });

  it('is as bad as its worst member', () => {
    expect(rollUp(['healthy', 'warning', 'critical']).state).toBe('critical');
    expect(rollUp(['healthy', 'warning', 'unknown']).state).toBe('warning');
  });

  it('THE RULING: an empty group is unknown, because there is nothing to have been healthy', () => {
    expect(rollUp([]).state).toBe('unknown');
    expect(rollUp([]).total).toBe(0);
  });
});

describe('what OpsWatch checks about an ECS service', () => {
  const facts = { desiredCount: 3, runningCount: 3, pendingCount: 0, rolloutState: 'COMPLETED' };
  const readings = { cpu: 40, memory: 50, metricsUnavailable: false };

  it('judges it against the detector’s own thresholds, so the page and the problem cannot disagree', () => {
    const warn = evaluateEcsService(facts, { ...readings, cpu: ECS_UTILIZATION_LEVELS.warning.threshold }, NOW);
    expect(warn.state).toBe('warning');
    const critical = evaluateEcsService(facts, { ...readings, cpu: ECS_UTILIZATION_LEVELS.critical?.threshold ?? 95 }, NOW);
    expect(critical.state).toBe('critical');
    expect(evaluateEcsService(facts, readings, NOW).state).toBe('healthy');
  });

  it('THE RULING: a service scaled to zero on purpose is not a broken service', () => {
    const evaluation = evaluateEcsService({ ...facts, desiredCount: 0, runningCount: 0 }, readings, NOW);
    expect(evaluation.state).toBe('healthy');
    expect(evaluation.checks.map((check) => check.id)).toContain('ecs.tasks.zero');
  });

  it('separates "some tasks missing" from "nothing is running"', () => {
    expect(evaluateEcsService({ ...facts, runningCount: 2 }, readings, NOW).state).toBe('warning');
    expect(evaluateEcsService({ ...facts, runningCount: 0 }, readings, NOW).state).toBe('critical');
  });

  it('THE RULING: a metric with no datapoints is not a gap, but a failed metric call is', () => {
    // An estate without Container Insights publishes no utilisation. Crying "unread" on every service
    // there would make the word meaningless by the time it mattered.
    const noData = evaluateEcsService(facts, { cpu: null, memory: null, metricsUnavailable: false }, NOW);
    expect(noData.state).toBe('healthy');
    expect(noData.checks.map((check) => check.id)).toEqual(['ecs.tasks.pass', 'ecs.rollout.completed']);

    const failed = evaluateEcsService(facts, { cpu: null, memory: null, metricsUnavailable: true }, NOW);
    expect(failed.state).toBe('unknown');
    expect(failed.unread).toEqual(['ecs.cpu', 'ecs.memory']);
  });

  it('says a rollout is under way rather than holding it against the service', () => {
    const evaluation = evaluateEcsService({ ...facts, rolloutState: 'IN_PROGRESS' }, readings, NOW);
    expect(evaluation.state).toBe('healthy');
    expect(evaluation.checks.map((check) => check.id)).toContain('ecs.rollout.inProgress');
  });

  it('treats a failed rollout as a failure of the service', () => {
    expect(evaluateEcsService({ ...facts, rolloutState: 'FAILED' }, readings, NOW).state).toBe('critical');
  });

  it('leaves out a rollout state ECS does not report, rather than inventing one', () => {
    const evaluation = evaluateEcsService({ ...facts, rolloutState: null }, readings, NOW);
    expect(evaluation.checks.map((check) => check.id)).not.toContain('ecs.rollout.completed');
  });
});

describe('what OpsWatch checks about an EC2 instance', () => {
  const readings = { statusCheckFailed: 0, cpu: 12, metricsUnavailable: false };

  it('THE RULING: CPU is never a verdict, because 95% is a batch host doing its job', () => {
    // The only thing that changes the state is the status check. A busy instance stays green.
    expect(evaluateEc2Instance({ state: 'running' }, { ...readings, cpu: 99 }, NOW).state).toBe('healthy');
    expect(evaluateEc2Instance({ state: 'running' }, { ...readings, statusCheckFailed: 1 }, NOW).state).toBe('critical');
  });

  it('THE RULING: a running instance with no status-check data is unknown, not healthy', () => {
    const evaluation = evaluateEc2Instance({ state: 'running' }, { ...readings, statusCheckFailed: null }, NOW);
    expect(evaluation.state).toBe('unknown');
    expect(evaluation.unread).toEqual(['ec2.statusCheck']);
  });

  it('does not demand a status check from an instance that is switched off', () => {
    // A stopped instance publishes nothing and is not broken; asking it to prove otherwise would paint
    // every parked box grey for ever.
    const evaluation = evaluateEc2Instance({ state: 'stopped' }, { ...readings, statusCheckFailed: null }, NOW);
    expect(evaluation.state).toBe('healthy');
    expect(evaluation.checks.map((check) => check.id)).toEqual(['ec2.state.stopped']);
  });

  it('treats starting and stopping as a moment rather than a verdict', () => {
    for (const state of ['pending', 'stopping', 'shutting-down']) {
      const evaluation = evaluateEc2Instance({ state }, { ...readings, statusCheckFailed: null }, NOW);
      expect(evaluation.state, state).toBe('healthy');
      expect(evaluation.checks[0].id, state).toBe('ec2.state.transition');
    }
  });

  it('admits a failed CloudWatch call as a gap, not as a failure', () => {
    const evaluation = evaluateEc2Instance({ state: 'stopped' }, { statusCheckFailed: null, cpu: null, metricsUnavailable: true }, NOW);
    expect(evaluation.state).toBe('unknown');
    expect(evaluation.unread).toEqual(['ec2.statusCheck']);
  });
});

describe('a check that ran and could not decide', () => {
  it('THE RULING: it blocks green, so a tick never sits beside "0 of 1 healthy"', () => {
    // Folding "could not decide" into "passed" is how a summary prints a green tick above a sentence
    // that says the opposite. It is its own outcome.
    const evaluation = evaluate({ checks: [pass, { id: 'x.partial', outcome: 'unknown' }], evaluatedAt: NOW, nowMs: NOW });
    expect(evaluation.state).toBe('unknown');
  });

  it('still loses to something known to be wrong', () => {
    expect(evaluate({ checks: [{ id: 'x.partial', outcome: 'unknown' }, { id: 'x.fail', outcome: 'fail' }], evaluatedAt: NOW, nowMs: NOW }).state).toBe('critical');
    expect(evaluate({ checks: [{ id: 'x.partial', outcome: 'unknown' }, { id: 'x.warn', outcome: 'warn' }], evaluatedAt: NOW, nowMs: NOW }).state).toBe('warning');
  });
});
