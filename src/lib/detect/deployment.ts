/**
 * Turning what ECS reports about a deployment into what the product stores (§14, DEP-1).
 *
 * Pure, and in the detect layer for the same reason `family.ts` is: the collector writes these and a report
 * reads them, and neither should have to import the other to agree on what a deployment is.
 *
 * The care here is in **not inventing a status**. ECS reports a rollout state for a service using the
 * rolling deployment controller and nothing at all for the others, so a deployment whose outcome is not
 * stated is `unknown` — never `completed` because it stopped being primary, which would report a success
 * nobody observed.
 */

/** The contract's statuses, which are also what is stored, so nothing is translated on the way out. */
export const DEPLOYMENT_STATUSES = ['in_progress', 'completed', 'failed', 'rolled_back', 'unknown'] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

/** What one deployment looked like when it was read. */
export type SeenDeployment = {
  deploymentId: string;
  serviceId: string;
  serviceName: string;
  cluster: string;
  /** The task definition revision, which is the version a reader recognises: `web:42`. */
  taskDefinition: string;
  status: DeploymentStatus;
  startedAt: number;
  updatedAt: number;
  desiredCount: number;
  runningCount: number;
  failedTasks: number;
};

/** The shape this reads, named so the detect layer does not import the AWS module to describe it. */
export type EcsDeploymentInput = {
  id: string;
  status: string;
  rolloutState: string | null;
  taskDefinition: string;
  desiredCount: number;
  runningCount: number;
  pendingCount: number;
  failedTasks: number;
  createdAt: number | null;
  updatedAt: number | null;
};

/**
 * The rollout state, when ECS gives one. `ACTIVE` means a superseded deployment still draining, which is not
 * a failure and not a success — so it stays `unknown` unless the rollout state says otherwise.
 */
export function deploymentStatus(deployment: Pick<EcsDeploymentInput, 'status' | 'rolloutState' | 'failedTasks'>): DeploymentStatus {
  switch (deployment.rolloutState) {
    case 'COMPLETED':
      return 'completed';
    case 'FAILED':
      return 'failed';
    case 'IN_PROGRESS':
      return 'in_progress';
    default:
      break;
  }
  // No rollout state: only the circuit breaker's failed tasks are evidence of anything, and only of failure.
  if (deployment.failedTasks > 0) return 'failed';
  return 'unknown';
}

/** Whether a deployment is still moving, which decides if a stored row may still change. */
export function isSettled(status: DeploymentStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'rolled_back';
}

export function toSeenDeployment(
  deployment: EcsDeploymentInput,
  service: { name: string; cluster: string },
  nowMs: number,
): SeenDeployment | null {
  // A deployment with no id cannot be deduplicated, and a row that duplicates on every cycle is worse than
  // a missing one.
  if (deployment.id === '') return null;
  return {
    deploymentId: deployment.id,
    serviceId: `${service.cluster}/${service.name}`,
    serviceName: service.name,
    cluster: service.cluster,
    taskDefinition: deployment.taskDefinition,
    status: deploymentStatus(deployment),
    // A deployment AWS gave no timestamp for is recorded as seen now, which is the only honest answer and
    // is why `startedAt` is not nullable: a timeline cannot place a null.
    startedAt: deployment.createdAt ?? nowMs,
    updatedAt: deployment.updatedAt ?? deployment.createdAt ?? nowMs,
    desiredCount: deployment.desiredCount,
    runningCount: deployment.runningCount,
    failedTasks: deployment.failedTasks,
  };
}

/** Every deployment across a set of services, newest first. */
export function seenDeployments(
  services: readonly { name: string; cluster: string; deployments: readonly EcsDeploymentInput[] }[],
  nowMs: number,
): SeenDeployment[] {
  return services
    .flatMap((service) => service.deployments.map((deployment) => toSeenDeployment(deployment, service, nowMs)))
    .filter((seen): seen is SeenDeployment => seen !== null)
    .sort((a, b) => b.startedAt - a.startedAt || a.deploymentId.localeCompare(b.deploymentId));
}
