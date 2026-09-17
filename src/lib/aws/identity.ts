import 'server-only';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { baseCredentials } from './base-credentials';
import { clientConfig, type AwsCredentials } from './client-config';
import { awsErrorCode } from './errors';
import { AWS_CALL_TIMEOUT_MS, sendWithTimeout } from './timeout';

export type CallerIdentity = { account: string; arn: string };
/** An identity, or the AWS error name explaining why there is none. */
export type IdentityLookup = { identity: CallerIdentity; errorCode?: never } | { identity: null; errorCode: string };
export type TrustSpec = { principal: string; principalArnPatterns?: string[] };

const BASE_IDENTITY_TTL_MS = 5 * 60_000;
const BASE_IDENTITY_FAILURE_TTL_MS = 30_000;
let baseIdentityCache:
  | { ok: true; identity: CallerIdentity; fetchedAt: number }
  | { ok: false; error: unknown; fetchedAt: number }
  | undefined;

export async function getCallerIdentity(
  credentials: AwsCredentials | undefined,
  region: string,
  timeoutMs: number = AWS_CALL_TIMEOUT_MS,
): Promise<CallerIdentity> {
  const out = await sendWithTimeout(new STSClient(clientConfig(region, credentials)), new GetCallerIdentityCommand({}), timeoutMs);
  if (!out.Account || !out.Arn) {
    throw new Error('GetCallerIdentity returned no account or ARN');
  }
  return { account: out.Account, arn: out.Arn };
}

/**
 * Identity of the OpsWatch instance itself (see base-credentials.ts). A success is cached for
 * 5 minutes and a failure for 30 seconds, so pages do not wait on AWS at every render.
 */
export async function detectBaseIdentity(region: string, now: number = Date.now()): Promise<CallerIdentity> {
  const cached = baseIdentityCache;
  if (cached && now - cached.fetchedAt < (cached.ok ? BASE_IDENTITY_TTL_MS : BASE_IDENTITY_FAILURE_TTL_MS)) {
    if (cached.ok) return cached.identity;
    throw cached.error;
  }
  try {
    const identity = await getCallerIdentity(baseCredentials(), region);
    baseIdentityCache = { ok: true, identity, fetchedAt: now };
    return identity;
  } catch (error) {
    baseIdentityCache = { ok: false, error, fetchedAt: now };
    throw error;
  }
}

async function lookUp(run: () => Promise<CallerIdentity>): Promise<IdentityLookup> {
  try {
    return { identity: await run() };
  } catch (error) {
    return { identity: null, errorCode: awsErrorCode(error) };
  }
}

/** getCallerIdentity, with a failure returned as an error code instead of thrown. */
export function lookUpCallerIdentity(credentials: AwsCredentials, region: string, timeoutMs?: number): Promise<IdentityLookup> {
  return lookUp(() => getCallerIdentity(credentials, region, timeoutMs));
}

/** detectBaseIdentity, with a failure returned as an error code instead of thrown. */
export function lookUpBaseIdentity(region: string): Promise<IdentityLookup> {
  return lookUp(() => detectBaseIdentity(region));
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
    // An assumed-role session ARN hides the role path, so trust the account and restrict the
    // caller to the role with exactly that name, either without a path or under any path.
    return {
      principal: root,
      principalArnPatterns: [
        `arn:${partition}:iam::${account}:role/${roleName}`,
        `arn:${partition}:iam::${account}:role/*/${roleName}`,
      ],
    };
  }

  return { principal: root };
}
