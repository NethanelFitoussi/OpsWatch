import { describe, expect, it, vi } from 'vitest';
import {
  CLOUD_PLATFORM_SCOPE,
  accessTokenFor,
  exchangeAudience,
  isValidTarget,
  providerResourceName,
  type FederationTarget,
} from '@/lib/gcp/federation';
import {
  TOKEN_LIFETIME_SECONDS,
  generateConnectionKey,
  jwkSet,
  mintToken,
  openConnectionKey,
  publicJwk,
  sealConnectionKey,
} from '@/lib/gcp/issuer';

/**
 * Reaching Google Cloud without holding a Google credential.
 *
 * Google's own guidance is to avoid service account keys, and the reason it gives is non-repudiation —
 * "there is no reliable way to tell who used the key". So OpsWatch stores no Google credential at all:
 * it signs a short-lived token with its own key and exchanges it.
 *
 * What these hold is the part that cannot be checked by looking at the page: the shape of the token
 * Google will accept, the fact that the private half is never served, and that nothing an operator
 * typed reaches a URL without being checked first.
 */

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const SECRET = 'instance-secret'.padEnd(32, 'x');
const KEY = generateConnectionKey();

const target = (over: Partial<FederationTarget> = {}): FederationTarget => ({
  projectNumber: '123456789012',
  poolId: 'opswatch-pool',
  providerId: 'opswatch-provider',
  serviceAccount: null,
  ...over,
});

const claimsOf = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()) as Record<string, unknown>;
const headerOf = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[0], 'base64url').toString()) as Record<string, unknown>;

describe('the token OpsWatch signs', () => {
  it('THE RULING: it carries the claims Google requires, inside the limits it states', () => {
    const jwt = mintToken({ key: KEY, issuer: 'https://ops.example/api/connections/c1/gcp', audience: 'aud', subject: 'c1', nowMs: NOW });
    const claims = claimsOf(jwt);

    expect(claims.iss).toBe('https://ops.example/api/connections/c1/gcp');
    expect(claims.aud).toBe('aud');
    expect(claims.sub).toBe('c1');
    // `exp` in the future, `iat` in the past, and at most 24 hours between them.
    expect(claims.iat).toBe(NOW / 1000);
    expect(claims.exp).toBe(NOW / 1000 + TOKEN_LIFETIME_SECONDS);
    expect((claims.exp as number) - (claims.iat as number)).toBeLessThanOrEqual(24 * 3600);
    expect(headerOf(jwt)).toMatchObject({ alg: 'RS256', typ: 'JWT', kid: KEY.kid });
  });

  it('THE RULING: the two audiences differ, and it is not a typo', () => {
    /*
     * The JWT's `aud` claim is the provider's resource name with a scheme; the exchange's `audience`
     * parameter is the same name scheme-relative. They look like they should be one string, and using
     * one for the other fails at Google with a message about an audience mismatch.
     */
    expect(providerResourceName(target())).toBe(
      'https://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/opswatch-pool/providers/opswatch-provider',
    );
    expect(exchangeAudience(target())).toBe(
      '//iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/opswatch-pool/providers/opswatch-provider',
    );
    expect(exchangeAudience(target())).not.toBe(providerResourceName(target()));
  });

  it('is signed by the key whose public half is published, and verifiable with it', async () => {
    const { createVerify, createPublicKey } = await import('node:crypto');
    const jwt = mintToken({ key: KEY, issuer: 'i', audience: 'a', subject: 's', nowMs: NOW });
    const [header, payload, signature] = jwt.split('.');
    const published = publicJwk(KEY);

    // Verified with the key built from the JWK that is actually served, not with the private half:
    // a key set that did not match the signature would be a set nobody could use.
    const fromPublished = createPublicKey({ key: { kty: 'RSA', n: published.n, e: published.e }, format: 'jwk' });
    const verified = createVerify('RSA-SHA256').update(`${header}.${payload}`).verify(fromPublished, Buffer.from(signature, 'base64url'));
    expect(verified).toBe(true);

    // …and a signature over different bytes does not verify, so the check above means something.
    expect(createVerify('RSA-SHA256').update(`${header}.tampered`).verify(fromPublished, Buffer.from(signature, 'base64url'))).toBe(false);
  });
});

describe('the key set that is served', () => {
  it('THE RULING: it carries the public half and nothing else', () => {
    const set = jwkSet(KEY);
    expect(set.keys).toHaveLength(1);
    expect(set.keys[0]).toMatchObject({ kty: 'RSA', use: 'sig', alg: 'RS256', kid: KEY.kid });
    // `d`, `p`, `q` and the rest are the private half. Serving one would hand over the connection.
    for (const secret of ['d', 'p', 'q', 'dp', 'dq', 'qi']) expect(secret in set.keys[0]).toBe(false);
    expect(JSON.stringify(set)).not.toContain('PRIVATE KEY');
  });

  it('seals the private half, and refuses a key it cannot open rather than throwing', () => {
    const sealed = sealConnectionKey(KEY, SECRET);
    expect(sealed).not.toContain('PRIVATE KEY');
    expect(openConnectionKey(sealed, SECRET)).toEqual(KEY);

    // A changed OPSWATCH_SECRET, or a corrupted row: the caller refuses, the page does not 500.
    expect(openConnectionKey(sealed, 'other-secret'.padEnd(32, 'y'))).toBeNull();
    expect(openConnectionKey('not-a-ciphertext', SECRET)).toBeNull();
  });
});

describe('what may reach a URL', () => {
  it('THE RULING: a service account that is not one is refused before anything is sent', async () => {
    const call = vi.fn();
    for (const account of [
      'https://evil.example/#@x.iam.gserviceaccount.com',
      '../../projects/other',
      'ops@evil.example',
      'ops@project.iam.gserviceaccount.com.evil.example',
    ]) {
      expect(isValidTarget(target({ serviceAccount: account })), account).toBe(false);
      const result = await accessTokenFor({
        connectionId: 'c1',
        target: target({ serviceAccount: account }),
        key: KEY,
        baseUrl: 'https://ops.example',
        nowMs: NOW,
        fetchImpl: call as unknown as typeof fetch,
      });
      expect(result).toEqual({ ok: false, reason: 'invalid_target' });
    }
    expect(call).not.toHaveBeenCalled();
  });

  it('refuses a project number or a pool id that is not one', () => {
    expect(isValidTarget(target({ projectNumber: '12a' }))).toBe(false);
    expect(isValidTarget(target({ poolId: 'Pool With Spaces' }))).toBe(false);
    expect(isValidTarget(target({ providerId: '../other' }))).toBe(false);
    expect(isValidTarget(target({ serviceAccount: 'opswatch@my-project.iam.gserviceaccount.com' }))).toBe(true);
  });
});

describe('the exchange', () => {
  const stsOk = { access_token: 'federated-token', expires_in: 3600 };

  it('THE RULING: it sends the documented request, and asks for nothing beyond read scope', async () => {
    const call = vi.fn(async () => new Response(JSON.stringify(stsOk), { status: 200 }));
    const result = await accessTokenFor({
      connectionId: 'c1',
      target: target(),
      key: KEY,
      baseUrl: 'https://ops.example/',
      nowMs: NOW,
      fetchImpl: call as unknown as typeof fetch,
    });

    expect(result).toEqual({ ok: true, data: { token: 'federated-token', expiresInSeconds: 3600 } });
    const [url, init] = call.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://sts.googleapis.com/v1/token');
    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body).toMatchObject({
      grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',
      audience: exchangeAudience(target()),
      scope: CLOUD_PLATFORM_SCOPE,
      requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
    });
    // And the token it sent is the one it signed, against the other audience.
    expect(claimsOf(body.subjectToken).aud).toBe(providerResourceName(target()));
  });

  it('impersonates a service account when one is named, and not when none is', async () => {
    const withAccount = target({ serviceAccount: 'opswatch@my-project.iam.gserviceaccount.com' });
    const call = vi.fn(async (url: string) =>
      url.startsWith('https://sts.')
        ? new Response(JSON.stringify(stsOk), { status: 200 })
        : new Response(JSON.stringify({ accessToken: 'sa-token', expireTime: new Date(NOW + 1800_000).toISOString() }), { status: 200 }),
    );

    const result = await accessTokenFor({
      connectionId: 'c1',
      target: withAccount,
      key: KEY,
      baseUrl: 'https://ops.example',
      nowMs: NOW,
      fetchImpl: call as unknown as typeof fetch,
    });

    expect(result).toEqual({ ok: true, data: { token: 'sa-token', expiresInSeconds: 1800 } });
    const [second] = call.mock.calls[1] as unknown as [string, RequestInit];
    expect(second).toBe(
      'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/opswatch%40my-project.iam.gserviceaccount.com:generateAccessToken',
    );
    // Without one, the federated token is used directly and there is no second call.
    const direct = vi.fn(async () => new Response(JSON.stringify(stsOk), { status: 200 }));
    await accessTokenFor({ connectionId: 'c1', target: target(), key: KEY, baseUrl: 'https://ops.example', nowMs: NOW, fetchImpl: direct as unknown as typeof fetch });
    expect(direct).toHaveBeenCalledTimes(1);
  });

  it('THE RULING: a refusal from Google is an answer, not an exception', async () => {
    const refused = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid value for "audience"' }), { status: 400 }),
    );
    const result = await accessTokenFor({
      connectionId: 'c1',
      target: target(),
      key: KEY,
      baseUrl: 'https://ops.example',
      nowMs: NOW,
      fetchImpl: refused as unknown as typeof fetch,
    });

    expect(result).toEqual({ ok: false, reason: 'exchange_refused', detail: 'Invalid value for "audience"' });
  });

  it('tells an instance with no route to Google from one Google refused', async () => {
    const dead = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(
      accessTokenFor({ connectionId: 'c1', target: target(), key: KEY, baseUrl: 'https://ops.example', nowMs: NOW, fetchImpl: dead as unknown as typeof fetch }),
    ).resolves.toEqual({ ok: false, reason: 'unreachable' });
  });

  it('refuses before signing anything when the instance has no public URL', async () => {
    const call = vi.fn();
    // The token says where it came from, and a token claiming to come from nowhere is not one.
    await expect(
      accessTokenFor({ connectionId: 'c1', target: target(), key: KEY, baseUrl: undefined, nowMs: NOW, fetchImpl: call as unknown as typeof fetch }),
    ).resolves.toEqual({ ok: false, reason: 'no_public_url' });
    expect(call).not.toHaveBeenCalled();
  });
});
