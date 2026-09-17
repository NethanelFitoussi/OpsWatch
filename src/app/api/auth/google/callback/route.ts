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

/**
 * The signed-in admin's id, or why the sign-in failed. Never logs tokens or the rejected email.
 * Only called with a valid flow cookie, so every failure here followed a sign-in this browser started.
 */
async function verify(config: GoogleSignInConfig, params: URLSearchParams, flow: GoogleFlow): Promise<number | GoogleSignInError> {
  if (params.get('state') !== flow.state) return 'google_failed';
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

/** Where the browser goes next. */
async function complete(config: GoogleSignInConfig, params: URLSearchParams, flow: GoogleFlow | null, locale: string): Promise<string> {
  // Without a flow cookie this request is not part of a sign-in: failing it costs the caller nothing,
  // so it must not count toward the global login slowdown either.
  if (!flow) return `/${locale}/login?error=google_failed`;
  // A sign-in the user cancelled on Google's page is not a failed attempt.
  if (params.get('error') === 'access_denied') return `/${locale}/login?error=google_denied`;
  const outcome = await verify(config, params, flow);
  if (typeof outcome !== 'number') {
    // Like a wrong password.
    loginThrottle.recordFailure();
    return `/${locale}/login?error=${outcome}`;
  }
  loginLimiter.reset(await clientIp());
  await startSession(outcome);
  return `/${locale}/accounts`;
}

export async function GET(request: NextRequest) {
  const flow = unsealGoogleFlow(request.cookies.get(GOOGLE_FLOW_COOKIE)?.value, env().OPSWATCH_SECRET);
  const locale = flow?.locale ?? browserLocale(request);
  const config = googleSignInConfig(env());

  // Disabled: back to the login page, nothing counted.
  let location = `/${locale}/login`;
  if (config) {
    try {
      location = await complete(config, request.nextUrl.searchParams, flow, locale);
    } catch (error) {
      console.error(`[opswatch] Google sign-in could not start a session: ${error instanceof Error ? error.name : 'unknown error'}`);
      location = `/${locale}/login?error=google_failed`;
    }
  }
  const response = seeOther(location);
  // The flow is single use, whatever the outcome.
  response.cookies.set(GOOGLE_FLOW_COOKIE, '', cookieOptions(0, GOOGLE_FLOW_COOKIE_PATH));
  return response;
}
