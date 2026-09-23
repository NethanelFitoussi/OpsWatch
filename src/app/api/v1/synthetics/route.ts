import { pageSchema, syntheticSummarySchema } from '@opswatch/contract';
import { apiFailure, apiJson } from '@/lib/api/v1/envelope';
import { resolveEnvironment } from '@/lib/api/v1/environment';
import { apiRoute } from '@/lib/api/v1/handler';
import { listSyntheticSummaries } from '@/lib/read/synthetics';

export const dynamic = 'force-dynamic';

/**
 * `GET /api/v1/synthetics`. Bounded: an environment has the checks somebody configured, not a stream of them.
 *
 * A check that has never run reports `unknown` with no figures. It is listed all the same, because a
 * configured check nobody can see is how a check ends up switched off and forgotten.
 */
export const GET = apiRoute({
  handler: async ({ db, url }) => {
    const environment = resolveEnvironment(db, url);
    if (!environment.ok) return apiFailure(environment.error);

    const items = listSyntheticSummaries(db, { connectionId: environment.connectionId, scope: environment.scope }, Date.now());
    return apiJson(pageSchema(syntheticSummarySchema), { items, nextCursor: null });
  },
});
