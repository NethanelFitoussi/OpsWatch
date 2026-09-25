/**
 * Which integrations have a guide, and where it lives.
 *
 * Client-safe, and deliberately separate from the catalogue: an integration can be connectable without a
 * guide having been written for it, and a guide can exist for something not yet connectable. Keeping the
 * two lists apart means neither can silently promise the other.
 */
import { INTEGRATION_SPECS, type IntegrationId } from './catalogue';

export const GUIDED = ['aws', 'gcp', 'github', 'cloudflare', 'ai'] as const satisfies readonly IntegrationId[];
export type GuidedIntegration = (typeof GUIDED)[number];

/**
 * The steps and failures each guide walks through, as data rather than as a constant in a page.
 *
 * `IntegrationGuideBody` builds its message keys from these at render, which put them out of reach of
 * the guard that checks literal `t('…')` lookups — and a guide missing one renders the key path itself
 * onto the page. It happened: a new guide spelled two of them differently and printed
 * `GettingStarted.gcp.permissions.guaranteeTitle` to a reader. Here, `getting-started-guides.test.ts`
 * can see them and check every key of every guide in both languages.
 */
export const GUIDE_CHAPTERS: Record<GuidedIntegration, { steps: readonly string[]; failures: readonly string[] }> = {
  aws: { steps: [], failures: [] },
  gcp: {
    steps: ['name', 'keys', 'pool', 'grant', 'verify'],
    failures: ['exchange', 'impersonation', 'denied', 'noPublicUrl', 'unreachable'],
  },
  github: {
    steps: ['token', 'store', 'verify', 'discover', 'map'],
    failures: ['unauthorized', 'forbidden', 'rateLimited', 'noRepositories', 'wrongBranch'],
  },
  cloudflare: {
    steps: ['token', 'store', 'verify', 'discover', 'choose'],
    failures: ['unauthorized', 'forbidden', 'rateLimited', 'noZones', 'nothingAppears'],
  },
  ai: {
    steps: ['choose', 'key', 'store', 'test', 'ask'],
    failures: ['unauthorized', 'rateLimited', 'refusedEndpoint', 'noEvidence', 'timeout'],
  },
};

export function guidePath(id: GuidedIntegration): string {
  return `/getting-started/${id}`;
}

export function hasGuide(id: IntegrationId): id is GuidedIntegration {
  return (GUIDED as readonly string[]).includes(id);
}

/** Where a guide sends somebody who is ready to act: the flow that already configures that provider. */
export function setupPath(id: GuidedIntegration): string {
  return INTEGRATION_SPECS[id].href;
}
