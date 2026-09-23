import 'server-only';
import { getTranslations } from 'next-intl/server';
import type { IncidentLabels } from './incidents';

/**
 * Renders an incident's title and its timeline in the caller's locale.
 *
 * The stored `titleKey` is a full key like `Incidents.title.multiple_critical`, so this binds the root
 * namespace and looks the whole key up — the collector writes a key, never a sentence, which is what keeps
 * English and French saying the same thing.
 */
export async function incidentLabels(locale: string): Promise<IncidentLabels> {
  const t = await getTranslations({ locale });
  return {
    title: (key, values) => {
      try {
        return t(key, values);
      } catch {
        // A key the catalogue does not know still renders as something, rather than throwing a page away.
        return key;
      }
    },
  };
}
