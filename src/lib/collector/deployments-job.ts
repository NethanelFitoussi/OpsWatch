import 'server-only';
import type { Db } from '../db/client';
import { seenDeployments } from '../detect/deployment';
import { listClusters, listServices } from '../monitoring/ecs';
import { resolveTarget } from '../monitoring/target';
import { recordDeployments } from '../store/deployments';
import { enrichRecent } from './deployment-code';
import { JOBS } from './jobs';
import type { JobOutcome } from './runner';

/**
 * The `deployments` job: what shipped, and whether it worked (DEP-1).
 *
 * It reads the same ECS services the Insights page and the detect job read, through the same cache, so on a
 * cycle where those have already run it costs no additional AWS call — the reasoning §9.5 uses for `detect`.
 *
 * What it adds is memory. ECS reports a service's *current* deployments and forgets them once they drain, so
 * a rollout that failed at 03:00 is invisible by morning unless something wrote it down. That is the whole
 * reason this job exists, and it is why a settled deployment is never rewritten (see the store).
 */

export type DeploymentsJobInput = { db: Db; connectionId: string; scope: string; nowMs: number };

export async function runDeploymentsJob(input: DeploymentsJobInput): Promise<JobOutcome> {
  const target = await resolveTarget({ connectionId: input.connectionId, region: input.scope });
  if (!target.ok) throw new Error('connection_unavailable');

  const clusters = await listClusters(target.data);
  if (!clusters.ok) throw new Error(clusters.code);

  const cap = JOBS.deployments.cap ?? Number.POSITIVE_INFINITY;
  const services: { name: string; cluster: string; deployments: Parameters<typeof seenDeployments>[0][number]['deployments'] }[] = [];
  let read = 0;
  let truncated = false;

  for (const cluster of clusters.data) {
    if (services.length >= cap) {
      truncated = true;
      break;
    }
    const listed = await listServices(target.data, cluster.name, '');
    // A cluster that cannot be read leaves its services uncounted rather than recorded as having none.
    if (!listed.ok) continue;
    read += 1;
    for (const service of listed.data.services) {
      if (services.length >= cap) {
        truncated = true;
        break;
      }
      services.push({ name: service.name, cluster: cluster.name, deployments: service.deployments });
    }
    if (listed.data.truncated) truncated = true;
  }

  const seen = seenDeployments(services, input.nowMs);
  recordDeployments(input.db, { connectionId: input.connectionId, scope: input.scope }, seen, input.nowMs);

  // §J's chain, closed: service → repository → deployment → commit → changed files. It does nothing at all
  // unless GitHub is verified and the service is mapped, so a fresh installation pays nothing for it.
  await enrichRecent(input.db, { connectionId: input.connectionId, scope: input.scope }, input.nowMs);

  // Coverage is clusters read of clusters found: a cluster that could not be read leaves its services
  // uncounted rather than recorded as having none, and the run says so (§2.4).
  return { covered: read, total: clusters.data.length, truncated: truncated || read < clusters.data.length };
}
