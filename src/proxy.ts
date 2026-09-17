import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { LOCALE_COOKIE } from './i18n/locale-cookie';
import { routing, type AppLocale } from './i18n/routing';

const intl = createMiddleware(routing);

function isAppLocale(value: string | undefined): value is AppLocale {
  return routing.locales.includes(value as AppLocale);
}

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/') {
    const saved = request.cookies.get(LOCALE_COOKIE)?.value;
    const locale = isAppLocale(saved) ? saved : routing.defaultLocale;
    return NextResponse.redirect(new URL(`/${locale}`, request.url));
  }
  return intl(request);
}

export const config = {
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};
