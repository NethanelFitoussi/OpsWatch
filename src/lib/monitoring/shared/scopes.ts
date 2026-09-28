import type { Provider } from '../../connections/types';

/**
 * What a "scope" is, per cloud.
 *
 * Every collected row is keyed by `(connectionId, scope)`, and `scope` has meant "AWS region" since
 * there was only AWS. It is the unit the provider's data is actually scoped to, and that is not a
 * region everywhere:
 *
 *   - **AWS**: a region. Two regions of one account are two estates with two sets of everything.
 *   - **Google Cloud**: a **project**. `alertPolicies` and `alerts` are project-scoped and a project
 *     spans regions, so collecting a two-region project once per region would open the same incident
 *     twice, under two scopes, as two OpsWatch problems — and resolve neither when Google closed it.
 *   - **DigitalOcean**: the **account**. `/v2/droplets` and the metrics endpoints answer for all of
 *     it at once; each droplet carries its own region.
 *
 * So the region list an operator chose is an AWS answer to an AWS question, and this is the place
 * that stops it being applied to clouds where it is the wrong question. Client-safe and importing
 * nothing but a type: the collector, System status and the read layer all need it.
 */

/** What one scope stands for, for a page that has to name it. */
export const SCOPE_KINDS = { aws: 'region', gcp: 'project', do: 'account' } as const;
export type ScopeKind = (typeof SCOPE_KINDS)[Provider];

export const scopeKindOf = (provider: Provider): ScopeKind => SCOPE_KINDS[provider];

/** The fields a scope is derived from. A subset of a connection row, so the leaf stays a leaf. */
export type ScopeSource = { provider: Provider; regions: readonly string[]; gcpProjectId: string | null };

/**
 * Every scope this connection is collected under.
 *
 * Empty is a real answer and the caller must handle it: a connection with nothing identifiable to
 * collect under is not collected, which is better than collecting it under an empty string and
 * writing rows nothing can ever find again.
 */
export function scopesOf(connection: ScopeSource): readonly string[] {
  switch (connection.provider) {
    case 'aws':
      return connection.regions;
    case 'gcp':
      // The project id, because that is what Google scoped the data to and what an operator would
      // recognise. A connection whose project is not set yet has nothing to collect under.
      return connection.gcpProjectId === null || connection.gcpProjectId === '' ? [] : [connection.gcpProjectId];
    case 'do':
      // One scope for the account. Named rather than empty so the rows have somewhere to live, and
      // constant rather than the token, which must never become a database key.
      return [DO_ACCOUNT_SCOPE];
  }
}

/** The single scope a DigitalOcean account is collected under. Not derived from anything secret. */
export const DO_ACCOUNT_SCOPE = 'account';
