import { isOneOf } from '../type-guards';
import { normalizeAwsErrorCode } from './errors';

export const IDENTITY_ERROR_HINTS = [
  'CredentialsProviderError',
  'ExpiredToken',
  'InvalidClientTokenId',
  'SignatureDoesNotMatch',
  'Timeout',
] as const;

export type IdentityErrorHint = (typeof IDENTITY_ERROR_HINTS)[number];

/**
 * Identity error codes OpsWatch produces itself. They use the AWS-style PascalCase of the AWS error
 * names they are reported alongside (API and form error codes are snake_case).
 */
export const OPSWATCH_IDENTITY_ERRORS = ['AccountMismatch', 'SecretChanged', 'NotReady'] as const;
export type OpsWatchIdentityError = (typeof OPSWATCH_IDENTITY_ERRORS)[number];

const KNOWN_IDENTITY_ERRORS = [...OPSWATCH_IDENTITY_ERRORS, 'AccessDenied', ...IDENTITY_ERROR_HINTS] as const;
export type KnownIdentityError = (typeof KNOWN_IDENTITY_ERRORS)[number];

/** Maps an AWS error name to the hint explaining it, or null when there is no specific hint. */
export function identityErrorHint(code: string): IdentityErrorHint | null {
  const normalized = normalizeAwsErrorCode(code);
  if (normalized === 'ExpiredTokenException') return 'ExpiredToken';
  return isOneOf(IDENTITY_ERROR_HINTS, normalized) ? normalized : null;
}

/** The identity error the permission checklist has a specific message for, or null. */
export function knownIdentityError(code: string): KnownIdentityError | null {
  return identityErrorHint(code) ?? (isOneOf(KNOWN_IDENTITY_ERRORS, code) ? code : null);
}
