import 'server-only';
import { getTranslations } from 'next-intl/server';
import type { HealthLabels } from './health';

/** The catalogue keys Health renders through, bound to one locale. Kept beside the read service, not in it. */
const UNAVAILABLE_REASONS = new Set(['denied', 'throttled', 'timeout']);

export async function healthLabels(locale: string): Promise<HealthLabels> {
  const t = await getTranslations({ locale, namespace: 'Monitoring.health' });
  return {
    family: (family) => {
      try {
        return t(`family.${family}`);
      } catch {
        return family;
      }
    },
    unavailable: (reason, values) => {
      // A reason the catalogue does not know still gets a sentence, rather than showing a bare token.
      const known = UNAVAILABLE_REASONS.has(reason) ? reason : 'unknown';
      const messageKey = `Monitoring.health.unavailable.${known}`;
      return { messageKey, message: t(`unavailable.${known}`, values) };
    },
    change: (kind, values) => {
      try {
        return t(`change.${kind}`, values);
      } catch {
        return kind;
      }
    },
  };
}
