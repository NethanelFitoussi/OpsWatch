import { alertSummarySchema, pageSchema } from '@opswatch/contract';
import { apiFailure, apiJson } from '@/lib/api/v1/envelope';
import { resolveEnvironment } from '@/lib/api/v1/environment';
import { apiRoute } from '@/lib/api/v1/handler';
import { alertLabels } from '@/lib/read/alert-labels';
import { listAlertSummaries } from '@/lib/read/alerts';

export const dynamic = 'force-dynamic';

/** `GET /api/v1/alerts`. Bounded: an alert list is what is happening, not an archive. */
export const GET = apiRoute({
  handler: async ({ db, url, actor }) => {
    const environment = resolveEnvironment(db, url);
    if (!environment.ok) return apiFailure(environment.error);

    const items = listAlertSummaries(
      db,
      { connectionId: environment.connectionId, scope: environment.scope },
      await alertLabels(actor.locale),
    );
    return apiJson(pageSchema(alertSummarySchema), { items, nextCursor: null });
  },
});
