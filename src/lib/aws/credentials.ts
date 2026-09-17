import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import type { AwsCredentialIdentity, AwsCredentialIdentityProvider } from '@smithy/types';
import { baseCredentials } from './base-credentials';
import { clientConfig } from './client-config';
import { awsErrorCode } from './errors';
import { AWS_CALL_TIMEOUT_MS, withTimeout } from './timeout';

export type CredentialsInput =
  | { method: 'role'; connectionId: string; roleArn: string; externalId: string }
  | { method: 'ambient' }
  | { method: 'keys'; accessKeyId: string; secretAccessKey: string };

export const ASSUME_ROLE_DURATION_SECONDS = 3600;
export const REFRESH_WINDOW_MS = 5 * 60_000;

export type AssumeRoleEvent = { event: 'assume_role'; connectionId: string; ok: boolean; errorCode?: string };

export type CredentialResolver = {
  resolve(input: CredentialsInput, region: string): Promise<AwsCredentialIdentity>;
  forget(connectionId: string): void;
};

export function createCredentialResolver(
  deps: {
    now?: () => number;
    ambientProvider?: AwsCredentialIdentityProvider;
    log?: (event: AssumeRoleEvent) => void;
    timeoutMs?: number;
  } = {},
): CredentialResolver {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((event: AssumeRoleEvent) => console.info(JSON.stringify(event)));
  const ambient = deps.ambientProvider ?? baseCredentials();
  const timeoutMs = deps.timeoutMs ?? AWS_CALL_TIMEOUT_MS;
  const cache = new Map<string, AwsCredentialIdentity>();

  async function assumeRole(
    input: Extract<CredentialsInput, { method: 'role' }>,
    region: string,
  ): Promise<AwsCredentialIdentity> {
    const key = `${input.connectionId}|${input.roleArn}|${input.externalId}`;
    const cached = cache.get(key);
    if (cached?.expiration && cached.expiration.getTime() - now() > REFRESH_WINDOW_MS) {
      return cached;
    }

    const sts = new STSClient(clientConfig(region, ambient));
    try {
      const out = await withTimeout(
        (abortSignal) =>
          sts.send(
            new AssumeRoleCommand({
              RoleArn: input.roleArn,
              ExternalId: input.externalId,
              RoleSessionName: `opswatch-${input.connectionId}`,
              DurationSeconds: ASSUME_ROLE_DURATION_SECONDS,
            }),
            { abortSignal },
          ),
        timeoutMs,
      );
      const c = out.Credentials;
      if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken || !c.Expiration) {
        throw Object.assign(new Error('AssumeRole returned incomplete credentials'), { name: 'IncompleteCredentials' });
      }
      const credentials: AwsCredentialIdentity = {
        accessKeyId: c.AccessKeyId,
        secretAccessKey: c.SecretAccessKey,
        sessionToken: c.SessionToken,
        expiration: c.Expiration,
      };
      cache.set(key, credentials);
      log({ event: 'assume_role', connectionId: input.connectionId, ok: true });
      return credentials;
    } catch (error) {
      log({ event: 'assume_role', connectionId: input.connectionId, ok: false, errorCode: awsErrorCode(error) });
      throw error;
    }
  }

  return {
    async resolve(input, region) {
      switch (input.method) {
        case 'keys':
          return { accessKeyId: input.accessKeyId, secretAccessKey: input.secretAccessKey };
        case 'ambient':
          return ambient();
        case 'role':
          return assumeRole(input, region);
      }
    },
    forget(connectionId) {
      for (const key of [...cache.keys()]) {
        if (key.startsWith(`${connectionId}|`)) {
          cache.delete(key);
        }
      }
    },
  };
}
