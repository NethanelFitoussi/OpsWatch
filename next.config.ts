import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { SECURITY_HEADERS, serverActionAllowedOrigins } from './src/lib/http/public-host';

// Read when the config is evaluated (at build time for the standalone Docker image);
// src/proxy.ts applies the same rule at run time. Nothing is set without OPSWATCH_PUBLIC_URL.
const allowedOrigins = serverActionAllowedOrigins(process.env.OPSWATCH_PUBLIC_URL);

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3', '@node-rs/argon2'],
  ...(allowedOrigins.length > 0 ? { experimental: { serverActions: { allowedOrigins } } } : {}),
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default createNextIntlPlugin('./src/i18n/request.ts')(nextConfig);
