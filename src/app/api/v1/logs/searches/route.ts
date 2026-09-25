import { logSearchRequestSchema, logSearchSchema } from '@opswatch/contract';
import { apiFailure, apiJson } from '@/lib/api/v1/envelope';
import { resolveEnvironment } from '@/lib/api/v1/environment';
import { apiRoute } from '@/lib/api/v1/handler';
import { LOGS_MAX_GROUPS, LOGS_MAX_RANGE_SECONDS, LOGS_MAX_ROWS, startLogsQuery } from '@/lib/monitoring/logs';
import { failureCode } from '@/lib/monitoring/logs-route';
import { queryBindings } from '@/lib/monitoring/query-bindings';
import { resolveTarget } from '@/lib/monitoring/target';
import { queryFor, toLogSearch } from '@/lib/read/logs';

export const dynamic = 'force-dynamic';

/**
 * Starts a log search (LOG-5).
 *
 * The caller sends what it wants found, never a query string: the server composes the query, so nobody
 * can ask for an aggregation the answer has no room for, and nobody can widen the search past the log
 * groups they named. Every bound is enforced here rather than trimmed — a request over the cap is refused
 * with `invalid_request`, because silently searching fewer log groups than were asked for would answer a
 * question nobody asked.
 *
 * The answer is a search that has *started*, with `status: running` and no lines. Poll it by its id.
 */
export const POST = apiRoute({
  mutating: true,
  handler: async ({ db, url, request, actor }) => {
    const environment = resolveEnvironment(db, url);
    if (!environment.ok) return apiFailure(environment.error);

    const parsed = logSearchRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiFailure('invalid_request');
    const input = parsed.data;
    if (input.logGroups.length > LOGS_MAX_GROUPS) return apiFailure('invalid_request');
    if (input.rangeSeconds > LOGS_MAX_RANGE_SECONDS) return apiFailure('invalid_request');

    const limit = Math.min(input.limit ?? 100, LOGS_MAX_ROWS);
    const query = queryFor(input, limit);
    const endSeconds = Math.floor(Date.now() / 1000);

    const target = await resolveTarget({ connectionId: environment.connectionId, region: environment.scope });
    if (!target.ok) return apiFailure(failureCode(target));
    const started = await startLogsQuery(target.data, {
      logGroups: input.logGroups,
      query,
      startSeconds: endSeconds - input.rangeSeconds,
      endSeconds,
    });
    if (!started.ok) return apiFailure(failureCode(started));

    /*
     * Who may poll this search. Bound to the person rather than to the credential they happened to use,
     * so signing in again on a phone does not orphan a search started on a laptop — and so that one
     * administrator can never poll another's, which is the isolation that actually matters here.
     */
    queryBindings.bind(started.data.queryId, {
      connectionId: environment.connectionId,
      region: environment.scope,
      sessionId: `admin:${actor.adminId}`,
    });

    return apiJson(
      logSearchSchema,
      toLogSearch(started.data.queryId, query, {
        status: 'Scheduled',
        fields: [],
        rows: [],
        statistics: { recordsMatched: 0, recordsScanned: 0, bytesScanned: 0 },
      }),
      202,
    );
  },
});
