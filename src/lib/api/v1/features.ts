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
  // GET /health answers from the snapshots the detect job writes.
  health: true,
  // GET /brief reads the events spine the collector writes.
  brief: true,
  // GET /problems and /problems/{id} serve real rows the collector wrote.
  problems: true,
  // GET /errors and /errors/{id} serve the groups the errors job collects.
  errors: true,
  services: false,
  infrastructure: false,
  logs: false,
  // GET /alerts serves the rows the detect cycle raises (§15). In-app only: nothing leaves the instance.
  alerts: true,
  // GET /incidents and /incidents/{id} serve the rows the detect cycle opens (§16).
  incidents: true,
  // GET /synthetics serves the checks this host runs and what they saw (§14).
  synthetics: true,
  // GET /slos measures the objectives an operator defined against stored history (§19).
  slos: true,
  // GET /deployments and /deployments/{id} serve the rows the deployments job records (DEP-1, DEP-3).
  deployments: true,
  // GET /reports summarises the rows the collector already wrote, and names the halves it cannot answer.
  reports: true,
  // GET /checkup runs the catalogue over what is already stored, and says what it could not check.
  checkup: true,
  investigations: false,
  repository: false,
  // `POST /ai/ask` answers from the evidence the deterministic engine already computed (AI-4, AI-5).
  // Still gated by `aiConfigured`, which is a tested connection rather than a stored key.
  ai: true,
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
  reports: (o) => o.hasConnection,
  checkup: (o) => o.hasConnection,
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
