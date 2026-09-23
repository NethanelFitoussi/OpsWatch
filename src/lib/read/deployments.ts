import 'server-only';
import type { DeploymentDetail, DeploymentSummary, RepositoryEvidence } from '@opswatch/contract';
import type { Db } from '../db/client';
import type { DeploymentRow } from '../db/schema';
import { DEPLOYMENT_WINDOW_MS, correlateDeployments } from '../detect/correlate';
import { hasFetchedCommits, listDeploymentCommits } from '../store/deployment-commits';
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

  const commits = listDeploymentCommits(db, row.id);
  const changed = commits.flatMap((commit) => commit.files);

  return {
    ...toDeploymentSummary(row),
    // The newest commit in the window is the one the deployment shipped, and the one a reader recognises.
    ...(commits[0] === undefined
      ? {}
      : {
          commit: {
            sha: commits[0].sha,
            message: commits[0].message,
            ...(commits[0].author === null ? {} : { author: commits[0].author }),
            at: commits[0].at,
            url: commitUrl(commits[0].repository, commits[0].sha),
          },
          repository: commits[0].repository,
        }),
    // Only when the commits were actually fetched. Zeroes for a deployment nobody enriched would read as
    // "nothing changed", which is the one thing this whole chain exists to stop (§2.4).
    ...(hasFetchedCommits(db, row.id)
      ? {
          changes: {
            files: new Set(changed.map((file) => file.path)).size,
            additions: changed.reduce((total, file) => total + file.additions, 0),
            deletions: changed.reduce((total, file) => total + file.deletions, 0),
          },
        }
      : {}),
    relatedProblems,
    evidence: commits.map(toEvidence),
    // Nothing here changes a deployment: OpsWatch reads AWS and never rolls anything back.
    allowedActions: [],
  };
}

/**
 * A link to a commit, built by the server because only the server knows the provider.
 *
 * Every repository OpsWatch knows about today is on github.com. When an enterprise host becomes a stored
 * field this is the one place that has to learn about it, which is why the link is built here rather than
 * assembled by each client from parts.
 */
function commitUrl(repository: string, sha: string): string {
  return `https://github.com/${repository}/commit/${sha}`;
}

/** One commit as §J's repository evidence: what changed, where, and a way to go and look. */
function toEvidence(commit: ReturnType<typeof listDeploymentCommits>[number]): RepositoryEvidence {
  const files = commit.files;
  return {
    id: commit.sha,
    repository: commit.repository,
    commit: {
      sha: commit.sha,
      message: commit.message,
      ...(commit.author === null ? {} : { author: commit.author }),
      at: commit.at,
      url: commitUrl(commit.repository, commit.sha),
    },
    // The first file is what the evidence points at; the summary carries the rest of the count, so a
    // commit touching forty files does not look like a commit touching one.
    ...(files[0] === undefined ? {} : { file: files[0].path }),
    summary:
      files.length === 0
        ? commit.message
        : `${commit.message} — ${files.length} ${files.length === 1 ? 'file' : 'files'}, +${files.reduce((a, f) => a + f.additions, 0)} −${files.reduce((a, f) => a + f.deletions, 0)}`,
  };
}
