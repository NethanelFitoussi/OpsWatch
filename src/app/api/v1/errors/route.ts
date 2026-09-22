import { ERROR_STATUSES, errorSummarySchema, pageSchema, type ErrorStatus } from '@opswatch/contract';
import { apiFailure, apiJson } from '@/lib/api/v1/envelope';
import { resolveEnvironment } from '@/lib/api/v1/environment';
import { apiRoute } from '@/lib/api/v1/handler';
import { enumFilter, parseListFilters, parsePagination } from '@/lib/api/v1/request';
import { listErrors } from '@/lib/read/errors';

export const dynamic = 'force-dynamic';

/** Cursored on the immutable `(seq, id)` axis, like every other list (§33.6). */
export const GET = apiRoute({
  handler: ({ db, url }) => {
    const environment = resolveEnvironment(db, url);
    if (!environment.ok) return apiFailure(environment.error);
    const pagination = parsePagination(url);
    if (!pagination.ok) return apiFailure(pagination.error);

    // Refused rather than dropped, for the reason in `LIST_FILTERS`.
    const filters = parseListFilters(url, '/errors');
    if (!filters.ok) return apiFailure(filters.error);
    const status = enumFilter<ErrorStatus>(filters.status, ERROR_STATUSES);
    if (!status.ok) return apiFailure('invalid_request');

    return apiJson(
      pageSchema(errorSummarySchema),
      listErrors(
        db,
        {
          connectionId: environment.connectionId,
          scope: environment.scope,
          cursor: pagination.cursor,
          limit: pagination.limit,
          ...(status.values === undefined ? {} : { wireStatus: status.values }),
          ...(filters.service === null ? {} : { serviceId: filters.service }),
          ...(filters.sinceMs === null ? {} : { sinceMs: filters.sinceMs }),
        },
        { nowMs: Date.now() },
      ),
    );
  },
});
