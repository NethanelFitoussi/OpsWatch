import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke tests of the web export in demo mode, at representative phone and tablet sizes. They exercise real rendering
 * and navigation; native-only behaviour (secure storage, notifications) is covered by Jest and the Maestro flows.
 */
export default defineConfig({
  testDir: '.',
  outputDir: '../../test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: '../../playwright-report', open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4020', trace: 'retain-on-failure' },
  webServer: {
    command: 'node e2e/web/static-server.mjs dist-web 4020',
    cwd: '../..',
    url: 'http://127.0.0.1:4020',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'small-iphone', use: { ...devices['iPhone SE'], browserName: 'chromium' } },
    { name: 'iphone', use: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
    { name: 'large-iphone', use: { viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
    { name: 'tablet', use: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
    { name: 'dark', use: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: 'dark' } },
  ],
});
