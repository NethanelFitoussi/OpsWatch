import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      'server-only': path.resolve(import.meta.dirname, 'tests/stubs/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    restoreMocks: true,
    server: {
      // next-intl's middleware imports `next/server` without an extension;
      // Next.js's own bundler resolves that fine, but Node's native ESM
      // resolver (used for externalized deps) does not. Inlining forces Vite
      // to transform and resolve it instead.
      deps: { inline: [/next-intl/] },
    },
  },
});
