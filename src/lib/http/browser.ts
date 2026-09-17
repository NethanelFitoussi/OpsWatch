import { LOCALE_COOKIE } from '@/i18n/locale-cookie';
import { routing, type AppLocale } from '@/i18n/routing';

/** True for a page load or link click, as opposed to a script calling the API. */
export function isBrowserNavigation(request: Request): boolean {
  return request.headers.get('sec-fetch-mode') === 'navigate' || (request.headers.get('accept') ?? '').includes('text/html');
}

export function browserLocale(request: Request): AppLocale {
  const saved = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((part) => part.trim().split('='))
    .find(([name]) => name === LOCALE_COOKIE)?.[1];
  return routing.locales.includes(saved as AppLocale) ? (saved as AppLocale) : routing.defaultLocale;
}

/** A relative Location keeps the redirect correct behind a reverse proxy. */
export function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}
