import { pageSchema, problemSummarySchema } from '@opswatch/contract';
import { apiFailure, apiJson } from '@/lib/api/v1/envelope';
import { resolveEnvironment } from '@/lib/api/v1/environment';
import { apiRoute } from '@/lib/api/v1/handler';
import { parsePagination } from '@/lib/api/v1/request';
import { listProblems } from '@/lib/read/problems';
import { insightRenderer } from '@/lib/read/render';

export const dynamic = 'force-dynamic';

/** Cursored on the immutable `(seq, id)` axis the store pages on — never on score or recency (§33.6). */
export const GET = apiRoute({
  handler: async ({ db, url, actor }) => {
    const environment = resolveEnvironment(db, url);
    if (!environment.ok) return apiFailure(environment.error);
    const pagination = parsePagination(url);
    if (!pagination.ok) return apiFailure(pagination.error);

    const page = listProblems(
      db,
      {
        connectionId: environment.connectionId,
        scope: environment.scope,
        cursor: pagination.cursor,
        limit: pagination.limit,
      },
      { nowMs: Date.now(), render: await insightRenderer(actor.locale) },
    );
    return apiJson(pageSchema(problemSummarySchema), page);
  },
});
