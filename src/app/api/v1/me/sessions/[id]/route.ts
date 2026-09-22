import { apiFailure, apiNoContent } from '@/lib/api/v1/envelope';
import { apiRoute } from '@/lib/api/v1/handler';
import { revokeSession } from '@/lib/auth/sessions';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Cuts one device off. Only the caller's own sessions can be named here, and revoking one leaves every other
 * session and `OPSWATCH_SECRET` untouched — which is the whole point of listing them individually.
 */
export const DELETE = apiRoute<{ id: string }>({
  mutating: true,
  handler: ({ db, actor, params }) =>
    revokeSession(db, actor.adminId, params.id, env().OPSWATCH_SECRET) ? apiNoContent() : apiFailure('not_found'),
});
