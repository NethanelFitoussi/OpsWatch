import 'server-only';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import type { AwsCredentialIdentity, AwsCredentialIdentityProvider } from '@smithy/types';

type Source = Record<string, string | undefined>;

function staticKeys(source: Source): AwsCredentialIdentity | null {
  const accessKeyId = source.AWS_ACCESS_KEY_ID;
  const secretAccessKey = source.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;
  return source.AWS_SESSION_TOKEN
    ? { accessKeyId, secretAccessKey, sessionToken: source.AWS_SESSION_TOKEN }
    : { accessKeyId, secretAccessKey };
}

/**
 * OpsWatch's own identity. The two key variables win when both are set: the SDK's default chain
 * would otherwise prefer a shell `AWS_PROFILE` and silently ignore them. Without keys, the
 * standard chain applies (profile, SSO, ECS task role, EC2 instance profile...).
 */
export function selectBaseCredentials(
  source: Source,
  chain: () => AwsCredentialIdentityProvider = fromNodeProviderChain,
): AwsCredentialIdentityProvider {
  const keys = staticKeys(source);
  return keys ? async () => keys : chain();
}

/** Startup warning when both ways of giving OpsWatch an identity are set. Names only, no values. */
export function baseCredentialsWarning(source: Source): string | null {
  return staticKeys(source) !== null && source.AWS_PROFILE
    ? 'AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_PROFILE are all set: OpsWatch uses the access keys and ignores AWS_PROFILE.'
    : null;
}

let provider: AwsCredentialIdentityProvider | undefined;

/** One provider per process, so the chain's own caching (e.g. of ECS credentials) is kept. */
export function baseCredentials(): AwsCredentialIdentityProvider {
  provider ??= selectBaseCredentials(process.env);
  return provider;
}
