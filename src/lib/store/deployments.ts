import 'server-only';
import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { randomId } from '../crypto';
import type { Db } from '../db/client';
import { deployments, type DeploymentRow } from '../db/schema';
import type { SeenDeployment } from '../detect/deployment';
import { isSettled } from '../detect/deployment';
import { appendEvent } from './events';
import type { SeqPage } from './problems';

/**
 * Deployments, as the collector records them (DEP-1).
 *
 * Identified by the provider's own deployment id within an environment, so seeing the same deployment on the
 * next cycle updates the row rather than adding a second one. That is what lets a five-minute job watch a
 * rollout progress without producing a row per poll.
 *
 * A **settled** deployment is not written again. Once ECS has said completed or failed, a later cycle that
 * still lists the deployment must not move its timestamps — otherwise a finished rollout keeps looking like
 * it happened just now, and every timeline built on it is wrong.
 */

export type DeploymentFilter = { connectionId: string; scope: string; serviceId?: string; sinceMs?: number; untilMs?: number };

export function findDeployment(db: Db, connectionId: string, scope: string, deploymentId: string): DeploymentRow | null {
  return (
    db
      .select()
      .from(deployments)
      .where(and(eq(deployments.connectionId, connectionId), eq(deployments.scope, scope), eq(deployments.deploymentId, deploymentId)))
      .get() ?? null
  );
}

/** What one cycle changed, which is what the job reports rather than "some rows were written". */
export type RecordResult = { inserted: number; updated: number; settled: number };

export function recordDeployments(
  db: Db,
  context: { connectionId: string; scope: string },
  seen: readonly SeenDeployment[],
  nowMs: number,
): RecordResult {
  const result: RecordResult = { inserted: 0, updated: 0, settled: 0 };

  db.transaction(() => {
    for (const deployment of seen) {
      const existing = findDeployment(db, context.connectionId, context.scope, deployment.deploymentId);

      if (existing === null) {
        db.insert(deployments)
          .values({
            id: randomId(),
            connectionId: context.connectionId,
            scope: context.scope,
            deploymentId: deployment.deploymentId,
            serviceId: deployment.serviceId,
            serviceName: deployment.serviceName,
            cluster: deployment.cluster,
            taskDefinition: deployment.taskDefinition,
            status: deployment.status,
            startedAt: deployment.startedAt,
            updatedAt: deployment.updatedAt,
            desiredCount: deployment.desiredCount,
            runningCount: deployment.runningCount,
            failedTasks: deployment.failedTasks,
            firstSeenAt: nowMs,
          })
          .run();
        result.inserted += 1;
        note(db, context, deployment, 'deployment_started', nowMs);
        // A deployment first seen already finished still gets its outcome recorded, or a rollout that
        // completed between two cycles would never appear as having completed at all.
        if (isSettled(deployment.status)) {
          result.settled += 1;
          note(db, context, deployment, outcomeKind(deployment.status), nowMs);
        }
        continue;
      }

      // Settled means settled: a later sighting does not move a finished rollout's timestamps.
      if (isSettled(existing.status)) continue;

      db.update(deployments)
        .set({
          status: deployment.status,
          updatedAt: deployment.updatedAt,
          desiredCount: deployment.desiredCount,
          runningCount: deployment.runningCount,
          failedTasks: deployment.failedTasks,
          taskDefinition: deployment.taskDefinition,
        })
        .where(eq(deployments.id, existing.id))
        .run();
      result.updated += 1;

      if (isSettled(deployment.status)) {
        result.settled += 1;
        note(db, context, deployment, outcomeKind(deployment.status), nowMs);
      }
    }
  });

  return result;
}

function outcomeKind(status: SeenDeployment['status']): 'deployment_completed' | 'deployment_failed' {
  return status === 'completed' ? 'deployment_completed' : 'deployment_failed';
}

/** One event per transition, deduped by kind and deployment so a replay cannot double it. */
function note(
  db: Db,
  context: { connectionId: string; scope: string },
  deployment: SeenDeployment,
  kind: 'deployment_started' | 'deployment_completed' | 'deployment_failed',
  nowMs: number,
): void {
  appendEvent(db, {
    at: nowMs,
    connectionId: context.connectionId,
    scope: context.scope,
    kind,
    subjectType: 'service',
    subjectId: deployment.serviceId,
    serviceId: deployment.serviceId,
    severity: null,
    source: 'aws',
    payload: { deploymentId: deployment.deploymentId, taskDefinition: deployment.taskDefinition },
    dedupeKey: `${kind}:${context.connectionId}:${context.scope}:${deployment.deploymentId}`,
  });
}

/** Deployments in a window, newest first. The axis is `startedAt`, which is what a timeline reads. */
export function listDeployments(db: Db, filter: DeploymentFilter, limit: number): DeploymentRow[] {
  const where = [eq(deployments.connectionId, filter.connectionId), eq(deployments.scope, filter.scope)];
  if (filter.serviceId !== undefined) where.push(eq(deployments.serviceId, filter.serviceId));
  if (filter.sinceMs !== undefined) where.push(gte(deployments.startedAt, filter.sinceMs));
  if (filter.untilMs !== undefined) where.push(lt(deployments.startedAt, filter.untilMs));
  return db
    .select()
    .from(deployments)
    .where(and(...where))
    .orderBy(desc(deployments.startedAt), asc(deployments.deploymentId))
    .limit(limit)
    .all();
}

/**
 * One page of deployments, on the immutable `(seq, id)` axis every other list uses (§33.6).
 *
 * Deliberately not the `startedAt` axis `listDeployments` reads. A cursor must be stable: `startedAt` moves
 * while a rollout is in progress, and a page resumed against it would skip or repeat a deployment that
 * finished between two requests. Newest first is what a timeline wants; resumable is what a cursor needs.
 */
export function pageDeployments(
  db: Db,
  filter: DeploymentFilter,
  cursor: { afterSeq: number; afterId: string } | null,
  limit: number,
): SeqPage<DeploymentRow> {
  const where = [eq(deployments.connectionId, filter.connectionId), eq(deployments.scope, filter.scope)];
  if (filter.serviceId !== undefined) where.push(eq(deployments.serviceId, filter.serviceId));
  if (filter.sinceMs !== undefined) where.push(gte(deployments.startedAt, filter.sinceMs));
  if (filter.untilMs !== undefined) where.push(lt(deployments.startedAt, filter.untilMs));
  if (cursor !== null) where.push(lt(deployments.seq, cursor.afterSeq));

  // Descending, so the newest deployment is the first row of the first page — and the cursor walks backwards
  // through rows that never change position, because `seq` is assigned once at insert.
  const rows = db
    .select()
    .from(deployments)
    .where(and(...where))
    .orderBy(desc(deployments.seq))
    .limit(limit + 1)
    .all();
  const items = rows.slice(0, limit);
  const more = rows.length > limit;
  const last = items[items.length - 1];
  return { items, nextSeq: more && last ? last.seq : null, nextId: more && last ? last.id : null };
}

export function countDeployments(db: Db, filter: DeploymentFilter): { total: number; failed: number } {
  const where = [eq(deployments.connectionId, filter.connectionId), eq(deployments.scope, filter.scope)];
  if (filter.serviceId !== undefined) where.push(eq(deployments.serviceId, filter.serviceId));
  if (filter.sinceMs !== undefined) where.push(gte(deployments.startedAt, filter.sinceMs));
  if (filter.untilMs !== undefined) where.push(lt(deployments.startedAt, filter.untilMs));

  const rows = db
    .select({ status: deployments.status, total: sql<number>`count(*)` })
    .from(deployments)
    .where(and(...where))
    .groupBy(deployments.status)
    .all();

  return {
    total: rows.reduce((sum, row) => sum + Number(row.total), 0),
    failed: rows.filter((row) => row.status === 'failed').reduce((sum, row) => sum + Number(row.total), 0),
  };
}
