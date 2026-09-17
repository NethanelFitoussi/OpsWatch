import { hasLocale } from 'next-intl';
import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'fr'],
  defaultLocale: 'en',
  localePrefix: 'always',
  // The browser language is never used, and the locale cookie is managed by
  // OpsWatch itself (see locale-cookie.ts and proxy.ts).
  localeDetection: false,
  localeCookie: false,
});

export type AppLocale = (typeof routing.locales)[number];

/** A supported locale, or the default one. Use it on every locale that comes from a request. */
export function resolveLocale(value: string | undefined): AppLocale {
  return hasLocale(routing.locales, value) ? value : routing.defaultLocale;
}
