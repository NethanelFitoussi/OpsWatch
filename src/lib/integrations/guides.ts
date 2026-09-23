/**
 * Which integrations have a guide, and where it lives.
 *
 * Client-safe, and deliberately separate from the catalogue: an integration can be connectable without a
 * guide having been written for it, and a guide can exist for something not yet connectable. Keeping the
 * two lists apart means neither can silently promise the other.
 */
import { INTEGRATION_SPECS, type IntegrationId } from './catalogue';

export const GUIDED = ['aws', 'github', 'cloudflare', 'ai'] as const satisfies readonly IntegrationId[];
export type GuidedIntegration = (typeof GUIDED)[number];

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
