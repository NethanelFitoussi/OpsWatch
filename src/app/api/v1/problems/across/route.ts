import { problemsAcrossSchema } from '@opswatch/contract';
import { apiFailure, apiJson } from '@/lib/api/v1/envelope';
import { apiRoute } from '@/lib/api/v1/handler';
import { PROVIDERS, type Provider } from '@/lib/connections/types';
import { readProblemsAcross } from '@/lib/read/across';
import { insightRenderer } from '@/lib/read/render';

export const dynamic = 'force-dynamic';

/**
 * `GET /api/v1/problems/across?provider=` — what is wrong anywhere (§G).
 *
 * **Not scoped to an environment**, and that is the whole point of it. `/problems` answers "what is
 * wrong here", where *here* was already chosen; a client with three AWS accounts and a Google project
 * has to know where to look before it can ask, so its answer depends on where it started.
 *
 * Every row carries the cloud that produced the evidence, the connection and that connection's scope,
 * because a unified list that dropped them would be a list nobody could act on. Read from rows the
 * collector already wrote, so it costs no provider request.
 */
export const GET = apiRoute({
  handler: async ({ db, url, actor }) => {
    const asked = url.searchParams.get('provider');
    // A provider that is not one is a stated `invalid_request`, never a silently unfiltered answer:
    // a client that misspells it must not be handed everything as though it had asked for everything.
    if (asked !== null && !(PROVIDERS as readonly string[]).includes(asked)) return apiFailure('invalid_request');

    const answer = readProblemsAcross(
      db,
      asked === null ? {} : { providers: [asked as Provider] },
      { nowMs: Date.now(), render: await insightRenderer(actor.locale) },
    );
    return apiJson(problemsAcrossSchema, answer);
  },
});
