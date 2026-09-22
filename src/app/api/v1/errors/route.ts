import { errorSummarySchema, pageSchema } from '@opswatch/contract';
import { apiFailure, apiJson } from '@/lib/api/v1/envelope';
import { resolveEnvironment } from '@/lib/api/v1/environment';
import { apiRoute } from '@/lib/api/v1/handler';
import { parsePagination } from '@/lib/api/v1/request';
import { listErrors } from '@/lib/read/errors';

export const dynamic = 'force-dynamic';

/** Cursored on the immutable `(seq, id)` axis, like every other list (§33.6). */
export const GET = apiRoute({
  handler: ({ db, url }) => {
    const environment = resolveEnvironment(db, url);
    if (!environment.ok) return apiFailure(environment.error);
    const pagination = parsePagination(url);
    if (!pagination.ok) return apiFailure(pagination.error);

    return apiJson(
      pageSchema(errorSummarySchema),
      listErrors(
        db,
        {
          connectionId: environment.connectionId,
          scope: environment.scope,
          cursor: pagination.cursor,
          limit: pagination.limit,
        },
        { nowMs: Date.now() },
      ),
    );
  },
});
