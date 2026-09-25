import 'server-only';
import { getTranslations } from 'next-intl/server';
import { expandValues } from './message-values';
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
  const root = await getTranslations({ locale });
  // `has` rather than try/catch: next-intl does not throw for a missing message, it returns the key
  // path — so catching nothing would have put `Monitoring.alarms.kinds.…` inside the sentence.
  const lookup = (key: string) => (root.has(key) ? root(key) : null);
  return {
    title: (key, values) => {
      // The ids the detector stored become words here, in this reader's language.
      const expanded = expandValues(values, lookup);
      // `has` rather than a try/catch, because next-intl does not throw for a missing message — it
      // returns the key path, and the catch below never ran. An alert whose title key was not under
      // `Insights` rendered as `Hosts.findings.disk_full` on the page, which is a message key in front
      // of an operator: the one thing §T says may never happen.
      const inside = key.replace(/^Insights\./, '');
      if (insights.has(inside)) return insights(inside, expanded);
      if (root.has(key)) return root(key, expanded);
      // Nothing to render it with. The key is not a sentence, so it is not shown as one.
      return alerts('untitled');
    },
    suppressed: (count) => alerts('suppressed', { count }),
  };
}
