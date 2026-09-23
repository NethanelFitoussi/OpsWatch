import { deploymentSummarySchema, pageSchema } from '@opswatch/contract';
import { apiFailure, apiJson } from '@/lib/api/v1/envelope';
import { resolveEnvironment } from '@/lib/api/v1/environment';
import { apiRoute } from '@/lib/api/v1/handler';
import { parsePagination } from '@/lib/api/v1/request';
import { listDeploymentSummaries } from '@/lib/read/deployments';

export const dynamic = 'force-dynamic';

/** Cursored on the immutable `(seq, id)` axis, never on `startedAt`, which moves while a rollout runs (§33.6). */
export const GET = apiRoute({
  handler: async ({ db, url }) => {
    const environment = resolveEnvironment(db, url);
    if (!environment.ok) return apiFailure(environment.error);
    const pagination = parsePagination(url);
    if (!pagination.ok) return apiFailure(pagination.error);

    const page = listDeploymentSummaries(db, {
      connectionId: environment.connectionId,
      scope: environment.scope,
      cursor: pagination.cursor,
      limit: pagination.limit,
    });
    return apiJson(pageSchema(deploymentSummarySchema), page);
  },
});
