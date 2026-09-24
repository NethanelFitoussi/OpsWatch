import { ECS_UTILIZATION_LEVELS } from './insights';
import { evaluate, type Evaluation, type ResourceCheck } from './shared/evaluated-health';

/**
 * What OpsWatch checks about one ECS service, and what each answer means.
 *
 * The thresholds are `ECS_UTILIZATION_LEVELS` — the detector's own. A page that judged a service against
 * numbers of its own would eventually show a green tile beside an open warning about the same service,
 * and an operator who sees that once stops believing either of them.
 *
 * Pure: a service, two readings and a clock in — an evaluation out. No AWS, no database.
 */

/** A signal OpsWatch wanted and could not get. It blocks green without pretending to be a failure. */
export type EcsReadings = {
  /** Latest CPU utilisation, `null` when CloudWatch returned nothing for the window. */
  cpu: number | null;
  memory: number | null;
  /** Whether the metric call itself failed, which is different from a metric with no datapoints. */
  metricsUnavailable: boolean;
};

export type EcsServiceFacts = {
  desiredCount: number;
  runningCount: number;
  pendingCount: number;
  rolloutState: string | null;
};

function utilisation(id: string, value: number | null): ResourceCheck | null {
  if (value === null) return null;
  const rounded = Math.round(value);
  const { warning, critical } = ECS_UTILIZATION_LEVELS;
  if (critical !== undefined && value >= critical.threshold) {
    return { id: `${id}.critical`, outcome: 'fail', values: { value: rounded, threshold: critical.threshold } };
  }
  if (value >= warning.threshold) {
    return { id: `${id}.warn`, outcome: 'warn', values: { value: rounded, threshold: warning.threshold } };
  }
  return { id: `${id}.pass`, outcome: 'pass', values: { value: rounded, threshold: warning.threshold } };
}

function tasks(facts: EcsServiceFacts): ResourceCheck {
  const { desiredCount, runningCount } = facts;
  // Deliberately scaled to nothing is a decision, not a fault. Calling it unhealthy would light up every
  // estate that parks a worker overnight.
  if (desiredCount === 0) return { id: 'ecs.tasks.zero', outcome: 'pass' };
  if (runningCount >= desiredCount) return { id: 'ecs.tasks.pass', outcome: 'pass', values: { running: runningCount, desired: desiredCount } };
  if (runningCount === 0) return { id: 'ecs.tasks.none', outcome: 'fail', values: { desired: desiredCount } };
  return { id: 'ecs.tasks.short', outcome: 'warn', values: { running: runningCount, desired: desiredCount } };
}

function rollout(state: string | null): ResourceCheck | null {
  if (state === null) return null;
  if (state === 'FAILED') return { id: 'ecs.rollout.failed', outcome: 'fail' };
  // A rollout under way is normal and worth saying; it is also why task counts may not add up right now.
  if (state === 'IN_PROGRESS') return { id: 'ecs.rollout.inProgress', outcome: 'pass' };
  if (state === 'COMPLETED') return { id: 'ecs.rollout.completed', outcome: 'pass' };
  return null;
}

export function evaluateEcsService(facts: EcsServiceFacts, readings: EcsReadings, nowMs: number): Evaluation {
  const checks = [tasks(facts), utilisation('ecs.cpu', readings.cpu), utilisation('ecs.memory', readings.memory), rollout(facts.rolloutState)].filter(
    (check): check is ResourceCheck => check !== null,
  );

  // Two different silences. A failed call is a gap OpsWatch should admit; a metric with no datapoints for
  // a service that publishes none is not a gap at all, and listing it would cry wolf on every estate
  // without Container Insights.
  const unread = readings.metricsUnavailable ? ['ecs.cpu', 'ecs.memory'] : [];

  // Read live, so the reading is this instant: `stale` belongs to stored snapshots, not to this path.
  return evaluate({ checks, unread, evaluatedAt: nowMs, nowMs });
}
