import 'server-only';
import { readAiConnection } from '../ai/connection';
import { googleSignInConfig } from '../auth/google';
import { listConnections } from '../connections/repository';
import type { Db } from '../db/client';
import { env } from '../env';
import { listIntegrations, listRepositories } from '../store/repositories';
import { INTEGRATIONS, INTEGRATION_SPECS, type IntegrationId, type IntegrationState } from './catalogue';

/**
 * What is actually connected, read from the instance (§E, UX-9).
 *
 * **Every state is measured, never assumed.** A settings page existing is not a connection; a stored
 * credential is not a working one. The four states keep those apart, and `not_configured` is deliberately
 * not one of the other three — an integration nobody has set up is not degraded and not unavailable.
 *
 * No secret reaches this file's output. Each entry carries a state, a short measured detail and nothing
 * else: the credential stays behind the store's one named accessor, which nothing here calls.
 */

export type IntegrationStatus = {
  id: IntegrationId;
  state: IntegrationState;
  /** A key into `Settings.integrations.detail.*`, or null when there is nothing measured to add. */
  detailKey: string | null;
  /** Values the detail sentence interpolates. Counts and names only — never a credential. */
  values: Record<string, string | number>;
  href: string | null;
};

function awsStatus(db: Db): IntegrationStatus {
  const connections = listConnections(db);
  if (connections.length === 0) return { id: 'aws', state: 'not_configured', detailKey: null, values: {}, href: '/accounts' };

  const failing = connections.filter((connection) => connection.status !== 'ok').length;
  return {
    id: 'aws',
    // An account whose permission test failed is degraded, not connected: OpsWatch cannot read it.
    state: failing > 0 ? 'degraded' : 'connected',
    detailKey: failing > 0 ? 'awsFailing' : 'awsConnected',
    values: { accounts: connections.length, failing },
    href: '/accounts',
  };
}

function githubStatus(db: Db): IntegrationStatus {
  const repositories = listRepositories(db).length;
  const integration = listIntegrations(db, 'github')[0];
  const href = INTEGRATION_SPECS.github.href;

  if (integration === undefined && repositories === 0) {
    return { id: 'github', state: 'not_configured', detailKey: null, values: {}, href };
  }
  // Repositories without a token is a real, useful state: links and mapping work, file contents do not.
  if (integration?.hasCredential !== true) {
    return { id: 'github', state: 'degraded', detailKey: 'githubNoToken', values: { repositories }, href };
  }
  return { id: 'github', state: 'connected', detailKey: 'githubConnected', values: { repositories }, href };
}

function aiStatus(db: Db): IntegrationStatus {
  const connection = readAiConnection(db);
  const href = INTEGRATION_SPECS.ai.href;
  if (connection === null) return { id: 'ai', state: 'not_configured', detailKey: null, values: {}, href };
  return {
    id: 'ai',
    // Saved but never tested is not connected. A key that failed its test is not connected either.
    state: connection.status === 'configured' ? 'connected' : 'degraded',
    detailKey: connection.status === 'configured' ? 'aiConnected' : `ai_${connection.status}`,
    values: { provider: connection.provider, model: connection.model },
    href,
  };
}

function cloudflareStatus(): IntegrationStatus {
  // Declared in the catalogue and not connectable in this build. Said on the card rather than discovered
  // by clicking a button that cannot work.
  return { id: 'cloudflare', state: 'unavailable', detailKey: 'cloudflarePlanned', values: {}, href: null };
}

function googleStatus(): IntegrationStatus {
  const config = googleSignInConfig(env());
  if (config === null) return { id: 'google', state: 'not_configured', detailKey: 'googleOff', values: {}, href: null };
  return {
    id: 'google',
    state: 'connected',
    detailKey: config.allowedDomain === undefined ? 'googleOn' : 'googleDomain',
    values: config.allowedDomain === undefined ? {} : { domain: config.allowedDomain },
    href: null,
  };
}

export function integrationStatuses(db: Db): IntegrationStatus[] {
  const byId: Record<IntegrationId, IntegrationStatus> = {
    aws: awsStatus(db),
    github: githubStatus(db),
    ai: aiStatus(db),
    cloudflare: cloudflareStatus(),
    google: googleStatus(),
  };
  return INTEGRATIONS.map((id) => byId[id]);
}
