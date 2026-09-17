import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { LOCALE_COOKIE } from './i18n/locale-cookie';
import { resolveLocale, routing } from './i18n/routing';

const intl = createMiddleware(routing);

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/') {
    const locale = resolveLocale(request.cookies.get(LOCALE_COOKIE)?.value);
    return NextResponse.redirect(new URL(`/${locale}`, request.url));
  }
  return intl(request);
}

export const config = {
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};
