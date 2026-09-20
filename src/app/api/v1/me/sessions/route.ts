import { sessionListSchema } from '@opswatch/contract';
import { apiJson } from '@/lib/api/v1/envelope';
import { apiRoute } from '@/lib/api/v1/handler';
import { listSessions } from '@/lib/auth/sessions';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/** Every device signed in as the caller, so a lost one can be found. Bounded: nobody has a hundred sessions. */
export const GET = apiRoute({
  handler: ({ db, actor }) =>
    apiJson(sessionListSchema, {
      items: listSessions(db, actor.adminId, env().OPSWATCH_SECRET, { token: actor.token, audience: actor.audience }),
    }),
});
