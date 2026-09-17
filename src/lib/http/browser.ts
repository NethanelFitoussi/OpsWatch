import type { NextRequest } from 'next/server';
import { LOCALE_COOKIE } from '@/i18n/locale-cookie';
import { resolveLocale, type AppLocale } from '@/i18n/routing';

/** True for a page load or link click, as opposed to a script calling the API. */
export function isBrowserNavigation(request: Request): boolean {
  return request.headers.get('sec-fetch-mode') === 'navigate' || (request.headers.get('accept') ?? '').includes('text/html');
}

export function browserLocale(request: NextRequest): AppLocale {
  return resolveLocale(request.cookies.get(LOCALE_COOKIE)?.value);
}

/** A relative Location keeps the redirect correct behind a reverse proxy. */
export function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}
