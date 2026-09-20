import { apiNoContent } from '@/lib/api/v1/envelope';
import { apiRoute } from '@/lib/api/v1/handler';
import { SESSION_COOKIE, cookieOptions } from '@/lib/auth/current';
import { deleteSession } from '@/lib/auth/sessions';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/** Revokes whichever credential was presented, and clears the cookie as well when it was the cookie. */
export const POST = apiRoute({
  mutating: true,
  handler: ({ db, actor }) => {
    deleteSession(db, actor.token, env().OPSWATCH_SECRET);
    const response = apiNoContent();
    if (actor.audience === 'web') response.cookies.set(SESSION_COOKIE, '', cookieOptions(0));
    return response;
  },
});
