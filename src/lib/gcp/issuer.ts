import 'server-only';
import { createHash, createPrivateKey, createPublicKey, createSign, generateKeyPairSync } from 'node:crypto';
import { decrypt, encrypt } from '../crypto';

/**
 * OpsWatch as an OIDC issuer, for one Google Cloud connection.
 *
 * Google's own guidance is to "avoid using service account keys whenever possible", and the risk it
 * names is non-repudiation: "if the service account is authenticated with a service account key, there
 * is no reliable way to tell who used the key". Workload identity federation is what it recommends
 * instead — an external workload signs a token with its own key and exchanges it for a short-lived
 * Google one.
 *
 * The objection for a self-hosted product is that Google has to be able to fetch the public key, and a
 * great many OpsWatch installations are not reachable from the internet. It turns out not to hold:
 * `gcloud iam workload-identity-pools providers create-oidc --jwk-json-path` uploads the key set
 * directly, "when the IdP's OIDC metadata endpoint URL isn't publicly accessible". So the recommended
 * method is available to an instance behind a firewall, and this product does not have to offer the one
 * Google discourages.
 *
 * **One key per connection**, generated when the connection is created. A key withdrawn in Google stops
 * exactly one connection. The private half is encrypted under its own purpose and never leaves the row;
 * the public half is served as a JWK set, which is what a public key is for.
 */

/** RS256: the algorithm every OIDC verifier supports, at the modulus size Google's own keys use. */
const ALGORITHM = 'RS256';
const MODULUS_BITS = 2048;

/**
 * How long a minted token is good for.
 *
 * Google requires `exp` in the future, `iat` in the past, and at most 24 hours between them. Five
 * minutes is far inside that: the token is exchanged immediately, and one that outlives its exchange is
 * a credential lying around for no reason.
 */
export const TOKEN_LIFETIME_SECONDS = 300;

export type ConnectionKey = { privateKeyPem: string; kid: string };

/** A JSON Web Key, as a key set carries it. Public material only: there is no `d` here by construction. */
export type Jwk = { kty: 'RSA'; use: 'sig'; alg: string; kid: string; n: string; e: string };

/** Generates this connection's signing key. Called once, when the connection is created. */
export function generateConnectionKey(): ConnectionKey {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: MODULUS_BITS });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  // The key id is derived from the public half, so it is stable and says nothing about the private one.
  const publicDer = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  return { privateKeyPem, kid: createHash('sha256').update(publicDer).digest('base64url').slice(0, 16) };
}

export const sealConnectionKey = (key: ConnectionKey, secret: string): string =>
  encrypt(JSON.stringify(key), secret, 'gcp-federation');

export function openConnectionKey(ciphertext: string, secret: string): ConnectionKey | null {
  try {
    const parsed = JSON.parse(decrypt(ciphertext, secret, 'gcp-federation')) as Partial<ConnectionKey>;
    if (typeof parsed.privateKeyPem !== 'string' || typeof parsed.kid !== 'string') return null;
    return { privateKeyPem: parsed.privateKeyPem, kid: parsed.kid };
  } catch {
    // A key that cannot be opened — a changed OPSWATCH_SECRET, a corrupted row — is not a key. The
    // caller refuses rather than serving a 500, exactly as the host agent's secret does.
    return null;
  }
}

/** The public half, in the form `--jwk-json-path` takes and a discovery endpoint serves. */
export function publicJwk(key: ConnectionKey): Jwk {
  const jwk = createPublicKey(key.privateKeyPem).export({ format: 'jwk' }) as { n?: string; e?: string };
  if (jwk.n === undefined || jwk.e === undefined) throw new Error('not an RSA key');
  return { kty: 'RSA', use: 'sig', alg: ALGORITHM, kid: key.kid, n: jwk.n, e: jwk.e };
}

export const jwkSet = (key: ConnectionKey): { keys: Jwk[] } => ({ keys: [publicJwk(key)] });

const base64url = (value: string): string => Buffer.from(value).toString('base64url');

/**
 * Mints the token Google's Security Token Service will exchange.
 *
 * `aud` must be the provider's full resource name, or a custom audience the provider was configured to
 * accept. `sub` identifies the workload; it is the connection, because that is the thing an operator
 * grants access to and the thing they would revoke.
 */
export function mintToken(input: {
  key: ConnectionKey;
  issuer: string;
  audience: string;
  subject: string;
  nowMs: number;
}): string {
  const issuedAt = Math.floor(input.nowMs / 1000);
  const header = { alg: ALGORITHM, typ: 'JWT', kid: input.key.kid };
  const claims = {
    iss: input.issuer,
    sub: input.subject,
    aud: input.audience,
    iat: issuedAt,
    exp: issuedAt + TOKEN_LIFETIME_SECONDS,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(createPrivateKey(input.key.privateKeyPem));
  return `${signingInput}.${signature.toString('base64url')}`;
}

/** Where this connection's tokens say they came from, and where a discovery fetch would look. */
export const issuerUrl = (baseUrl: string, connectionId: string): string =>
  `${baseUrl.replace(/\/$/, '')}/api/connections/${connectionId}/gcp`;
