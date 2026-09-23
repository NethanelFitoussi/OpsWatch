import { incidentSummarySchema, pageSchema } from '@opswatch/contract';
import { apiFailure, apiJson } from '@/lib/api/v1/envelope';
import { resolveEnvironment } from '@/lib/api/v1/environment';
import { apiRoute } from '@/lib/api/v1/handler';
import { incidentLabels } from '@/lib/read/incident-labels';
import { listIncidentSummaries } from '@/lib/read/incidents';

export const dynamic = 'force-dynamic';

/**
 * `GET /api/v1/incidents`.
 *
 * Bounded rather than cursored: §16's incidents are rare by construction, and a list of them is a way into
 * the ones that are open rather than an archive to page through.
 */
export const GET = apiRoute({
  handler: async ({ db, url, actor }) => {
    const environment = resolveEnvironment(db, url);
    if (!environment.ok) return apiFailure(environment.error);

    const items = listIncidentSummaries(
      db,
      { connectionId: environment.connectionId, scope: environment.scope },
      await incidentLabels(actor.locale),
    );
    return apiJson(pageSchema(incidentSummarySchema), { items, nextCursor: null });
  },
});
