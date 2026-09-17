import { describe, expect, it } from 'vitest';
import { normalizeAwsErrorCode } from '@/lib/aws/errors';
import { identityErrorHint, knownIdentityError } from '@/lib/aws/identity-errors';
import { browserLocale, isBrowserNavigation, seeOther } from '@/lib/http/browser';

describe('identityErrorHint', () => {
  it('recognises the common base identity failures', () => {
    expect(identityErrorHint('CredentialsProviderError')).toBe('CredentialsProviderError');
    expect(identityErrorHint('ExpiredToken')).toBe('ExpiredToken');
    expect(identityErrorHint('ExpiredTokenException')).toBe('ExpiredToken');
    expect(identityErrorHint('InvalidClientTokenId')).toBe('InvalidClientTokenId');
    expect(identityErrorHint('SignatureDoesNotMatch')).toBe('SignatureDoesNotMatch');
    expect(identityErrorHint('TimeoutError')).toBe('Timeout');
    expect(identityErrorHint('AbortError')).toBe('Timeout');
  });

  it('has no hint for other errors', () => {
    expect(identityErrorHint('AccessDenied')).toBeNull();
    expect(identityErrorHint('UnknownError')).toBeNull();
  });
});

describe('knownIdentityError', () => {
  it('names the errors the checklist explains, folding hints in', () => {
    expect(knownIdentityError('AccountMismatch')).toBe('AccountMismatch');
    expect(knownIdentityError('SecretChanged')).toBe('SecretChanged');
    expect(knownIdentityError('NotReady')).toBe('NotReady');
    expect(knownIdentityError('AccessDenied')).toBe('AccessDenied');
    expect(knownIdentityError('ExpiredTokenException')).toBe('ExpiredToken');
    expect(knownIdentityError('AbortError')).toBe('Timeout');
    expect(knownIdentityError('ThrottlingException')).toBeNull();
  });
});

describe('normalizeAwsErrorCode', () => {
  it('reports both ways a call can time out as Timeout', () => {
    expect(normalizeAwsErrorCode('TimeoutError')).toBe('Timeout');
    expect(normalizeAwsErrorCode('AbortError')).toBe('Timeout');
    expect(normalizeAwsErrorCode('AccessDenied')).toBe('AccessDenied');
  });
});

describe('browser helpers', () => {
  it('tells a browser navigation from a script call', () => {
    expect(isBrowserNavigation(new Request('http://x/a', { headers: { 'sec-fetch-mode': 'navigate' } }))).toBe(true);
    expect(isBrowserNavigation(new Request('http://x/a', { headers: { accept: 'text/html,application/xhtml+xml' } }))).toBe(true);
    expect(isBrowserNavigation(new Request('http://x/a', { headers: { accept: '*/*' } }))).toBe(false);
    expect(isBrowserNavigation(new Request('http://x/a'))).toBe(false);
  });

  it('reads the saved locale, defaulting to English', () => {
    expect(browserLocale(new Request('http://x/a', { headers: { cookie: 'a=b; NEXT_LOCALE=fr' } }))).toBe('fr');
    expect(browserLocale(new Request('http://x/a', { headers: { cookie: 'NEXT_LOCALE=de' } }))).toBe('en');
    expect(browserLocale(new Request('http://x/a'))).toBe('en');
  });

  it('redirects with a relative location', () => {
    const res = seeOther('/fr/accounts/abc?error=no_base_identity');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/fr/accounts/abc?error=no_base_identity');
  });
});
