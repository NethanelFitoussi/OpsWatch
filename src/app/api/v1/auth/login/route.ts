import { authSessionSchema, loginRequestSchema } from '@opswatch/contract';
import { apiFailure, apiJson } from '@/lib/api/v1/envelope';
import { publicApiRoute } from '@/lib/api/v1/handler';
import { findAdmin } from '@/lib/auth/admin';
import { clientIp } from '@/lib/auth/current';
import { attemptLogin } from '@/lib/auth/login';
import { API_SESSION_TTL_MS, createSession } from '@/lib/auth/sessions';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/** How long a client should wait after being refused. The per-client budget is five attempts a minute. */
const RETRY_AFTER_SECONDS = 60;

/**
 * The bearer-token door. It shares the web form's throttle and its slowdown through `attemptLogin`, so trying the
 * API after the form is not a way around either, and it mints an `api` token — never the browser's cookie.
 */
export const POST = publicApiRoute({
  mutating: true,
  handler: async ({ request, db }) => {
    const parsed = loginRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiFailure('invalid_request');
    const outcome = await attemptLogin({ ...parsed.data, ip: await clientIp() });
    if (!outcome.ok) {
      return outcome.reason === 'rate_limited'
        ? apiFailure('rate_limited', { retryAfterSeconds: RETRY_AFTER_SECONDS })
        : apiFailure('invalid_credentials');
    }
    const admin = findAdmin(db);
    if (!admin) return apiFailure('unauthorized');
    const now = new Date();
    const token = createSession(db, outcome.adminId, env().OPSWATCH_SECRET, now, 'api');
    return apiJson(authSessionSchema, {
      token,
      expiresAt: now.getTime() + API_SESSION_TTL_MS,
      user: { email: admin.email },
    });
  },
});
