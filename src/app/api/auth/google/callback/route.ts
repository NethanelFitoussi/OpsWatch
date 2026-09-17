import type { NextRequest } from 'next/server';
import { findAdmin } from '@/lib/auth/admin';
import { clientIp, cookieOptions, startSession } from '@/lib/auth/current';
import {
  GOOGLE_FLOW_COOKIE,
  GOOGLE_FLOW_COOKIE_PATH,
  completeAuthorization,
  googleSignInConfig,
  isAllowedGoogleAccount,
  unsealGoogleFlow,
  type GoogleFlow,
  type GoogleSignInConfig,
  type GoogleSignInError,
} from '@/lib/auth/google';
import { loginLimiter, loginThrottle } from '@/lib/auth/login-limiter';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';
import { browserLocale, seeOther } from '@/lib/http/browser';

export const dynamic = 'force-dynamic';

/** The signed-in admin's id, or why the sign-in failed. Never logs tokens or the rejected email. */
async function verify(config: GoogleSignInConfig | null, params: URLSearchParams, flow: GoogleFlow | null): Promise<number | GoogleSignInError> {
  if (params.get('error') === 'access_denied') return 'google_denied';
  if (!config || !flow || params.get('state') !== flow.state) return 'google_failed';
  let claims;
  try {
    claims = await completeAuthorization(config, params, flow);
  } catch (error) {
    console.warn(`[opswatch] Google sign-in failed: ${error instanceof Error ? error.name : 'unknown error'}`);
    return 'google_failed';
  }
  const admin = findAdmin(getDb());
  if (!admin || !isAllowedGoogleAccount(claims, admin.email, config.allowedDomain)) {
    console.warn('[opswatch] Google sign-in refused: the Google account is not the admin account');
    return 'google_not_allowed';
  }
  return admin.id;
}

export async function GET(request: NextRequest) {
  const flow = unsealGoogleFlow(request.cookies.get(GOOGLE_FLOW_COOKIE)?.value, env().OPSWATCH_SECRET);
  const locale = flow?.locale ?? browserLocale(request);
  const outcome = await verify(googleSignInConfig(env()), request.nextUrl.searchParams, flow);

  let response;
  if (typeof outcome === 'number') {
    loginLimiter.reset(await clientIp());
    await startSession(outcome);
    response = seeOther(`/${locale}/accounts`);
  } else {
    // Like a wrong password; a sign-in the user cancelled on Google's page is not a failed attempt.
    if (outcome !== 'google_denied') loginThrottle.recordFailure();
    response = seeOther(`/${locale}/login?error=${outcome}`);
  }
  // The flow is single use, whatever the outcome.
  response.cookies.set(GOOGLE_FLOW_COOKIE, '', cookieOptions(0, GOOGLE_FLOW_COOKIE_PATH));
  return response;
}
