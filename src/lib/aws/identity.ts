import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { clientConfig, type AwsCredentials } from './client-config';

export type CallerIdentity = { account: string; arn: string };
export type TrustSpec = { principal: string; principalArnPattern?: string };

const BASE_IDENTITY_TTL_MS = 5 * 60_000;
let baseIdentityCache: { identity: CallerIdentity; fetchedAt: number } | undefined;

export async function getCallerIdentity(
  credentials: AwsCredentials | undefined,
  region: string,
): Promise<CallerIdentity> {
  const client = new STSClient(clientConfig(region, credentials));
  const out = await client.send(new GetCallerIdentityCommand({}));
  if (!out.Account || !out.Arn) {
    throw new Error('GetCallerIdentity returned no account or ARN');
  }
  return { account: out.Account, arn: out.Arn };
}

/** Identity of the OpsWatch instance itself (standard AWS provider chain). */
export async function detectBaseIdentity(region: string, now: number = Date.now()): Promise<CallerIdentity> {
  if (baseIdentityCache && now - baseIdentityCache.fetchedAt < BASE_IDENTITY_TTL_MS) {
    return baseIdentityCache.identity;
  }
  const identity = await getCallerIdentity(undefined, region);
  baseIdentityCache = { identity, fetchedAt: now };
  return identity;
}

export function resetBaseIdentityCache(): void {
  baseIdentityCache = undefined;
}

export function trustFor(identity: CallerIdentity): TrustSpec {
  const partition = identity.arn.split(':')[1] ?? 'aws';
  const root = `arn:${partition}:iam::${identity.account}:root`;

  if (/^arn:[\w-]+:iam::\d{12}:user\//.test(identity.arn)) {
    return { principal: identity.arn };
  }

  const assumed = identity.arn.match(/^arn:[\w-]+:sts::(\d{12}):assumed-role\/([^/]+)\/[^/]+$/);
  if (assumed) {
    const [, account, roleName] = assumed;
    // An assumed-role session ARN hides the role path, so trust the account and
    // restrict the caller to roles with that name, whatever their path.
    return {
      principal: root,
      principalArnPattern: `arn:${partition}:iam::${account}:role/*${roleName}`,
    };
  }

  return { principal: root };
}
