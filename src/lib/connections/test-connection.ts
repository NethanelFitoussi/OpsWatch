import 'server-only';
import type { AwsCredentialIdentity } from '@smithy/types';
import type { CredentialResolver } from '../aws/credentials';
import { awsErrorCode } from '../aws/errors';
import type { OpsWatchIdentityError } from '../aws/identity-errors';
import { runPermissionTest, type PermissionTestInput } from '../aws/permissions';
import { DecryptionError } from '../crypto';
import type { Db } from '../db/client';
import { ConnectionInputError, credentialsInputFor, getConnection, saveTestResult } from './repository';
import type { PermissionTestResult } from './types';

export async function testConnection(
  db: Db,
  id: string,
  deps: {
    secret: string;
    resolver: CredentialResolver;
    runTest?: (input: PermissionTestInput) => Promise<PermissionTestResult>;
    now?: () => Date;
  },
): Promise<PermissionTestResult> {
  const now = deps.now ?? (() => new Date());
  const runTest = deps.runTest ?? runPermissionTest;
  const row = getConnection(db, id);

  let credentials: AwsCredentialIdentity;
  try {
    credentials = await deps.resolver.resolve(credentialsInputFor(row, deps.secret), row.regions[0]);
  } catch (error) {
    const notReady = error instanceof ConnectionInputError;
    const ownError: OpsWatchIdentityError | null =
      error instanceof DecryptionError ? 'SecretChanged' : notReady ? 'NotReady' : null;
    const identityError = ownError ?? awsErrorCode(error);
    const result: PermissionTestResult = {
      overall: 'failed',
      accountMatches: false,
      identityError,
      checks: [],
      testedAt: now().toISOString(),
    };
    if (!notReady) {
      saveTestResult(db, id, result, now());
    }
    return result;
  }

  const result = await runTest({ expectedAccountId: row.awsAccountId, regions: row.regions, credentials, now });
  saveTestResult(db, id, result, now());
  return result;
}
