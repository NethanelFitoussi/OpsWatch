import type { AwsCredentialIdentity, AwsCredentialIdentityProvider } from '@smithy/types';

export type AwsCredentials = AwsCredentialIdentity | AwsCredentialIdentityProvider;

export function clientConfig(
  region: string,
  credentials?: AwsCredentials,
  endpoint: string | undefined = process.env.OPSWATCH_AWS_ENDPOINT_URL,
) {
  return {
    region,
    maxAttempts: 2,
    ...(credentials ? { credentials } : {}),
    ...(endpoint ? { endpoint } : {}),
  };
}
