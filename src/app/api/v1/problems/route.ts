import { PROBLEM_STATUSES, SEVERITIES, pageSchema, problemSummarySchema, type ProblemStatus, type Severity } from '@opswatch/contract';
import { apiFailure, apiJson } from '@/lib/api/v1/envelope';
import { resolveEnvironment } from '@/lib/api/v1/environment';
import { apiRoute } from '@/lib/api/v1/handler';
import { enumFilter, parseListFilters, parsePagination } from '@/lib/api/v1/request';
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

    // A filter this endpoint will not honour is refused, never dropped: a full page answering a request that
    // asked for a filtered one looks like an answer and is not.
    const filters = parseListFilters(url, '/problems');
    if (!filters.ok) return apiFailure(filters.error);
    const status = enumFilter<ProblemStatus>(filters.status, PROBLEM_STATUSES);
    if (!status.ok) return apiFailure('invalid_request');
    const severity = enumFilter<Severity>(filters.severity, SEVERITIES);
    if (!severity.ok) return apiFailure('invalid_request');

    const page = listProblems(
      db,
      {
        connectionId: environment.connectionId,
        scope: environment.scope,
        cursor: pagination.cursor,
        limit: pagination.limit,
        ...(status.values === undefined ? {} : { wireStatus: status.values }),
        ...(severity.values === undefined ? {} : { severity: severity.values }),
        ...(filters.service === null ? {} : { serviceId: filters.service }),
        ...(filters.sinceMs === null ? {} : { sinceMs: filters.sinceMs }),
      },
      { nowMs: Date.now(), render: await insightRenderer(actor.locale) },
    );
    return apiJson(pageSchema(problemSummarySchema), page);
  },
});
