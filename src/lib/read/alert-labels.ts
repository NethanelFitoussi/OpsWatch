import 'server-only';
import { getTranslations } from 'next-intl/server';
import type { AlertLabels } from './alerts';

/**
 * Renders an alert's title and its suppression count in the caller's locale.
 *
 * The title key is the *problem's* key, so it renders through the same catalogue an insight does — an alert
 * about a problem says what the problem says, rather than restating it in different words somewhere else.
 */
export async function alertLabels(locale: string): Promise<AlertLabels> {
  const insights = await getTranslations({ locale, namespace: 'Insights' });
  const alerts = await getTranslations({ locale, namespace: 'Monitoring.alerts' });
  return {
    title: (key, values) => {
      try {
        // The stored key is `Insights.messages.x`; the namespace is already bound, so the prefix goes.
        return insights(key.replace(/^Insights\./, ''), values);
      } catch {
        return key;
      }
    },
    suppressed: (count) => alerts('suppressed', { count }),
  };
}
