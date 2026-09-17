export const IDENTITY_ERROR_HINTS = [
  'CredentialsProviderError',
  'ExpiredToken',
  'InvalidClientTokenId',
  'SignatureDoesNotMatch',
  'Timeout',
] as const;

export type IdentityErrorHint = (typeof IDENTITY_ERROR_HINTS)[number];

/** Maps an AWS error name to the hint explaining it, or null when there is no specific hint. */
export function identityErrorHint(code: string): IdentityErrorHint | null {
  if (code === 'TimeoutError' || code === 'AbortError') return 'Timeout';
  if (code === 'ExpiredTokenException') return 'ExpiredToken';
  return (IDENTITY_ERROR_HINTS as readonly string[]).includes(code) ? (code as IdentityErrorHint) : null;
}
