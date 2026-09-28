import 'server-only';
import type { ConnectionRow } from '../db/schema';
import { env } from '../env';
import type { MonitoringResult } from '../monitoring/result';
import { isValidTarget, type FederationTarget } from './federation';
import { openConnectionKey, type ConnectionKey } from './issuer';

/**
 * What a Google Cloud read needs before it can be made.
 *
 * The federation details live in five nullable columns, because a connection is created before it is
 * configured. Every caller so far turned that into `row.gcpProjectNumber ?? ''` at the call site —
 * which builds an audience of `//iam.googleapis.com/projects//locations/global/...` and sends it, so a
 * half-configured connection fails as a rejected token exchange rather than as the "not finished yet"
 * it actually is. `isValidTarget` has existed since federation was built; this is the place that uses it.
 *
 * Nothing here calls Google. A target is the *material* for a call — the same thing `resolveTarget`
 * means for AWS, where it is a set of role credentials.
 */

const ACTION = 'gcp:federation';

export type GcpTarget = {
  provider: 'gcp';
  connectionId: string;
  projectId: string;
  /** The region asked for, as a Google region — `us-central1`, matched against zone prefixes. */
  region: string;
  federation: FederationTarget;
  key: ConnectionKey;
  /** Where this instance publishes its JWK set, when the provider fetches rather than holds it. */
  baseUrl: string | undefined;
};

/**
 * The target for this row, or why there is not one.
 *
 * `NotReady` and `SecretChanged` are the same two words AWS uses for the same two situations, so the
 * connection page can say one thing about either cloud: the connection is not finished, or the secret
 * that encrypts its key is no longer the one that encrypted it.
 */
export function gcpTargetFrom(row: ConnectionRow, region: string, opts: { secret?: string; baseUrl?: string } = {}): MonitoringResult<GcpTarget> {
  if (row.provider !== 'gcp') return { ok: false, reason: 'error', code: 'ConnectionNotFound', action: ACTION };

  const federation: FederationTarget = {
    projectNumber: row.gcpProjectNumber ?? '',
    poolId: row.gcpPoolId ?? '',
    providerId: row.gcpProviderId ?? '',
    serviceAccount: row.gcpServiceAccount,
  };
  // A project id is as required as the pool is: `aggregatedList` on an empty project path is a 404,
  // and a 404 here reads as "Google is broken" rather than "this connection was never finished".
  if (row.gcpProjectId === null || row.gcpProjectId === '' || !isValidTarget(federation)) {
    return { ok: false, reason: 'error', code: 'NotReady', action: ACTION };
  }
  if (row.gcpKeyCiphertext === null) return { ok: false, reason: 'error', code: 'NotReady', action: ACTION };

  const key = openConnectionKey(row.gcpKeyCiphertext, opts.secret ?? env().OPSWATCH_SECRET);
  // The key is there and will not open: the secret changed. Distinct from having no key at all,
  // because the fix is different — restore the secret, versus finish setting the connection up.
  if (key === null) return { ok: false, reason: 'error', code: 'SecretChanged', action: ACTION };

  return {
    ok: true,
    data: {
      provider: 'gcp',
      connectionId: row.id,
      projectId: row.gcpProjectId,
      region,
      federation,
      key,
      baseUrl: opts.baseUrl ?? env().OPSWATCH_PUBLIC_URL,
    },
  };
}
