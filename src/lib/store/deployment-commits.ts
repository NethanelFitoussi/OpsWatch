import 'server-only';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { deploymentCommits, deployments, type DeploymentCommitRow } from '../db/schema';

/**
 * The commits behind a deployment, as rows (REPO-4).
 *
 * Written once by the job that fetched them and read from storage afterwards, so opening a deployment
 * detail costs nothing and works when GitHub is unreachable — the same rule every other read here follows.
 *
 * **Nothing in this table is file content.** Paths and counts only: a commit's diff can carry a secret
 * somebody committed by mistake, and OpsWatch storing that would turn one accident into two.
 */

export type NewDeploymentCommit = {
  deploymentId: string;
  sha: string;
  repository: string;
  message: string;
  author: string | null;
  at: number;
  files: { path: string; additions: number; deletions: number; status: string }[];
};

/** Idempotent: re-fetching a deployment's commits updates rather than duplicates. */
export function recordDeploymentCommits(db: Db, rows: readonly NewDeploymentCommit[], nowMs: number): number {
  if (rows.length === 0) return 0;
  return db.transaction(() => {
    let written = 0;
    for (const row of rows) {
      db.insert(deploymentCommits)
        .values({ ...row, fetchedAt: nowMs })
        .onConflictDoUpdate({
          target: [deploymentCommits.deploymentId, deploymentCommits.sha],
          set: { message: row.message, author: row.author, at: row.at, files: row.files, fetchedAt: nowMs },
        })
        .run();
      written += 1;
    }
    return written;
  });
}

/** Newest first, which is the order a reader looks at "what shipped" in. */
export function listDeploymentCommits(db: Db, deploymentId: string): DeploymentCommitRow[] {
  return db
    .select()
    .from(deploymentCommits)
    .where(eq(deploymentCommits.deploymentId, deploymentId))
    .orderBy(desc(deploymentCommits.at), asc(deploymentCommits.sha))
    .all();
}

/** Whether this deployment's commits have been fetched, which is different from it having none. */
export function hasFetchedCommits(db: Db, deploymentId: string): boolean {
  return db.select({ sha: deploymentCommits.sha }).from(deploymentCommits).where(eq(deploymentCommits.deploymentId, deploymentId)).get() !== undefined;
}

/**
 * When the previous deployment of the same service started, which bounds the window of commits.
 *
 * Without it "what shipped" would be the repository's whole history. With it, it is the commits between
 * one rollout and the next — which is the question somebody looking at a deployment is actually asking.
 */
export function previousDeploymentStart(
  db: Db,
  environment: { connectionId: string; scope: string },
  serviceId: string,
  startedAt: number,
): number | null {
  const rows = db
    .select({ startedAt: deployments.startedAt })
    .from(deployments)
    .where(
      and(
        eq(deployments.connectionId, environment.connectionId),
        eq(deployments.scope, environment.scope),
        eq(deployments.serviceId, serviceId),
      ),
    )
    .orderBy(desc(deployments.startedAt))
    .all();
  return rows.find((row) => row.startedAt < startedAt)?.startedAt ?? null;
}
