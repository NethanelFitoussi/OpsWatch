import { defineConfig } from '@playwright/test';

/**
 * Store screenshot capture, at the exact pixel sizes each store accepts.
 *
 * Playwright renders CSS pixels and multiplies by the device scale factor, so each project is chosen to land on a
 * store size exactly: 360×640 at 3× is 1080×1920, and 430×932 at 3× is 1290×2796 — which is also the real logical
 * size of a 6.9-inch iPhone, so the layout is the one that device would produce.
 *
 * **What this is and is not.** A web render of a React Native app is the same JavaScript, the same components and the
 * same layout engine, so it catches clipping, truncation and spacing faithfully. It is *not* an iOS simulator
 * capture: there is no iOS status bar, no Dynamic Island, and no native navigation chrome. Google Play assets are
 * therefore taken from a real Android emulator instead (`npm run store:android`), and the Apple renders here are
 * layout previews for review — the assets Apple receives must be generated on macOS, exactly as
 * docs/mobile/store-assets.md describes.
 */
export default defineConfig({
  testDir: '.',
  outputDir: '../../test-results/store',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4021', trace: 'off' },
  webServer: {
    command: 'node e2e/web/static-server.mjs dist-web 4021',
    cwd: '../..',
    url: 'http://127.0.0.1:4021',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    // Apple: 6.9-inch (iPhone 16 Pro Max class), the size App Store Connect requires for iPhone.
    { name: 'apple-6.9', use: { viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
    // Apple: 6.5-inch, still accepted and useful for checking a shorter screen.
    { name: 'apple-6.5', use: { viewport: { width: 414, height: 896 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
    // Google Play phone: 1080×1920, a 9:16 ratio inside Play's accepted range.
    { name: 'play-phone', use: { viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  ],
});
