import 'server-only';
import { getTranslations } from 'next-intl/server';
import { formatInsightValues } from '../monitoring/insights';
import { expandValues } from './message-values';
import type { Render } from './problems';

/**
 * Turns a stored catalogue key and its values into a sentence, in one locale.
 *
 * The read services are locale-free on purpose: only the caller knows who is asking — a page knows the
 * request's locale, and `/api/v1` resolves it from `?locale=` or `Accept-Language`. So they take this, and
 * the catalogue stays the single one the Insights page already renders, at EN/FR parity (§24).
 *
 * The keys the detectors store are the rules' own — `messages.ecs_cpu_high`, `groups.ecs_cpu_high` — which
 * live under the `Insights` namespace, and whose numeric values are formatted with their units first.
 */
export async function insightRenderer(locale: string): Promise<Render> {
  const t = await getTranslations({ locale, namespace: 'Insights' });
  const root = await getTranslations({ locale });
  // A detector stores ids where a sentence needs words — it has no locale of its own. They become words
  // here, so the same stored problem reads as English or as French depending only on who is looking.
  // `has` rather than try/catch: next-intl does not throw for a missing message, it returns the key
  // path — so catching nothing would have put `Monitoring.alarms.kinds.…` inside the sentence.
  const lookup = (key: string) => (root.has(key) ? root(key) : null);
  return (key, values) => {
    try {
      return t(key, formatInsightValues(key, expandValues(values, lookup), locale));
    } catch {
      // A key the catalogue does not hold must not take the page down with it. The key itself is the most
      // useful thing left to show, and it is never a secret.
      return key;
    }
  };
}
