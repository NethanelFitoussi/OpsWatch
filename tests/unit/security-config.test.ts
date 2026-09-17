import { afterEach, describe, expect, it, vi } from 'vitest';
import { SECURITY_HEADERS, serverActionAllowedOrigins } from '@/lib/http/public-host';
import nextConfig from '../../next.config';

describe('serverActionAllowedOrigins', () => {
  it('is empty without a public URL', () => {
    expect(serverActionAllowedOrigins(undefined)).toEqual([]);
  });

  it('holds the host (with its port) of the public URL', () => {
    expect(serverActionAllowedOrigins('https://ops.example.com')).toEqual(['ops.example.com']);
    expect(serverActionAllowedOrigins('https://ops.example.com:8443/base')).toEqual(['ops.example.com:8443']);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('next.config', () => {
  it('adds no Server Actions setting without OPSWATCH_PUBLIC_URL', async () => {
    vi.stubEnv('OPSWATCH_PUBLIC_URL', '');
    vi.resetModules();
    const { default: config } = await import('../../next.config');
    expect(config.experimental?.serverActions).toBeUndefined();
  });

  it('allows Server Actions from the host of OPSWATCH_PUBLIC_URL', async () => {
    vi.stubEnv('OPSWATCH_PUBLIC_URL', 'https://ops.example.com');
    vi.resetModules();
    const { default: config } = await import('../../next.config');
    expect(config.experimental?.serverActions?.allowedOrigins).toEqual(['ops.example.com']);
  });

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
