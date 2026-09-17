import { describe, expect, it } from 'vitest';
import { DecryptionError, decrypt } from '@/lib/crypto';
import {
  GOOGLE_FLOW_TTL_MS,
  buildAuthorizationRequest,
  googleSignInConfig,
  googleSignInWarning,
  isAllowedGoogleAccount,
  sealGoogleFlow,
  unsealGoogleFlow,
  type GoogleFlow,
} from '@/lib/auth/google';
import { loadEnv } from '@/lib/env';
import { OTHER_SECRET, TEST_SECRET } from '../helpers/fixtures';

const GOOGLE_ENV = {
  OPSWATCH_SECRET: TEST_SECRET,
  OPSWATCH_GOOGLE_CLIENT_ID: 'client-123.apps.googleusercontent.com',
  OPSWATCH_GOOGLE_CLIENT_SECRET: 'client-secret',
  OPSWATCH_PUBLIC_URL: 'https://ops.example.com',
};

describe('googleSignInConfig', () => {
  it('is enabled with a client ID, a client secret and a public URL', () => {
    expect(googleSignInConfig(loadEnv(GOOGLE_ENV))).toEqual({
      clientId: 'client-123.apps.googleusercontent.com',
      clientSecret: 'client-secret',
      redirectUri: 'https://ops.example.com/api/auth/google/callback',
      allowedDomain: undefined,
    });
    expect(googleSignInWarning(loadEnv(GOOGLE_ENV))).toBeNull();
  });

  it('keeps the optional allowed domain', () => {
    const config = googleSignInConfig(loadEnv({ ...GOOGLE_ENV, OPSWATCH_GOOGLE_ALLOWED_DOMAIN: 'Example.com' }));
    expect(config?.allowedDomain).toBe('example.com');
  });

  it('is disabled without both client variables, silently', () => {
    const noSecret = loadEnv({ ...GOOGLE_ENV, OPSWATCH_GOOGLE_CLIENT_SECRET: '' });
    expect(googleSignInConfig(noSecret)).toBeNull();
    expect(googleSignInWarning(noSecret)).toBeNull();
    expect(googleSignInConfig(loadEnv({ OPSWATCH_SECRET: TEST_SECRET }))).toBeNull();
  });

  it('is disabled with a warning when the public URL is missing', () => {
    const noUrl = loadEnv({ ...GOOGLE_ENV, OPSWATCH_PUBLIC_URL: undefined });
    expect(googleSignInConfig(noUrl)).toBeNull();
    expect(googleSignInWarning(noUrl)).toMatch(/OPSWATCH_PUBLIC_URL/);
  });
});

describe('isAllowedGoogleAccount', () => {
  const verified = { email: 'Admin@Example.com', email_verified: true, hd: 'example.com' };

  it('accepts the verified admin email, whatever its case', () => {
    expect(isAllowedGoogleAccount(verified, 'admin@example.com')).toBe(true);
  });

  it('requires a verified email', () => {
    expect(isAllowedGoogleAccount({ ...verified, email_verified: false }, 'admin@example.com')).toBe(false);
    expect(isAllowedGoogleAccount({ email: 'admin@example.com' }, 'admin@example.com')).toBe(false);
    expect(isAllowedGoogleAccount({ ...verified, email_verified: 'true' }, 'admin@example.com')).toBe(false);
  });

  it('refuses another email, or any email before an admin exists', () => {
    expect(isAllowedGoogleAccount({ ...verified, email: 'other@example.com' }, 'admin@example.com')).toBe(false);
    expect(isAllowedGoogleAccount({ ...verified, email: undefined }, 'admin@example.com')).toBe(false);
    expect(isAllowedGoogleAccount(verified, null)).toBe(false);
  });

  it('requires the hosted domain when an allowed domain is set', () => {
    expect(isAllowedGoogleAccount(verified, 'admin@example.com', 'example.com')).toBe(true);
    expect(isAllowedGoogleAccount({ ...verified, hd: 'other.com' }, 'admin@example.com', 'example.com')).toBe(false);
    expect(isAllowedGoogleAccount({ ...verified, hd: undefined }, 'admin@example.com', 'example.com')).toBe(false);
  });
});

describe('Google flow cookie', () => {
  const flow: GoogleFlow = { codeVerifier: 'verifier', state: 'state', nonce: 'nonce', locale: 'fr', expiresAt: 1_000_000 };

  it('round-trips until it expires', () => {
    const sealed = sealGoogleFlow(flow, TEST_SECRET);
    expect(sealed).not.toContain('verifier');
    expect(unsealGoogleFlow(sealed, TEST_SECRET, 999_999)).toEqual(flow);
    expect(unsealGoogleFlow(sealed, TEST_SECRET, 1_000_000)).toBeNull();
  });

  it('rejects a missing, tampered or foreign cookie', () => {
    const sealed = sealGoogleFlow(flow, TEST_SECRET);
    expect(unsealGoogleFlow(undefined, TEST_SECRET, 0)).toBeNull();
    const tampered = Buffer.from(sealed, 'base64url');
    tampered[tampered.length - 1] ^= 0xff;
    expect(unsealGoogleFlow(tampered.toString('base64url'), TEST_SECRET, 0)).toBeNull();
    expect(unsealGoogleFlow(sealed, OTHER_SECRET, 0)).toBeNull();
  });

  it('uses a key of its own, not the access key one', () => {
    expect(() => decrypt(sealGoogleFlow(flow, TEST_SECRET), TEST_SECRET)).toThrow(DecryptionError);
  });
});

describe('buildAuthorizationRequest', () => {
  it('asks Google for a code with PKCE, state and nonce, and lasts 10 minutes', async () => {
    const config = googleSignInConfig(loadEnv(GOOGLE_ENV))!;
    const { url, flow } = await buildAuthorizationRequest(config, 'fr', 5_000);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const params = url.searchParams;
    expect(params.get('response_type')).toBe('code');
    expect(params.get('client_id')).toBe('client-123.apps.googleusercontent.com');
    expect(params.get('redirect_uri')).toBe('https://ops.example.com/api/auth/google/callback');
    expect(params.get('scope')).toBe('openid email profile');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('code_challenge')).toMatch(/^[\w-]{43}$/);
    expect(params.get('code_challenge')).not.toBe(flow.codeVerifier);
    expect(params.get('state')).toBe(flow.state);
    expect(params.get('nonce')).toBe(flow.nonce);
    expect(params.has('client_secret')).toBe(false);
    expect(flow).toMatchObject({ locale: 'fr', expiresAt: 5_000 + GOOGLE_FLOW_TTL_MS });
  });
});
