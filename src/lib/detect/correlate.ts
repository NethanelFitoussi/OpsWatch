/**
 * Correlating a problem with what changed around it (§7).
 *
 * The rule this file exists to keep, stated in §7 and worth repeating wherever it is used: a correlation
 * **states the measured Δt and the relation, and never says "because"**. "The error rate rose 8 minutes
 * after this deployment" is a fact about two timestamps. "The deployment caused it" is a claim nobody here
 * can make, and a product that makes it will be wrong in exactly the cases where being wrong costs most —
 * an unrelated deployment during an incident is the most ordinary thing in the world.
 *
 * So this returns the measurement, and every surface rendering it says which it is.
 */

/** §7's window for a general correlation: two facts closer than this are worth putting side by side. */
export const CORRELATION_WINDOW_MS = 15 * 60_000;

/**
 * The wider window §5's `deploy_regression` hypothesis uses. A deployment half an hour before a problem is
 * still worth showing; it simply carries less weight than one eight minutes before.
 */
export const DEPLOYMENT_WINDOW_MS = 30 * 60_000;

export type CorrelatedDeployment<T> = {
  deployment: T;
  /** Minutes between the deployment and the problem starting. Always ≥ 0: a later one is not correlated. */
  minutesBefore: number;
  /** True inside §7's tighter window, which is what makes a pair worth calling a correlation at all. */
  close: boolean;
};

/**
 * Deployments of the same service that started before the problem did, within the window.
 *
 * Same service is the **declared relation** §7 requires — without it, any two things happening at once in a
 * busy account would look correlated, which is how a correlation feature becomes noise. A problem with no
 * service is therefore correlated with nothing, rather than with everything in the environment.
 */
export function correlateDeployments<T extends { serviceId: string; startedAt: number }>(
  deployments: readonly T[],
  problem: { serviceId: string | null; firstSeenAt: number },
  windowMs = DEPLOYMENT_WINDOW_MS,
): CorrelatedDeployment<T>[] {
  // A problem with no service falls out of the same-service filter below rather than needing its own guard:
  // no deployment has a null service, so nothing matches. Stated here because the absence looks like an
  // oversight otherwise, and a mutation test proved an early return here was dead code.
  return deployments
    .filter((deployment) => deployment.serviceId === problem.serviceId)
    // Before, not after: a deployment that happened later cannot be correlated with a problem already open,
    // and showing it would invite exactly the reading §7 forbids.
    .filter((deployment) => deployment.startedAt <= problem.firstSeenAt && problem.firstSeenAt - deployment.startedAt <= windowMs)
    .map((deployment) => {
      const delta = problem.firstSeenAt - deployment.startedAt;
      return {
        deployment,
        minutesBefore: Math.round(delta / 60_000),
        close: delta <= CORRELATION_WINDOW_MS,
      };
    })
    // Nearest first: the most recent change before a problem is the one a reader looks at first.
    .sort((a, b) => a.minutesBefore - b.minutesBefore);
}
