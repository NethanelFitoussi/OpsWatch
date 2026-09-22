import { errorDetailSchema } from '@opswatch/contract';
import { apiFailure, apiJson } from '@/lib/api/v1/envelope';
import { resolveEnvironment } from '@/lib/api/v1/environment';
import { apiRoute } from '@/lib/api/v1/handler';
import { getError } from '@/lib/read/errors';

export const dynamic = 'force-dynamic';

/** One error group, with the frames its fingerprint was computed over. */
export const GET = apiRoute<{ id: string }>({
  handler: ({ db, url, params }) => {
    const environment = resolveEnvironment(db, url);
    if (!environment.ok) return apiFailure(environment.error);

    const detail = getError(
      db,
      { connectionId: environment.connectionId, scope: environment.scope, id: params.id },
      { nowMs: Date.now() },
    );
    return detail === null ? apiFailure('not_found') : apiJson(errorDetailSchema, detail);
  },
});
