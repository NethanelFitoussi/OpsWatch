import 'server-only';
import { getTranslations } from 'next-intl/server';
import type { SearchLabels } from './search';

/**
 * The words a search result is described with, in the caller's locale.
 *
 * A headline lives in the message catalogue rather than in the row, so a problem found by search reads
 * exactly as it reads on its own page — a second wording of the same fact is a second fact to maintain.
 */
export async function searchLabels(locale: string, environment: string): Promise<SearchLabels> {
  const search = await getTranslations({ locale, namespace: 'Search' });
  const insights = await getTranslations({ locale, namespace: 'Insights' });
  const root = await getTranslations({ locale });

  return {
    kind: (kind) => search(`kinds.${kind}`),
    headline: (key, values) => {
      try {
        // A problem stores its key as `messages.x`; an alert and an incident store the same thing, and
        // some callers pass the fully-qualified `Insights.messages.x`. All three render through the one
        // catalogue, because a headline found by search must read as it reads on its own page.
        const insightKey = key.startsWith('Insights.') ? key.slice('Insights.'.length) : key;
        return insightKey.startsWith('messages.') ? insights(insightKey, values) : root(key, values);
      } catch {
        // A key with no message is shown as itself rather than swallowed: a blank row hides the bug.
        return key;
      }
    },
    severity: (severity) => insights(`severity.${severity}`),
    sectionSearch: (section) => search('inSection', { section: search(`sections.${section}`) }),
    environment,
  };
}
