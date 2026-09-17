import 'server-only';
import type { CredentialResolver } from '../aws/credentials';
import { ConnectionInputError, credentialsInputFor, findConnection } from '../connections/repository';
import { credentialResolver } from '../connections/resolver';
import { DecryptionError } from '../crypto';
import { getDb, type Db } from '../db/client';
import { env } from '../env';
import type { AwsTarget, MonitoringScope } from './call';
import { toFailure, type MonitoringResult } from './result';

export const ASSUME_ROLE_ACTION = 'sts:AssumeRole';

export type TargetDeps = { db?: Db; secret?: string; resolver?: CredentialResolver };

/** Called inside each card (never before the page shell): AssumeRole can take up to 5 s. The resolver caches role credentials. */
export async function resolveTarget(scope: MonitoringScope, deps: TargetDeps = {}): Promise<MonitoringResult<AwsTarget>> {
  const db = deps.db ?? getDb();
  const row = findConnection(db, scope.connectionId);
  if (!row) return { ok: false, reason: 'error', code: 'ConnectionNotFound', action: ASSUME_ROLE_ACTION };
  try {
    const input = credentialsInputFor(row, deps.secret ?? env().OPSWATCH_SECRET);
    const credentials = await (deps.resolver ?? credentialResolver).resolve(input, scope.region);
    return { ok: true, data: { connectionId: scope.connectionId, region: scope.region, credentials } };
  } catch (error) {
    if (error instanceof ConnectionInputError) return { ok: false, reason: 'error', code: 'NotReady', action: ASSUME_ROLE_ACTION };
    if (error instanceof DecryptionError) return { ok: false, reason: 'error', code: 'SecretChanged', action: ASSUME_ROLE_ACTION };
    return toFailure(ASSUME_ROLE_ACTION, error);
  }
}
