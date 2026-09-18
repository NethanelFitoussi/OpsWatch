/**
 * Minimal typed i18n, English and French like the web app. `en.ts` is the source of truth; `fr.ts` must define
 * exactly the same keys (a missing key is a type error). Placeholders use `{name}`.
 */
import { getLocales } from 'expo-localization';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { en, type MessageKey } from './en';
import { fr } from './fr';

export type Locale = 'en' | 'fr';
export type Params = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: Params) => string;

const CATALOGS: Record<Locale, Record<MessageKey, string>> = { en, fr };

export function detectLocale(): Locale {
  try {
    const code = getLocales()[0]?.languageCode?.toLowerCase();
    return code === 'fr' ? 'fr' : 'en';
  } catch {
    return 'en';
  }
}

export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  const template = CATALOGS[locale][key] ?? en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

type I18n = { locale: Locale; t: Translate };
const I18nContext = createContext<I18n>({ locale: 'en', t: (key, params) => translate('en', key, params) });

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<I18n>(() => ({ locale, t: (key, params) => translate(locale, key, params) }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}

export type { MessageKey };
