import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { SECURITY_HEADERS, serverActionAllowedOrigins } from './src/lib/http/public-host';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3', '@node-rs/argon2'],
  // Read when the config is evaluated (at build time for the standalone Docker image);
  // src/proxy.ts applies the same rule at run time.
  experimental: {
    serverActions: { allowedOrigins: serverActionAllowedOrigins(process.env.OPSWATCH_PUBLIC_URL) },
  },
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default createNextIntlPlugin('./src/i18n/request.ts')(nextConfig);
