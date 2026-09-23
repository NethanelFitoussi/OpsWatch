import { deploymentDetailSchema } from '@opswatch/contract';
import { apiFailure, apiJson } from '@/lib/api/v1/envelope';
import { resolveEnvironment } from '@/lib/api/v1/environment';
import { apiRoute } from '@/lib/api/v1/handler';
import { getDeployment } from '@/lib/read/deployments';
import { insightRenderer } from '@/lib/read/render';

export const dynamic = 'force-dynamic';

/**
 * `GET /api/v1/deployments/{id}`.
 *
 * A deployment from another environment reads as absent rather than as somebody else's, which is the rule
 * every other detail route here follows.
 */
export const GET = apiRoute<{ id: string }>({
  handler: async ({ db, url, actor, params }) => {
    const environment = resolveEnvironment(db, url);
    if (!environment.ok) return apiFailure(environment.error);

    const detail = getDeployment(
      db,
      { connectionId: environment.connectionId, scope: environment.scope, id: params.id },
      { nowMs: Date.now(), render: await insightRenderer(actor.locale) },
    );
    if (detail === null) return apiFailure('not_found');
    return apiJson(deploymentDetailSchema, detail);
  },
});
