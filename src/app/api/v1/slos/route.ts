import { pageSchema, sloSummarySchema } from '@opswatch/contract';
import { apiFailure, apiJson } from '@/lib/api/v1/envelope';
import { resolveEnvironment } from '@/lib/api/v1/environment';
import { apiRoute } from '@/lib/api/v1/handler';
import { listSloSummaries } from '@/lib/read/slos';

export const dynamic = 'force-dynamic';

/**
 * `GET /api/v1/slos`. Bounded: an environment has the objectives somebody defined, not a stream of them.
 *
 * Every summary is measured from stored history, so this costs nothing and never reads AWS. A definition
 * with no history behind it answers `current: null` and `unknown` rather than a figure it cannot support.
 */
export const GET = apiRoute({
  handler: async ({ db, url }) => {
    const environment = resolveEnvironment(db, url);
    if (!environment.ok) return apiFailure(environment.error);

    const items = listSloSummaries(db, { connectionId: environment.connectionId, scope: environment.scope }, Date.now());
    return apiJson(pageSchema(sloSummarySchema), { items, nextCursor: null });
  },
});
