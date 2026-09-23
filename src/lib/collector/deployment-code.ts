import 'server-only';
import type { Db } from '../db/client';
import type { DeploymentRow } from '../db/schema';
import { fetchCommit, fetchCommits, githubIsReady } from '../github/connection';
import type { GithubDeps } from '../github/api';
import { hasFetchedCommits, previousDeploymentStart, recordDeploymentCommits } from '../store/deployment-commits';
import { listDeployments } from '../store/deployments';
import { findMapping, findRepository } from '../store/repositories';

/**
 * Closing §J's chain: service → repository → deployment → commit → changed files.
 *
 * Every link already existed and none of them met. A service maps to a repository, a deployment belongs to
 * a service, and GitHub can say which commits landed between two rollouts — but nothing joined them, so a
 * problem next to a deployment could never say *what changed*.
 *
 * **It runs only when all three conditions hold**: GitHub is verified, the service is mapped, and the
 * deployment has not been enriched before. Any of them false and nothing is fetched, nothing is written,
 * and the detail page says which link is missing rather than showing an empty list that reads as "nothing
 * changed".
 */

/** How far back to look when a service has no earlier deployment recorded. */
export const FIRST_DEPLOYMENT_WINDOW_MS = 24 * 60 * 60_000;

/** How many commits one deployment is enriched with. A rollout is explained by a handful. */
export const MAX_COMMITS = 10;

export type EnrichResult = { enriched: number; commits: number; skipped: 'not_connected' | 'no_mapping' | 'already' | null };

export async function enrichDeployment(
  db: Db,
  deployment: DeploymentRow,
  nowMs: number,
  deps: GithubDeps = {},
): Promise<EnrichResult> {
  // A stored token that has never answered is not a connection, so nothing is attempted with it.
  if (!githubIsReady(db)) return { enriched: 0, commits: 0, skipped: 'not_connected' };
  if (hasFetchedCommits(db, deployment.id)) return { enriched: 0, commits: 0, skipped: 'already' };

  const mapping = findMapping(db, deployment.connectionId, deployment.scope, deployment.serviceId);
  if (mapping === null) return { enriched: 0, commits: 0, skipped: 'no_mapping' };
  const repository = findRepository(db, mapping.repositoryId);
  if (repository === null) return { enriched: 0, commits: 0, skipped: 'no_mapping' };

  const previous = previousDeploymentStart(
    db,
    { connectionId: deployment.connectionId, scope: deployment.scope },
    deployment.serviceId,
    deployment.startedAt,
  );
  const window = {
    // The first deployment of a service has nothing before it, so a day is the honest bound rather than
    // the repository's history — and the page says the window it used.
    sinceMs: previous ?? deployment.startedAt - FIRST_DEPLOYMENT_WINDOW_MS,
    untilMs: deployment.startedAt,
  };

  const listed = await fetchCommits(db, { owner: repository.owner, name: repository.name, branch: repository.defaultBranch }, window, nowMs, deps);
  if (!listed.ok) return { enriched: 0, commits: 0, skipped: null };

  const full = `${repository.owner}/${repository.name}`;
  const rows = [];
  for (const commit of listed.data.slice(0, MAX_COMMITS)) {
    // One call per commit, bounded by MAX_COMMITS: GitHub reports changed files on the commit itself,
    // not on the list, and an unbounded fan-out over a busy repository is how a job becomes a rate limit.
    const detail = await fetchCommit(db, { owner: repository.owner, name: repository.name }, commit.sha, nowMs, deps);
    rows.push({
      deploymentId: deployment.id,
      sha: commit.sha,
      repository: full,
      message: commit.message,
      author: commit.author,
      at: commit.at,
      // A commit whose detail could not be read is still recorded: knowing it shipped is worth more than
      // knowing which files it touched, and an absent list is not an empty one.
      files: detail.ok ? detail.data.files : [],
    });
  }

  const written = recordDeploymentCommits(db, rows, nowMs);
  return { enriched: written > 0 ? 1 : 0, commits: written, skipped: null };
}

/** How many deployments one cycle enriches. A busy environment must not turn one pass into a fan-out. */
export const ENRICH_PER_CYCLE = 5;

/**
 * Enriches the deployments this cycle may have just recorded.
 *
 * Newest first and bounded, so a backlog is worked through over several cycles rather than in one burst
 * against somebody's rate limit. Already-enriched deployments cost nothing: the check is a stored row.
 */
export async function enrichRecent(
  db: Db,
  environment: { connectionId: string; scope: string },
  nowMs: number,
  deps: GithubDeps = {},
): Promise<{ enriched: number; commits: number }> {
  // Asked once rather than per deployment: with no connection there is nothing to do for any of them.
  if (!githubIsReady(db)) return { enriched: 0, commits: 0 };

  let enriched = 0;
  let commits = 0;
  for (const deployment of listDeployments(db, environment, ENRICH_PER_CYCLE)) {
    const result = await enrichDeployment(db, deployment, nowMs, deps);
    enriched += result.enriched;
    commits += result.commits;
  }
  return { enriched, commits };
}
