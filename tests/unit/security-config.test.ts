import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SECURITY_HEADERS, serverActionAllowedOrigins, withPublicHostForAction } from '@/lib/http/public-host';
import { proxy } from '@/proxy';
import nextConfig from '../../next.config';

function actionRequest(origin: string, extra: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/en/login', {
    method: 'POST',
    headers: { origin, host: 'localhost:3000', 'next-action': 'abc123', ...extra },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('serverActionAllowedOrigins', () => {
  it('is empty without a public URL', () => {
    expect(serverActionAllowedOrigins(undefined)).toEqual([]);
  });

  it('holds the host (with its port) of the public URL', () => {
    expect(serverActionAllowedOrigins('https://ops.example.com')).toEqual(['ops.example.com']);
    expect(serverActionAllowedOrigins('https://ops.example.com:8443/base')).toEqual(['ops.example.com:8443']);
  });
});

describe('withPublicHostForAction', () => {
  it('does nothing without a public URL', () => {
    expect(withPublicHostForAction(actionRequest('https://ops.example.com'), undefined)).toBeNull();
  });

  it('forwards the public host for a Server Action sent from the public origin', () => {
    const headers = withPublicHostForAction(actionRequest('https://ops.example.com'), 'https://ops.example.com');
    expect(headers?.get('x-forwarded-host')).toBe('ops.example.com');
  });

  it('ignores other origins, plain requests and requests already carrying the host', () => {
    expect(withPublicHostForAction(actionRequest('https://evil.example'), 'https://ops.example.com')).toBeNull();
    const plain = new NextRequest('http://localhost:3000/en/login', { headers: { origin: 'https://ops.example.com' } });
    expect(withPublicHostForAction(plain, 'https://ops.example.com')).toBeNull();
    const forwarded = actionRequest('https://ops.example.com', { 'x-forwarded-host': 'ops.example.com' });
    expect(withPublicHostForAction(forwarded, 'https://ops.example.com')).toBeNull();
  });
});

describe('proxy and Server Actions behind a reverse proxy', () => {
  it('passes the public host on to Next when OPSWATCH_PUBLIC_URL is set', () => {
    vi.stubEnv('OPSWATCH_PUBLIC_URL', 'https://ops.example.com');
    const res = proxy(actionRequest('https://ops.example.com'));
    expect(res.headers.get('x-middleware-request-x-forwarded-host')).toBe('ops.example.com');
  });

  it('leaves the request untouched when OPSWATCH_PUBLIC_URL is unset', () => {
    vi.stubEnv('OPSWATCH_PUBLIC_URL', '');
    const res = proxy(actionRequest('https://ops.example.com'));
    expect(res.headers.get('x-middleware-request-x-forwarded-host')).toBeNull();
  });
});

describe('next.config', () => {
  it('sends anti-framing headers on every route', async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toEqual([{ source: '/:path*', headers: SECURITY_HEADERS }]);
    expect(SECURITY_HEADERS).toEqual(
      expect.arrayContaining([
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        { key: 'X-Frame-Options', value: 'DENY' },
      ]),
    );
  });
});
