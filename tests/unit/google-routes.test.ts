import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEnv, type Env } from '@/lib/env';
import { TEST_SECRET } from '../helpers/fixtures';

const state = vi.hoisted(() => ({
  admin: undefined as { id: number; email: string } | undefined,
  env: undefined as unknown as Env,
  sessions: [] as number[],
  failures: 0,
  claims: {} as Record<string, unknown> | undefined,
  grant: undefined as undefined | ((...args: unknown[]) => void),
}));

vi.mock('@/lib/db/client', () => ({ getDb: () => ({}) }));
vi.mock('@/lib/auth/admin', () => ({ findAdmin: () => state.admin }));
vi.mock('@/lib/auth/current', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/current')>()),
  clientIp: async () => 'client-1',
  startSession: async (adminId: number) => {
    state.sessions.push(adminId);
  },
}));
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  env: () => state.env,
}));
vi.mock('@/lib/auth/login-limiter', async () => {
  const { createRateLimiter } = await import('@/lib/auth/rate-limit');
  return {
    loginLimiter: createRateLimiter({ limit: 5, windowMs: 60_000 }),
    loginThrottle: { run: async () => ({ limited: true }), recordFailure: () => void state.failures++ },
  };
});
// Google's network is never reached: discovery and the token exchange are replaced at the library boundary.
vi.mock('openid-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('openid-client')>()),
  discovery: async () => ({ discovered: true }),
  authorizationCodeGrant: async (...args: unknown[]) => {
    state.grant?.(...args);
    return { claims: () => state.claims };
  },
}));

const { GET: start } = await import('@/app/api/auth/google/start/route');
const { GET: callback } = await import('@/app/api/auth/google/callback/route');
const { GOOGLE_FLOW_COOKIE, sealGoogleFlow } = await import('@/lib/auth/google');
const { loginLimiter } = await import('@/lib/auth/login-limiter');

const GOOGLE_ENV = {
  OPSWATCH_SECRET: TEST_SECRET,
  OPSWATCH_GOOGLE_CLIENT_ID: 'test-client',
  OPSWATCH_GOOGLE_CLIENT_SECRET: 'test-secret',
  OPSWATCH_PUBLIC_URL: 'https://ops.example.com',
};
const FLOW = { codeVerifier: 'verifier', state: 'expected-state', nonce: 'expected-nonce', locale: 'fr' as const };

function flowCookie(expiresAt = Date.now() + 60_000) {
  return `${GOOGLE_FLOW_COOKIE}=${sealGoogleFlow({ ...FLOW, expiresAt }, TEST_SECRET)}`;
}

function callbackRequest(query: string, cookie = flowCookie()) {
  return callback(
    new NextRequest(`http://internal:3000/api/auth/google/callback?${query}`, { headers: cookie ? { cookie } : {} }),
  );
}

function expectFlowCookieCleared(response: Response) {
  expect(response.headers.get('set-cookie')).toMatch(new RegExp(`^${GOOGLE_FLOW_COOKIE}=;.*Max-Age=0`, 'i'));
}

beforeEach(() => {
  state.admin = { id: 7, email: 'a@example.com' };
  state.env = loadEnv(GOOGLE_ENV);
  state.sessions = [];
  state.failures = 0;
  state.claims = { email: 'A@example.com', email_verified: true };
  state.grant = undefined;
  loginLimiter.reset('client-1');
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('GET /api/auth/google/start', () => {
  it('redirects to Google and stores the flow in a short-lived, HttpOnly cookie', async () => {
    const response = await start(new NextRequest('http://internal:3000/api/auth/google/start?locale=fr'));
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('redirect_uri')).toBe('https://ops.example.com/api/auth/google/callback');
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toMatch(new RegExp(`^${GOOGLE_FLOW_COOKIE}=[\\w-]+;`));
    expect(cookie).toMatch(/Max-Age=600/);
    expect(cookie).toMatch(/Path=\/api\/auth\/google/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=lax/i);
  });

  it('sends the browser back to the login page when Google sign-in is disabled', async () => {
    state.env = loadEnv({ OPSWATCH_SECRET: TEST_SECRET });
    const response = await start(new NextRequest('http://internal:3000/api/auth/google/start?locale=fr'));
    expect(response.headers.get('location')).toBe('/fr/login');
  });

  it('applies the per-client login limit', async () => {
    for (let i = 0; i < 5; i++) {
      await start(new NextRequest('http://internal:3000/api/auth/google/start?locale=en'));
    }
    const response = await start(new NextRequest('http://internal:3000/api/auth/google/start?locale=en'));
    expect(response.headers.get('location')).toBe('/en/login?error=rate_limited');
  });
});

describe('GET /api/auth/google/callback', () => {
  it('signs the admin in with PKCE, state and nonce checks', async () => {
    let checks: unknown;
    let currentUrl: unknown;
    state.grant = (_config, url, given) => {
      currentUrl = url;
      checks = given;
    };
    const response = await callbackRequest('code=abc&state=expected-state');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/fr/accounts');
    expect(state.sessions).toEqual([7]);
    expect(checks).toEqual({
      pkceCodeVerifier: 'verifier',
      expectedState: 'expected-state',
      expectedNonce: 'expected-nonce',
      idTokenExpected: true,
    });
    expect(String(currentUrl)).toBe('https://ops.example.com/api/auth/google/callback?code=abc&state=expected-state');
    expectFlowCookieCleared(response);
    expect(state.failures).toBe(0);
  });

  it('reports a cancelled sign-in as denied, without counting a failed login', async () => {
    const response = await callbackRequest('error=access_denied&state=expected-state');
    expect(response.headers.get('location')).toBe('/fr/login?error=google_denied');
    expectFlowCookieCleared(response);
    expect(state.failures).toBe(0);
  });

  it('fails on a state mismatch, before any token exchange', async () => {
    state.grant = () => {
      throw new Error('must not be called');
    };
    const response = await callbackRequest('code=abc&state=forged');
    expect(response.headers.get('location')).toBe('/fr/login?error=google_failed');
    expectFlowCookieCleared(response);
    expect(state.failures).toBe(1);
    expect(state.sessions).toEqual([]);
  });

  it('fails without a valid flow cookie', async () => {
    expect((await callbackRequest('code=abc&state=expected-state', '')).headers.get('location')).toBe(
      '/en/login?error=google_failed',
    );
    expect((await callbackRequest('code=abc&state=expected-state', flowCookie(Date.now() - 1))).headers.get('location')).toBe(
      '/en/login?error=google_failed',
    );
    expect(state.failures).toBe(2);
  });

  it('fails when the token exchange or ID token validation fails', async () => {
    state.grant = () => {
      throw new Error('unexpected JWT "nonce" claim value');
    };
    const response = await callbackRequest('code=abc&state=expected-state');
    expect(response.headers.get('location')).toBe('/fr/login?error=google_failed');
    expect(state.failures).toBe(1);
  });

  it('refuses a Google account that is not the admin', async () => {
    state.claims = { email: 'someone@example.com', email_verified: true };
    const response = await callbackRequest('code=abc&state=expected-state');
    expect(response.headers.get('location')).toBe('/fr/login?error=google_not_allowed');
    expect(state.sessions).toEqual([]);
    expect(state.failures).toBe(1);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('someone@example.com');
  });

  it('refuses an account outside the allowed domain', async () => {
    state.env = loadEnv({ ...GOOGLE_ENV, OPSWATCH_GOOGLE_ALLOWED_DOMAIN: 'example.com' });
    state.claims = { email: 'a@example.com', email_verified: true, hd: 'elsewhere.com' };
    const response = await callbackRequest('code=abc&state=expected-state');
    expect(response.headers.get('location')).toBe('/fr/login?error=google_not_allowed');
  });

  it('refuses everyone before an admin exists', async () => {
    state.admin = undefined;
    const response = await callbackRequest('code=abc&state=expected-state');
    expect(response.headers.get('location')).toBe('/fr/login?error=google_not_allowed');
  });
});
