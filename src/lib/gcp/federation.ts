import 'server-only';
import type { FederationFailure } from './federation-types';
import { issuerUrl, mintToken, openConnectionKey, type ConnectionKey } from './issuer';

export type { FederationFailure };

/**
 * Exchanging a token OpsWatch signed for one Google will accept.
 *
 * Two hops, and the second is optional. The Security Token Service takes the JWT and returns a
 * federated access token; impersonating a service account then exchanges that for the service
 * account's own token, which is how most operators will grant access because an IAM policy naming a
 * service account is the thing their organisation already reviews.
 *
 * **Verified against the current documentation, not written from memory.** The two audiences are not
 * the same string and look as though they should be: the JWT's `aud` claim is
 * `https://iam.googleapis.com/projects/…`, and the exchange's `audience` parameter is
 * `//iam.googleapis.com/projects/…` — scheme-relative, which is Google's own resource-name form.
 *
 * Nothing here takes a URL from an operator. The two hosts are constants, and the values that reach a
 * path are shape-checked first, so there is no request this can be talked into making.
 */

const STS_ENDPOINT = 'https://sts.googleapis.com/v1/token';
const IAM_CREDENTIALS_HOST = 'https://iamcredentials.googleapis.com';
/** Read-only against everything the granted roles allow, and nothing beyond them. */
export const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/** A project number is digits. A pool, a provider and a project id are Google's own id shape. */
const PROJECT_NUMBER = /^[0-9]{1,30}$/;
const RESOURCE_ID = /^[a-z][a-z0-9-]{2,62}$/;
/** `name@project.iam.gserviceaccount.com`, the only form `generateAccessToken` accepts. */
const SERVICE_ACCOUNT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/;

export type FederationTarget = {
  projectNumber: string;
  poolId: string;
  providerId: string;
  /** Null means the federated identity is used directly, without impersonating anything. */
  serviceAccount: string | null;
};

export function isValidTarget(target: FederationTarget): boolean {
  if (!PROJECT_NUMBER.test(target.projectNumber)) return false;
  if (!RESOURCE_ID.test(target.poolId) || !RESOURCE_ID.test(target.providerId)) return false;
  return target.serviceAccount === null || SERVICE_ACCOUNT.test(target.serviceAccount);
}

/** The provider's full resource name. Google's own form, and what the JWT's `aud` claim must be. */
export const providerResourceName = (target: FederationTarget): string =>
  `https://iam.googleapis.com/projects/${target.projectNumber}/locations/global/workloadIdentityPools/${target.poolId}/providers/${target.providerId}`;

/** The same name as the exchange wants it: scheme-relative, which is not the same string. */
export const exchangeAudience = (target: FederationTarget): string =>
  providerResourceName(target).replace(/^https:/, '');

export type AccessToken = { token: string; expiresInSeconds: number };


export type FederationResult = { ok: true; data: AccessToken } | { ok: false; reason: FederationFailure; detail?: string };

/** What Google said went wrong, reduced to something a page can show without quoting a provider at a reader. */
async function refusalDetail(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: string | { message?: string }; error_description?: string };
    const message = typeof body.error === 'string' ? (body.error_description ?? body.error) : body.error?.message;
    return typeof message === 'string' ? message.slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A token this connection can read Google Cloud with, or the reason there is none.
 *
 * Never throws for a refusal: "Google would not accept the token" is an answer the page has to show,
 * and an exception here would become a 500 on a settings screen.
 */
export async function accessTokenFor(input: {
  connectionId: string;
  target: FederationTarget;
  key: ConnectionKey;
  baseUrl: string | undefined;
  nowMs: number;
  fetchImpl?: typeof fetch;
}): Promise<FederationResult> {
  if (!isValidTarget(input.target)) return { ok: false, reason: 'invalid_target' };
  if (input.baseUrl === undefined || input.baseUrl.length === 0) return { ok: false, reason: 'no_public_url' };
  const call = input.fetchImpl ?? fetch;

  const subjectToken = mintToken({
    key: input.key,
    issuer: issuerUrl(input.baseUrl, input.connectionId),
    audience: providerResourceName(input.target),
    // The connection, because that is the thing an operator grants access to and would revoke.
    subject: input.connectionId,
    nowMs: input.nowMs,
  });

  let federated: Response;
  try {
    federated = await call(STS_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',
        audience: exchangeAudience(input.target),
        scope: CLOUD_PLATFORM_SCOPE,
        requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
        subjectToken,
        subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
      }),
    });
  } catch {
    // An instance with no route to Google is a different problem from one Google refused.
    return { ok: false, reason: 'unreachable' };
  }

  if (!federated.ok) return { ok: false, reason: 'exchange_refused', detail: await refusalDetail(federated) };
  const exchanged = (await federated.json()) as { access_token?: string; expires_in?: number };
  if (typeof exchanged.access_token !== 'string') return { ok: false, reason: 'exchange_refused' };

  const federatedToken: AccessToken = { token: exchanged.access_token, expiresInSeconds: exchanged.expires_in ?? 3600 };
  if (input.target.serviceAccount === null) return { ok: true, data: federatedToken };

  // The second hop. `projects/-` is Google's own form: the service account is found by its email.
  let impersonated: Response;
  try {
    impersonated = await call(
      `${IAM_CREDENTIALS_HOST}/v1/projects/-/serviceAccounts/${encodeURIComponent(input.target.serviceAccount)}:generateAccessToken`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${federatedToken.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ scope: [CLOUD_PLATFORM_SCOPE] }),
      },
    );
  } catch {
    return { ok: false, reason: 'unreachable' };
  }

  if (!impersonated.ok) return { ok: false, reason: 'impersonation_refused', detail: await refusalDetail(impersonated) };
  const token = (await impersonated.json()) as { accessToken?: string; expireTime?: string };
  if (typeof token.accessToken !== 'string') return { ok: false, reason: 'impersonation_refused' };

  const expiresAt = token.expireTime === undefined ? null : Date.parse(token.expireTime);
  return {
    ok: true,
    data: {
      token: token.accessToken,
      expiresInSeconds: expiresAt === null || Number.isNaN(expiresAt) ? 3600 : Math.max(0, Math.round((expiresAt - input.nowMs) / 1000)),
    },
  };
}

/** Opens the stored key, or says there is none to open. */
export const keyFor = (ciphertext: string | null, secret: string): ConnectionKey | null =>
  ciphertext === null ? null : openConnectionKey(ciphertext, secret);
