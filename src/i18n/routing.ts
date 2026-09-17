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
