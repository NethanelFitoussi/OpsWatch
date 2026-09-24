import { globalSearchResponseSchema } from '@opswatch/contract';
import { apiJson, apiFailure } from '@/lib/api/v1/envelope';
import { apiRoute } from '@/lib/api/v1/handler';
import { resolveEnvironment } from '@/lib/api/v1/environment';
import { findConnection } from '@/lib/connections/repository';
import { SEARCH_LIMIT, search } from '@/lib/read/search';
import { searchLabels } from '@/lib/read/search-labels';

export const dynamic = 'force-dynamic';

/** The longest query worth running. Beyond it somebody is pasting, not searching. */
const MAX_QUERY = 200;

/** The API is locale-aware only through this one parameter; it defaults to the product's own. */
const localeOf = (url: URL) => (url.searchParams.get('locale') === 'fr' ? 'fr' : 'en');

/**
 * `GET /api/v1/search?env=<connectionId>:<region>&q=`.
 *
 * Scoped to one environment, because a result's context is meaningless without one and because reading
 * another environment's rows on the strength of a query string would be a way around scope.
 *
 * Bounded: a short, ranked answer. Search is how a client reaches one thing, not how it enumerates them.
 */
export const GET = apiRoute({
  handler: async ({ db, url }) => {
    const environment = resolveEnvironment(db, url);
    if (!environment.ok) return apiFailure(environment.error);
    const query = (url.searchParams.get('q') ?? '').slice(0, MAX_QUERY);

    const scope = { connectionId: environment.connectionId, region: environment.scope };
    // The environment's own name, so a result reads "Problem · Production · eu-west-1" rather than
    // repeating an id the operator never chose.
    const name = findConnection(db, environment.connectionId)?.name ?? environment.connectionId;
    const labels = await searchLabels(localeOf(url), name);
    const items = search(db, scope, query, labels, SEARCH_LIMIT + 1);
    return apiJson(globalSearchResponseSchema, {
      query,
      items: items.slice(0, SEARCH_LIMIT).map(({ score: _score, terms: _terms, ...rest }) => rest),
      truncated: items.length > SEARCH_LIMIT,
    });
  },
});
