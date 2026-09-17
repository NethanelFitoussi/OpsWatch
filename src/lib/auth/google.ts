import 'server-only';
import * as client from 'openid-client';
import { z } from 'zod';
import { routing, type AppLocale } from '@/i18n/routing';
import { DecryptionError, decrypt, encrypt } from '../crypto';
import type { Env } from '../env';

/** Error codes a Google sign-in sends back to the login page. */
export const GOOGLE_SIGN_IN_ERRORS = ['google_denied', 'google_not_allowed', 'google_failed'] as const;
export type GoogleSignInError = (typeof GOOGLE_SIGN_IN_ERRORS)[number];

export type GoogleSignInConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Lowercased; when set, the Google `hd` (hosted domain) claim must equal it. */
  allowedDomain: string | undefined;
};

export const GOOGLE_CALLBACK_PATH = '/api/auth/google/callback';
export const GOOGLE_FLOW_COOKIE = 'opswatch_google_flow';
/** The flow cookie is only sent to the start and callback routes. */
export const GOOGLE_FLOW_COOKIE_PATH = '/api/auth/google';
export const GOOGLE_FLOW_TTL_MS = 10 * 60 * 1000;

const GOOGLE_ISSUER = 'https://accounts.google.com';

/** Google sign-in settings, or null when it is disabled (the default). */
export function googleSignInConfig(e: Env): GoogleSignInConfig | null {
  const { OPSWATCH_GOOGLE_CLIENT_ID: clientId, OPSWATCH_GOOGLE_CLIENT_SECRET: clientSecret, OPSWATCH_PUBLIC_URL: publicUrl } = e;
  if (!clientId || !clientSecret || !publicUrl) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: new URL(GOOGLE_CALLBACK_PATH, publicUrl).href,
    allowedDomain: e.OPSWATCH_GOOGLE_ALLOWED_DOMAIN?.toLowerCase(),
  };
}

/** Startup warning when Google sign-in is configured but cannot work. Names only, no values. */
export function googleSignInWarning(e: Env): string | null {
  return e.OPSWATCH_GOOGLE_CLIENT_ID && e.OPSWATCH_GOOGLE_CLIENT_SECRET && !e.OPSWATCH_PUBLIC_URL
    ? 'OPSWATCH_GOOGLE_CLIENT_ID and OPSWATCH_GOOGLE_CLIENT_SECRET are set but OPSWATCH_PUBLIC_URL is not: Google sign-in stays disabled (its redirect URI needs the public URL).'
    : null;
}

/** ID token claims; only `email`, `email_verified` and `hd` are read. */
type GoogleClaims = Readonly<Record<string, unknown>>;

/** Only the admin's own Google account may sign in: verified email equal to the admin email, and the allowed domain if set. */
export function isAllowedGoogleAccount(claims: GoogleClaims, adminEmail: string | null, allowedDomain?: string): boolean {
  if (adminEmail === null || claims.email_verified !== true || typeof claims.email !== 'string') return false;
  if (claims.email.toLowerCase() !== adminEmail.toLowerCase()) return false;
  return allowedDomain === undefined || (typeof claims.hd === 'string' && claims.hd.toLowerCase() === allowedDomain.toLowerCase());
}

const flowSchema = z.object({
  codeVerifier: z.string().min(1),
  state: z.string().min(1),
  nonce: z.string().min(1),
  locale: z.enum(routing.locales),
  expiresAt: z.number(),
});

/** What the callback needs to finish a sign-in started by this browser. */
export type GoogleFlow = z.infer<typeof flowSchema>;

export function sealGoogleFlow(flow: GoogleFlow, secret: string): string {
  return encrypt(JSON.stringify(flow), secret, 'google-sign-in');
}

/** The flow of a valid, unexpired cookie, or null. */
export function unsealGoogleFlow(value: string | undefined, secret: string, now: number = Date.now()): GoogleFlow | null {
  if (!value) return null;
  try {
    const flow = flowSchema.safeParse(JSON.parse(decrypt(value, secret, 'google-sign-in')));
    return flow.success && flow.data.expiresAt > now ? flow.data : null;
  } catch (error) {
    if (error instanceof DecryptionError || error instanceof SyntaxError) return null;
    throw error;
  }
}

/**
 * Google's documented, stable endpoints. Building the authorization URL needs no network access;
 * the callback still uses discovery, which also gives the keys that verify the ID token.
 */
const GOOGLE_AUTHORIZATION_SERVER: client.ServerMetadata = {
  issuer: GOOGLE_ISSUER,
  authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  token_endpoint: 'https://oauth2.googleapis.com/token',
  jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
};

export async function buildAuthorizationRequest(
  config: GoogleSignInConfig,
  locale: AppLocale,
  now: number = Date.now(),
): Promise<{ url: URL; flow: GoogleFlow }> {
  const flow: GoogleFlow = {
    codeVerifier: client.randomPKCECodeVerifier(),
    state: client.randomState(),
    nonce: client.randomNonce(),
    locale,
    expiresAt: now + GOOGLE_FLOW_TTL_MS,
  };
  const url = client.buildAuthorizationUrl(new client.Configuration(GOOGLE_AUTHORIZATION_SERVER, config.clientId), {
    redirect_uri: config.redirectUri,
    scope: 'openid email profile',
    code_challenge: await client.calculatePKCECodeChallenge(flow.codeVerifier),
    code_challenge_method: 'S256',
    state: flow.state,
    nonce: flow.nonce,
  });
  return { url, flow };
}

let discovered: Promise<client.Configuration> | undefined;

/** Discovered once per process; a failed discovery is retried on the next sign-in. */
function discoveredConfiguration(config: GoogleSignInConfig): Promise<client.Configuration> {
  discovered ??= client
    .discovery(new URL(GOOGLE_ISSUER), config.clientId, undefined, client.ClientSecretPost(config.clientSecret), {
      execute: [client.enableNonRepudiationChecks],
    })
    .catch((error: unknown) => {
      discovered = undefined;
      throw error;
    });
  return discovered;
}

/**
 * Exchanges the authorization code (with the PKCE verifier) and returns the claims of the ID token,
 * whose signature, issuer, audience, expiry and nonce openid-client has checked. Throws otherwise.
 */
export async function completeAuthorization(
  config: GoogleSignInConfig,
  params: URLSearchParams,
  flow: GoogleFlow,
): Promise<GoogleClaims> {
  // The redirect URI sent to the token endpoint is read from this URL, so it must be the public one.
  const currentUrl = new URL(config.redirectUri);
  currentUrl.search = params.toString();
  const tokens = await client.authorizationCodeGrant(await discoveredConfiguration(config), currentUrl, {
    pkceCodeVerifier: flow.codeVerifier,
    expectedState: flow.state,
    expectedNonce: flow.nonce,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims) throw new Error('Google returned no ID token');
  return claims;
}
