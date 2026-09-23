import 'server-only';
import { getTranslations } from 'next-intl/server';
import type { InvestigationLabels } from './investigation';

/**
 * Renders the investigation's three bands in the caller's locale.
 *
 * Every line is a message key with placeholders — never a sentence the server assembled — so both languages
 * say the same thing, and neither can drift into the word "because" without somebody editing a message file
 * and noticing what they are doing.
 */
export async function investigationLabels(locale: string): Promise<InvestigationLabels> {
  const t = await getTranslations({ locale, namespace: 'Monitoring.investigation' });
  const or = (key: string, fallback: string, values?: Record<string, string | number>) => {
    try {
      return t(key, values);
    } catch {
      // An event kind the catalogue does not know still gets a sentence, rather than showing a bare token.
      return fallback;
    }
  };

  return {
    fact: (type, values) => or(`fact.${type}`, t('fact.unknown'), values),
    correlation: ({ minutes, relation }) => t('pair', { minutes, relation: or(`relation.${relation}`, relation) }),
    hypothesis: (id) => or(`hypothesis.${id}`, id),
    confirmedBy: (key) => or(`confirm.${key}`, ''),
    notEvaluated: (ids) => t('notEvaluated', { count: ids.length }),
  };
}
