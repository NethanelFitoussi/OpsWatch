import { logSourceListSchema } from '@opswatch/contract';
import { apiFailure, apiJson } from '@/lib/api/v1/envelope';
import { resolveEnvironment } from '@/lib/api/v1/environment';
import { apiRoute } from '@/lib/api/v1/handler';
import { LOG_GROUP_SEARCH_LIMIT, searchLogGroups } from '@/lib/monitoring/logs';
import { toLogSource } from '@/lib/read/logs';
import { resolveTarget } from '@/lib/monitoring/target';
import { failureCode } from '@/lib/monitoring/logs-route';

export const dynamic = 'force-dynamic';

/** The log groups one environment holds, so a client knows what it may search before it searches. */
export const GET = apiRoute({
  handler: async ({ db, url }) => {
    const environment = resolveEnvironment(db, url);
    if (!environment.ok) return apiFailure(environment.error);

    const target = await resolveTarget({ connectionId: environment.connectionId, region: environment.scope });
    if (!target.ok) return apiFailure(failureCode(target));
    // `?q=` is passed to AWS as a name pattern; without it the region's first page comes back.
    const search = (url.searchParams.get('q') ?? '').trim().slice(0, 512);
    const groups = await searchLogGroups(target.data, search);
    if (!groups.ok) return apiFailure(failureCode(groups));

    return apiJson(logSourceListSchema, {
      items: groups.data.map(toLogSource),
      // Said rather than hidden: a list that quietly stopped at a limit reads as the whole estate.
      truncated: groups.data.length === LOG_GROUP_SEARCH_LIMIT,
    });
  },
});
