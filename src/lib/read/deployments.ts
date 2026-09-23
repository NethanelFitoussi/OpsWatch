import 'server-only';
import type { DeploymentDetail, DeploymentSummary } from '@opswatch/contract';
import type { Db } from '../db/client';
import type { DeploymentRow } from '../db/schema';
import { DEPLOYMENT_WINDOW_MS, correlateDeployments } from '../detect/correlate';
import { findDeployment, listDeployments, pageDeployments } from '../store/deployments';
import { listEvidence, listLiveProblems } from '../store/problems';
import { toPage, toStoreCursor } from './paging';
import { toSummary as toProblemSummary, type ReadContext } from './problems';
import type { CursorPosition } from '@opswatch/contract';

/**
 * What shipped, as every client reads it (DEP-3).
 *
 * Read entirely from rows the deployments job already wrote, so a history goes back as far as collection
 * does and costs nothing to open. An environment where the job has never run returns an empty page — which
 * a client must not read as "nothing shipped", and the page says so in words rather than showing a blank.
 *
 * **The problems beside a deployment are a correlation, never a cause.** §7 and §J are explicit: two
 * timestamps being close is an observed fact, and the reader decides what it means. Nothing here ranks,
 * blames or says "caused by", and the field that carries it is named for the delay rather than for a claim.
 */

/** How many problems one deployment's correlation looks at. A detail page is a summary, not a search. */
const RELATED_LIMIT = 20;

export function toDeploymentSummary(row: DeploymentRow): DeploymentSummary {
  return {
    id: row.deploymentId,
    service: { type: 'service', id: row.serviceId, label: row.serviceName },
    environment: row.cluster,
    // The task definition revision, which is the version a reader recognises on the ECS console too.
    version: row.taskDefinition,
    at: row.startedAt,
    status: row.status,
  };
}

/**
 * The most recent deployments, newest **first shipped** — the order a timeline is read in.
 *
 * Deliberately a different order from the cursored list below, and the difference is the point. A page
 * shows a human a history, so it sorts by when each deployment started. A cursor has to resume exactly
 * where it left off, so it walks an axis nothing can reorder. Sorting the cursored list by `startedAt`
 * would give the nicer order and a page that silently skips rows; sorting the page by `seq` would give a
 * history ordered by when the collector happened to notice each rollout.
 */
export function recentDeployments(db: Db, query: { connectionId: string; scope: string }, limit: number): DeploymentSummary[] {
  return listDeployments(db, query, limit).map(toDeploymentSummary);
}

export function listDeploymentSummaries(
  db: Db,
  query: { connectionId: string; scope: string; serviceId?: string; cursor: CursorPosition | null; limit: number },
): { items: DeploymentSummary[]; nextCursor: string | null } {
  const page = pageDeployments(
    db,
    { connectionId: query.connectionId, scope: query.scope, ...(query.serviceId === undefined ? {} : { serviceId: query.serviceId }) },
    toStoreCursor(query.cursor),
    query.limit,
  );
  return toPage(page, toDeploymentSummary);
}

/**
 * One deployment, with the problems that started within half an hour after it.
 *
 * After, not before: a problem already open when a deployment started cannot have followed it, and offering
 * it would invite exactly the reading §7 forbids. The same-service filter is the declared relation that
 * stops "everything that happened that afternoon" from looking related.
 */
export function getDeployment(
  db: Db,
  query: { connectionId: string; scope: string; id: string },
  context: ReadContext,
): DeploymentDetail | null {
  const row = findDeployment(db, query.connectionId, query.scope, query.id);
  if (row === null) return null;

  // The same-service filter runs before the limit, and that order is the whole of it: `correlateDeployments`
  // would reject another service's problem anyway, but only after it had already taken one of the twenty
  // places. A noisy environment would then push this deployment's own problems out of a list about it.
  const problems = listLiveProblems(db, query.connectionId, query.scope)
    .map(({ row: problem }) => problem)
    .filter((problem) => problem.serviceId === row.serviceId)
    .slice(0, RELATED_LIMIT);

  // The same arithmetic as a problem's own deployment panel, with the two sides swapped: here the
  // deployment is fixed and the problems vary, so each problem is correlated against this one deployment.
  const relatedProblems = problems
    .flatMap((problem) =>
      correlateDeployments([row], { serviceId: problem.serviceId, firstSeenAt: problem.firstSeenAt }, DEPLOYMENT_WINDOW_MS).map(
        (correlated) => ({
          problem: toProblemSummary(problem, listEvidence(db, problem.id), context),
          minutesAfterDeployment: correlated.minutesBefore,
        }),
      ),
    )
    .sort((a, b) => a.minutesAfterDeployment - b.minutesAfterDeployment);

  return {
    ...toDeploymentSummary(row),
    relatedProblems,
    evidence: [],
    // Nothing here changes a deployment: OpsWatch reads AWS and never rolls anything back.
    allowedActions: [],
  };
}
