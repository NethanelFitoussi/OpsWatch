import { ECS_UTILIZATION_LEVELS } from './insights';
import { evaluate, type Evaluation, type ResourceCheck } from './shared/evaluated-health';

/**
 * What OpsWatch checks about a Kubernetes cluster, node and pod, and what it refuses to claim.
 *
 * Utilisation is judged against `ECS_UTILIZATION_LEVELS` — the same numbers the container detectors use,
 * because a node at 95 % memory and a task at 95 % memory are the same kind of trouble and two different
 * ladders for it would eventually contradict each other on one screen.
 *
 * What is not judged, and cannot be from CloudWatch: whether a pod is `Pending`, whether it is in
 * `CrashLoopBackOff`, why it restarted, or whether a workload that should have pods has none. Container
 * Insights is a picture of what is running.
 *
 * Pure: readings and a clock in, an evaluation out.
 */

function band(id: string, value: number | null): ResourceCheck | null {
  if (value === null) return null;
  const rounded = Math.round(value);
  const { warning, critical } = ECS_UTILIZATION_LEVELS;
  if (critical !== undefined && value >= critical.threshold) {
    return { id: `${id}.critical`, outcome: 'fail', values: { value: rounded, threshold: critical.threshold } };
  }
  if (value >= warning.threshold) return { id: `${id}.warn`, outcome: 'warn', values: { value: rounded, threshold: warning.threshold } };
  return { id: `${id}.pass`, outcome: 'pass', values: { value: rounded, threshold: warning.threshold } };
}

export type KubeClusterReadings = { nodeCount: number | null; failedNodes: number | null; metricsUnavailable: boolean };

export function evaluateKubeCluster(readings: KubeClusterReadings, nowMs: number): Evaluation {
  const checks: ResourceCheck[] = [];
  const unread: string[] = [];

  if (readings.failedNodes === null) unread.push('kube.failedNodes');
  else if (readings.failedNodes > 0) checks.push({ id: 'kube.cluster.failedNodes', outcome: 'fail', values: { count: Math.round(readings.failedNodes) } });
  else checks.push({ id: 'kube.cluster.nodesReady', outcome: 'pass' });

  if (readings.nodeCount !== null) {
    checks.push({ id: 'kube.cluster.nodeCount', outcome: 'pass', values: { count: Math.round(readings.nodeCount) } });
  }
  if (readings.metricsUnavailable && !unread.includes('kube.failedNodes')) unread.push('kube.failedNodes');

  return evaluate({ checks, unread, evaluatedAt: nowMs, nowMs });
}

export type KubeNodeReadings = { cpu: number | null; memory: number | null; pods: number | null; metricsUnavailable: boolean };

export function evaluateKubeNode(readings: KubeNodeReadings, nowMs: number): Evaluation {
  const checks = [band('kube.node.cpu', readings.cpu), band('kube.node.memory', readings.memory)].filter(
    (check): check is ResourceCheck => check !== null,
  );
  // A node discovered by its CPU metric that has no CPU datapoint in this window is a node OpsWatch found
  // and cannot currently see.
  const unread = readings.metricsUnavailable || readings.cpu === null ? ['kube.node.cpu'] : [];
  return evaluate({ checks, unread, evaluatedAt: nowMs, nowMs });
}

export type KubePodReadings = { cpu: number | null; memory: number | null; restarts: number | null; metricsUnavailable: boolean };

export function evaluateKubePod(readings: KubePodReadings, nowMs: number): Evaluation {
  const checks = [band('kube.pod.cpu', readings.cpu), band('kube.pod.memory', readings.memory)].filter(
    (check): check is ResourceCheck => check !== null,
  );

  if (readings.restarts !== null) {
    const restarts = Math.round(readings.restarts);
    // Restarts warn rather than fail. A container that restarted once and is now serving is not an
    // outage, and OpsWatch cannot see *why* it restarted — that reason lives in the kubelet.
    checks.push(
      restarts > 0
        ? { id: 'kube.pod.restarts.warn', outcome: 'warn', values: { count: restarts } }
        : { id: 'kube.pod.restarts.pass', outcome: 'pass' },
    );
  }

  const unread = readings.metricsUnavailable || readings.cpu === null ? ['kube.pod.cpu'] : [];
  return evaluate({ checks, unread, evaluatedAt: nowMs, nowMs });
}
