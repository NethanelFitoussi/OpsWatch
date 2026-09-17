import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  globalSetup: './global-setup.ts',
  // The specs share one fresh stack and run in file order: 01 creates the admin, 03 the "Moto role"
  // and "Moto keys" connections that later tests in 03 and 04 open. Run the whole suite, in order.
  // The global setup resets moto and seeds the resources of 05–07 (tests/e2e/seed/moto-seed.ts).
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../../playwright-report' }]],
  outputDir: '../../test-results',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3100',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
