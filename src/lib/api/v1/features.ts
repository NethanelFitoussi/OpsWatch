import 'server-only';
import { FEATURES, type Feature } from '@opswatch/contract';

/**
 * A feature flag answers one question — "can I use this here, now?" — and it has two halves: whether this build of
 * the server implements the capability at `/api/v1`, and whether the operator has turned it on. A client should not
 * have to tell "not written yet" from "switched off on this instance": in both cases it is not there, so both halves
 * are folded into one boolean.
 */

/** What this build serves. An endpoint that does not exist yet says so rather than answering 404 to a client. */
const IMPLEMENTED: Record<Feature, boolean> = {
  environments: true,
  health: false,
  brief: false,
  problems: false,
  errors: false,
  services: false,
  infrastructure: false,
  logs: false,
  alerts: false,
  incidents: false,
  synthetics: false,
  slos: false,
  deployments: false,
  investigations: false,
  repository: false,
  ai: false,
  search: false,
  favorites: false,
  // Push needs FCM/APNs credentials and an account the owner has not created. Declared false for this mission.
  push: false,
};

/** What the operator has configured. Nothing here is a guess: each field is read from the instance. */
export type OperatorState = {
  /** At least one AWS connection exists. Without one there is no environment and nothing to read. */
  hasConnection: boolean;
  /** An AI provider is configured. */
  aiConfigured: boolean;
  /** Push credentials are configured. */
  pushConfigured: boolean;
};

const ENABLED: Record<Feature, (operator: OperatorState) => boolean> = {
  environments: (o) => o.hasConnection,
  health: (o) => o.hasConnection,
  brief: (o) => o.hasConnection,
  problems: (o) => o.hasConnection,
  errors: (o) => o.hasConnection,
  services: (o) => o.hasConnection,
  infrastructure: (o) => o.hasConnection,
  logs: (o) => o.hasConnection,
  alerts: (o) => o.hasConnection,
  incidents: (o) => o.hasConnection,
  synthetics: (o) => o.hasConnection,
  slos: (o) => o.hasConnection,
  deployments: (o) => o.hasConnection,
  investigations: (o) => o.hasConnection,
  repository: (o) => o.hasConnection,
  search: (o) => o.hasConnection,
  ai: (o) => o.aiConfigured,
  push: (o) => o.pushConfigured,
  // A user's own favourites need nothing configured.
  favorites: () => true,
};

export function featureFlags(operator: OperatorState): Record<Feature, boolean> {
  return Object.fromEntries(FEATURES.map((feature) => [feature, IMPLEMENTED[feature] && ENABLED[feature](operator)])) as Record<
    Feature,
    boolean
  >;
}
