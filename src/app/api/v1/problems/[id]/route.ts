import { problemDetailSchema } from '@opswatch/contract';
import { apiFailure, apiJson } from '@/lib/api/v1/envelope';
import { resolveEnvironment } from '@/lib/api/v1/environment';
import { apiRoute } from '@/lib/api/v1/handler';
import { getProblem } from '@/lib/read/problems';
import { insightRenderer } from '@/lib/read/render';

export const dynamic = 'force-dynamic';

/**
 * One problem and the evidence behind it. Scoped to `?env=`, so a problem id from another environment reads
 * as absent rather than as somebody else's.
 */
export const GET = apiRoute<{ id: string }>({
  handler: async ({ db, url, params, actor }) => {
    const environment = resolveEnvironment(db, url);
    if (!environment.ok) return apiFailure(environment.error);

    const found = getProblem(
      db,
      { connectionId: environment.connectionId, scope: environment.scope, id: params.id },
      { nowMs: Date.now(), render: await insightRenderer(actor.locale) },
    );
    return found === null ? apiFailure('not_found') : apiJson(problemDetailSchema, found.detail);
  },
});
