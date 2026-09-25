import { logSearchSchema } from '@opswatch/contract';
import { apiFailure, apiJson, apiNoContent } from '@/lib/api/v1/envelope';
import { resolveEnvironment } from '@/lib/api/v1/environment';
import { apiRoute } from '@/lib/api/v1/handler';
import { getLogsQueryResults, stopLogsQuery } from '@/lib/monitoring/logs';
import { failureCode } from '@/lib/monitoring/logs-route';
import { queryBindings } from '@/lib/monitoring/query-bindings';
import { resolveTarget } from '@/lib/monitoring/target';
import { toLogSearch } from '@/lib/read/logs';

export const dynamic = 'force-dynamic';

type Params = { id: string };

/**
 * Who may touch a search: the person who started it, in the environment they started it in.
 *
 * `not_found` rather than `forbidden` on a mismatch, deliberately. A caller who may not poll a search is
 * not entitled to learn that it exists — telling them apart would let one administrator enumerate
 * another's searches by their ids.
 */
function bound(environment: { connectionId: string; scope: string }, id: string, adminId: number): boolean {
  return queryBindings.matches(id, { connectionId: environment.connectionId, region: environment.scope, sessionId: `admin:${adminId}` });
}

/** Where a search has got to, and its lines once it has any. */
export const GET = apiRoute<Params>({
  handler: async ({ db, url, params, actor }) => {
    const environment = resolveEnvironment(db, url);
    if (!environment.ok) return apiFailure(environment.error);
    if (!bound(environment, params.id, actor.adminId)) return apiFailure('not_found');

    const target = await resolveTarget({ connectionId: environment.connectionId, region: environment.scope });
    if (!target.ok) return apiFailure(failureCode(target));
    const results = await getLogsQueryResults(target.data, params.id);
    if (!results.ok) return apiFailure(failureCode(results));

    // The query is AWS's to remember; OpsWatch kept only who may ask. A poll therefore reports the search
    // without restating what was searched for — the caller has it from the answer that started it.
    return apiJson(logSearchSchema, toLogSearch(params.id, null, results.data));
  },
});

/** Stops a search that is still running, so a caller that gave up stops being billed for it. */
export const DELETE = apiRoute<Params>({
  mutating: true,
  handler: async ({ db, url, params, actor }) => {
    const environment = resolveEnvironment(db, url);
    if (!environment.ok) return apiFailure(environment.error);
    if (!bound(environment, params.id, actor.adminId)) return apiFailure('not_found');

    const target = await resolveTarget({ connectionId: environment.connectionId, region: environment.scope });
    if (!target.ok) return apiFailure(failureCode(target));
    // A stop that AWS refused keeps the binding, so a retry can still find the search. The answer is 204
    // either way: the caller asked to stop polling, and it has.
    const stopped = await stopLogsQuery(target.data, params.id);
    if (stopped.ok) queryBindings.forget(params.id);
    return apiNoContent();
  },
});
