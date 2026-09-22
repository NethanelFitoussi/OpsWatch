import { briefSchema } from '@opswatch/contract';
import { apiFailure, apiJson } from '@/lib/api/v1/envelope';
import { resolveEnvironment } from '@/lib/api/v1/environment';
import { apiRoute } from '@/lib/api/v1/handler';
import { readBrief } from '@/lib/read/brief';
import { healthLabels } from '@/lib/read/health-labels';
import { insightRenderer } from '@/lib/read/render';

export const dynamic = 'force-dynamic';

/** What changed since yesterday, from the events spine rather than a second read of AWS. */
export const GET = apiRoute({
  handler: async ({ db, url, actor }) => {
    const environment = resolveEnvironment(db, url);
    if (!environment.ok) return apiFailure(environment.error);

    const brief = readBrief(
      db,
      { connectionId: environment.connectionId, scope: environment.scope },
      { nowMs: Date.now(), render: await insightRenderer(actor.locale), labels: await healthLabels(actor.locale) },
    );
    return apiJson(briefSchema, brief);
  },
});
