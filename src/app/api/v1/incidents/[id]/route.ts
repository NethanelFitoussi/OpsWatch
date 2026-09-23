import { incidentDetailSchema } from '@opswatch/contract';
import { apiFailure, apiJson } from '@/lib/api/v1/envelope';
import { resolveEnvironment } from '@/lib/api/v1/environment';
import { apiRoute } from '@/lib/api/v1/handler';
import { incidentLabels } from '@/lib/read/incident-labels';
import { getIncident } from '@/lib/read/incidents';
import { insightRenderer } from '@/lib/read/render';

export const dynamic = 'force-dynamic';

/** `GET /api/v1/incidents/{id}`. Scoped, so an id from another environment reads as absent. */
export const GET = apiRoute<{ id: string }>({
  handler: async ({ db, url, params, actor }) => {
    const environment = resolveEnvironment(db, url);
    if (!environment.ok) return apiFailure(environment.error);

    const result = getIncident(
      db,
      { connectionId: environment.connectionId, scope: environment.scope, id: params.id },
      await incidentLabels(actor.locale),
      { nowMs: Date.now(), render: await insightRenderer(actor.locale) },
    );
    if (result === null) return apiFailure('not_found');
    return apiJson(incidentDetailSchema, result.detail);
  },
});
