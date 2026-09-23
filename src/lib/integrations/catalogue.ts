/**
 * What OpsWatch can be connected to, and what connecting each one buys (§E).
 *
 * Client-safe on purpose: the Integrations page renders this list whether or not anything is configured,
 * and a card for something nobody has set up has to say what it would do before anybody sets it up. There
 * is no credential, no status and no database access anywhere in this file — those come from the read
 * service, which is server-only.
 *
 * **Every entry declares the access it asks for.** A page that says "Connect GitHub" without saying what
 * OpsWatch will be allowed to read is asking for a decision nobody has the information to make.
 */

export const INTEGRATIONS = ['aws', 'github', 'ai', 'cloudflare', 'google'] as const;
export type IntegrationId = (typeof INTEGRATIONS)[number];

/**
 * Where an integration's credential lives, which decides where it is configured and how it is removed.
 *
 * `env` means the operator sets it in the environment and restarts; `stored` means OpsWatch keeps it,
 * encrypted, and a page can replace or delete it. The distinction is visible on the card, because
 * "disconnect" means two different things and only one of them is a button.
 */
export type CredentialHome = 'env' | 'stored' | 'aws-connection';

export type IntegrationSpec = {
  id: IntegrationId;
  /** Where the operator goes to configure it. */
  href: string;
  credentials: CredentialHome;
  /**
   * Whether this build can actually complete the connection end to end. `false` means the architecture is
   * here and something outside this repository is missing — stated on the card rather than discovered by
   * clicking a button that cannot work.
   */
  available: boolean;
};

export const INTEGRATION_SPECS: Record<IntegrationId, IntegrationSpec> = {
  aws: { id: 'aws', href: '/accounts', credentials: 'aws-connection', available: true },
  github: { id: 'github', href: '/settings/repositories', credentials: 'stored', available: true },
  ai: { id: 'ai', href: '/settings/ai', credentials: 'stored', available: true },
  cloudflare: { id: 'cloudflare', href: '/settings/cloudflare', credentials: 'stored', available: true },
  // Sign-in configuration belongs in the environment, not in a page: a login provider that could be
  // reconfigured from inside the application is a way to take the application over.
  google: { id: 'google', href: '/settings/status', credentials: 'env', available: true },
};

/** Four states, and "not configured" is not one of the other three (§2.6). */
export const INTEGRATION_STATES = ['connected', 'degraded', 'not_configured', 'unavailable'] as const;
export type IntegrationState = (typeof INTEGRATION_STATES)[number];
