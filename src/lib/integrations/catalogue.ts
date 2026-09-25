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

export const INTEGRATIONS = ['aws', 'gcp', 'do', 'github', 'ai', 'cloudflare', 'google'] as const;
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
  /**
   * Whether "add a connection" can start it.
   *
   * Google sign-in is deliberately `false`: it is configured in the environment, and presenting it beside
   * AWS and GitHub as something to connect from a page would misrepresent an authentication provider as a
   * monitoring account — and imply a button that cannot exist.
   */
  connectable: boolean;
};

export const INTEGRATION_SPECS: Record<IntegrationId, IntegrationSpec> = {
  aws: { id: 'aws', href: '/accounts/new/aws', credentials: 'aws-connection', available: true, connectable: true },
  // No credential of Google's is stored: the connection signs its own token and exchanges it, so what
  // is kept is a project number and the names of a pool and a provider, all of them public.
  gcp: { id: 'gcp', href: '/accounts/new/gcp', credentials: 'aws-connection', available: true, connectable: true },
  // A stored token, asked for with `droplet:read` rather than the read-everything alias.
  do: { id: 'do', href: '/accounts/new/do', credentials: 'aws-connection', available: true, connectable: true },
  github: { id: 'github', href: '/settings/repositories', credentials: 'stored', available: true, connectable: true },
  ai: { id: 'ai', href: '/settings/ai', credentials: 'stored', available: true, connectable: true },
  cloudflare: { id: 'cloudflare', href: '/settings/cloudflare', credentials: 'stored', available: true, connectable: true },
  // Sign-in configuration belongs in the environment, not in a page: a login provider that could be
  // reconfigured from inside the application is a way to take the application over.
  google: { id: 'google', href: '/settings/status', credentials: 'env', available: true, connectable: false },
};

/** Four states, and "not configured" is not one of the other three (§2.6). */
export const INTEGRATION_STATES = ['connected', 'degraded', 'not_configured', 'unavailable'] as const;
export type IntegrationState = (typeof INTEGRATION_STATES)[number];
