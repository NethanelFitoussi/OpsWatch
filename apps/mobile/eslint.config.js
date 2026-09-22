// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'dist-web/*', 'coverage/*', 'playwright-report/*', 'test-results/*', '.expo/*'],
  },
  {
    rules: {
      // Every network call goes through src/api/http.ts, which validates and normalises errors.
      'no-restricted-globals': ['error', { name: 'fetch', message: 'Use the OpsWatch client (src/api) instead of fetch.' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['src/api/http.ts', 'dev/**', 'e2e/**', '**/*.test.ts', '**/*.test.tsx', 'jest.setup.ts'],
    rules: { 'no-restricted-globals': 'off', 'no-console': 'off' },
  },
]);
