import { investigationSchema } from '@opswatch/contract';
import { apiFailure, apiJson } from '@/lib/api/v1/envelope';
import { resolveEnvironment } from '@/lib/api/v1/environment';
import { apiRoute } from '@/lib/api/v1/handler';
import { investigationLabels } from '@/lib/read/investigation-labels';
import { readInvestigationById } from '@/lib/read/investigations';
import { insightRenderer } from '@/lib/read/render';

export const dynamic = 'force-dynamic';

/**
 * The investigation of one problem (INV-1): §7's three bands, kept apart on the wire.
 *
 * The id is the problem's, because an investigation is derived from it rather than stored beside it. What
 * a client must not do with the answer is flatten it: `kind` tells an observed fact from a correlation
 * from a hypothesis, and merging them lets a guess inherit the authority of a measurement.
 */
export const GET = apiRoute<{ id: string }>({
  handler: async ({ db, url, params, actor }) => {
    const environment = resolveEnvironment(db, url);
    if (!environment.ok) return apiFailure(environment.error);

    const investigation = readInvestigationById(
      db,
      { connectionId: environment.connectionId, scope: environment.scope, id: params.id },
      {
        nowMs: Date.now(),
        labels: await investigationLabels(actor.locale),
        render: await insightRenderer(actor.locale),
      },
    );
    return investigation === null ? apiFailure('not_found') : apiJson(investigationSchema, investigation);
  },
});
