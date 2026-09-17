import { describe, expect, it, vi } from 'vitest';
import { baseCredentialsWarning, selectBaseCredentials } from '@/lib/aws/base-credentials';

const chainCreds = { accessKeyId: 'CHAIN', secretAccessKey: 'chain' };

describe('selectBaseCredentials', () => {
  it('uses the two key variables when both are set, even with AWS_PROFILE', async () => {
    const chain = vi.fn(() => async () => chainCreds);
    const provider = selectBaseCredentials(
      { AWS_ACCESS_KEY_ID: 'AKIAENV', AWS_SECRET_ACCESS_KEY: 'env-secret', AWS_PROFILE: 'sso' },
      chain,
    );
    expect(await provider()).toEqual({ accessKeyId: 'AKIAENV', secretAccessKey: 'env-secret' });
    expect(chain).not.toHaveBeenCalled();
  });

  it('adds the session token when present', async () => {
    const provider = selectBaseCredentials(
      { AWS_ACCESS_KEY_ID: 'ASIAENV', AWS_SECRET_ACCESS_KEY: 'env-secret', AWS_SESSION_TOKEN: 'token' },
      () => async () => chainCreds,
    );
    expect(await provider()).toEqual({ accessKeyId: 'ASIAENV', secretAccessKey: 'env-secret', sessionToken: 'token' });
  });

  it('falls back to the provider chain when a key variable is missing or empty', async () => {
    for (const env of [{}, { AWS_ACCESS_KEY_ID: 'AKIAENV' }, { AWS_ACCESS_KEY_ID: 'AKIAENV', AWS_SECRET_ACCESS_KEY: '' }]) {
      const chain = vi.fn(() => async () => chainCreds);
      expect(await selectBaseCredentials(env, chain)()).toEqual(chainCreds);
      expect(chain).toHaveBeenCalledOnce();
    }
  });
});

describe('baseCredentialsWarning', () => {
  it('warns, without any value, only when both keys and AWS_PROFILE are set', () => {
    const warning = baseCredentialsWarning({ AWS_ACCESS_KEY_ID: 'AKIAVALUE', AWS_SECRET_ACCESS_KEY: 'secret-value', AWS_PROFILE: 'my-profile' });
    expect(warning).toMatch(/uses the access keys/);
    expect(warning).not.toMatch(/AKIAVALUE|secret-value|my-profile/);
    expect(baseCredentialsWarning({ AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b' })).toBeNull();
    expect(baseCredentialsWarning({ AWS_PROFILE: 'p' })).toBeNull();
    expect(baseCredentialsWarning({ AWS_ACCESS_KEY_ID: 'a', AWS_PROFILE: 'p' })).toBeNull();
  });
});
