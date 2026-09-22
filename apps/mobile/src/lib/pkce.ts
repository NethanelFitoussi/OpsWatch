/**
 * PKCE (RFC 7636) for the Google sign-in round trip: the one-time code the server hands back through the app's URL
 * scheme is useless to another app that intercepts it, because only this app knows the verifier.
 */
import * as Crypto from 'expo-crypto';

export function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return base64ToUrl(btoa(binary));
}

export function base64ToUrl(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string; state: string }> {
  const verifier = base64UrlFromBytes(Crypto.getRandomBytes(32));
  const state = base64UrlFromBytes(Crypto.getRandomBytes(16));
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 });
  return { verifier, challenge: base64ToUrl(digest), state };
}

/** Reads `code` and `state` from the redirect URL, refusing anything whose state does not match. */
export function readAuthRedirect(url: string, expectedState: string): { code: string } | { error: 'state_mismatch' | 'missing_code' | 'denied' } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: 'missing_code' };
  }
  const params = parsed.searchParams;
  if (params.get('error')) return { error: 'denied' };
  if (params.get('state') !== expectedState) return { error: 'state_mismatch' };
  const code = params.get('code');
  if (!code || code.length > 512) return { error: 'missing_code' };
  return { code };
}
