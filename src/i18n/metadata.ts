import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { resolveLocale } from './routing';

/**
 * `generateMetadata` for a page whose title is one message, shown through the layout's title template.
 * It runs independently of the page's session check, so it must only read messages.
 */
export function localizedTitle(key: string) {
  return async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
    const t = await getTranslations({ locale: resolveLocale((await params).locale) });
    return { title: t(key) };
  };
}
