import { healthSchema } from '@opswatch/contract';
import { apiFailure, apiJson } from '@/lib/api/v1/envelope';
import { resolveEnvironment } from '@/lib/api/v1/environment';
import { apiRoute } from '@/lib/api/v1/handler';
import { readHealth } from '@/lib/read/health';
import { healthLabels } from '@/lib/read/health-labels';
import { insightRenderer } from '@/lib/read/render';

export const dynamic = 'force-dynamic';

/** Answers from the database the collector writes: instant, and it costs no AWS request. */
export const GET = apiRoute({
  handler: async ({ db, url, actor }) => {
    const environment = resolveEnvironment(db, url);
    if (!environment.ok) return apiFailure(environment.error);

    const health = readHealth(
      db,
      { connectionId: environment.connectionId, scope: environment.scope },
      {
        nowMs: Date.now(),
        render: await insightRenderer(actor.locale),
        labels: await healthLabels(actor.locale),
      },
    );
    return apiJson(healthSchema, health);
  },
});
