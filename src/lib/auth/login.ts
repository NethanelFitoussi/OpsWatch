import 'server-only';
import type { Db } from '../db/client';
import { getDb } from '../db/client';
import { authenticate } from './admin';
import { loginLimiter, loginThrottle } from './login-limiter';
import type { LoginThrottle } from './login-throttle';
import type { RateLimiter } from './rate-limit';

export type LoginOutcome = { ok: true; adminId: number } | { ok: false; reason: 'invalid_credentials' | 'rate_limited' };

export type LoginDeps = { db: Db; limiter: RateLimiter; throttle: LoginThrottle };

/**
 * One sign-in attempt, with both defences the web form has always had: the per-client budget and the global
 * slowdown. The login form and `POST /api/v1/auth/login` both call this, so a client that is refused in the browser
 * cannot simply try the API instead — it is the same limiter and the same throttle, in one process.
 *
 * It only decides whether the password was right. Starting the session is the caller's job, because a browser gets a
 * cookie and an API client gets a bearer token.
 */
export async function attemptLogin(
  input: { email: string; password: string; ip: string },
  deps: LoginDeps = { db: getDb(), limiter: loginLimiter, throttle: loginThrottle },
): Promise<LoginOutcome> {
  if (!deps.limiter.attempt(input.ip)) {
    return { ok: false, reason: 'rate_limited' };
  }
  const outcome = await deps.throttle.run(() => authenticate(deps.db, input.email, input.password));
  if (outcome.limited) {
    return { ok: false, reason: 'rate_limited' };
  }
  if (outcome.value === null) {
    deps.throttle.recordFailure();
    return { ok: false, reason: 'invalid_credentials' };
  }
  deps.limiter.reset(input.ip);
  return { ok: true, adminId: outcome.value };
}
