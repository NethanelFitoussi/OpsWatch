import { evaluate, type Evaluation, type ResourceCheck } from './shared/evaluated-health';

/**
 * What OpsWatch checks about one EC2 instance.
 *
 * **No CPU verdict.** A batch host at 95 % is doing its job; a web server at 95 % may be in trouble. AWS
 * publishes exactly one signal that means "this instance is broken" — `StatusCheckFailed` — and that is
 * what colours a tile. CPU is shown, ranked and charted, because it is worth seeing; it is not turned into
 * a health claim OpsWatch has no basis for.
 *
 * Pure: an instance, its readings and a clock in — an evaluation out.
 */

export type Ec2Readings = {
  /** The maximum of `StatusCheckFailed` over the window: 1 means it failed at least once. */
  statusCheckFailed: number | null;
  cpu: number | null;
  /** Whether the metric call itself failed, which is not the same as an instance publishing nothing. */
  metricsUnavailable: boolean;
};

function state(instanceState: string): ResourceCheck {
  // Stopped is a decision somebody made. It is not a fault, and colouring it red would make every estate
  // with a parked box look like an incident.
  if (instanceState === 'stopped') return { id: 'ec2.state.stopped', outcome: 'pass' };
  if (instanceState === 'running') return { id: 'ec2.state.running', outcome: 'pass' };
  // Starting or stopping: a moment, not a verdict. Worth saying, not worth alarming about.
  return { id: 'ec2.state.transition', outcome: 'pass', values: { state: instanceState } };
}

export function evaluateEc2Instance(instance: { state: string }, readings: Ec2Readings, nowMs: number): Evaluation {
  const checks: ResourceCheck[] = [state(instance.state)];
  const unread: string[] = [];

  if (instance.state === 'running') {
    if (readings.statusCheckFailed === null) {
      // A running instance with no status-check data is one OpsWatch cannot vouch for. Unlike a stopped
      // one, there is something here that could be broken and nothing saying it is not.
      unread.push('ec2.statusCheck');
    } else if (readings.statusCheckFailed > 0) {
      checks.push({ id: 'ec2.statusCheck.failed', outcome: 'fail' });
    } else {
      checks.push({ id: 'ec2.statusCheck.pass', outcome: 'pass' });
    }
  }
  if (readings.metricsUnavailable && !unread.includes('ec2.statusCheck')) unread.push('ec2.statusCheck');

  return evaluate({ checks, unread, evaluatedAt: nowMs, nowMs });
}
