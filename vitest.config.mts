import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@opswatch/contract': path.resolve(import.meta.dirname, 'packages/contract/index.ts'),
      'server-only': path.resolve(import.meta.dirname, 'tests/stubs/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    restoreMocks: true,
    // Set explicitly (to its default) so Vitest does not print a caching hint when a cold run is slow.
    fsModuleCache: false,
    server: {
      // next-intl's middleware imports `next/server` without an extension;
      // Next.js's own bundler resolves that fine, but Node's native ESM
      // resolver (used for externalized deps) does not. Inlining forces Vite
      // to transform and resolve it instead.
      deps: { inline: [/next-intl/] },
    },
  },
});
