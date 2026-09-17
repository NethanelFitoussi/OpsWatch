import type { NextRequest } from 'next/server';
import { resolveLocale } from '@/i18n/routing';
import { clientIp, cookieOptions } from '@/lib/auth/current';
import {
  GOOGLE_FLOW_COOKIE,
  GOOGLE_FLOW_COOKIE_PATH,
  GOOGLE_FLOW_TTL_MS,
  buildAuthorizationRequest,
  googleSignInConfig,
  sealGoogleFlow,
} from '@/lib/auth/google';
import { loginLimiter } from '@/lib/auth/login-limiter';
import { env } from '@/lib/env';
import { seeOther } from '@/lib/http/browser';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const locale = resolveLocale(request.nextUrl.searchParams.get('locale') ?? undefined);
  const config = googleSignInConfig(env());
  if (!config) {
    return seeOther(`/${locale}/login`);
  }
  if (!loginLimiter.attempt(await clientIp())) {
    return seeOther(`/${locale}/login?error=rate_limited`);
  }
  const { url, flow } = await buildAuthorizationRequest(config, locale);
  const response = seeOther(url.href);
  response.cookies.set(
    GOOGLE_FLOW_COOKIE,
    sealGoogleFlow(flow, env().OPSWATCH_SECRET),
    cookieOptions(GOOGLE_FLOW_TTL_MS / 1000, GOOGLE_FLOW_COOKIE_PATH),
  );
  return response;
}
