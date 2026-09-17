// Captures the README screenshots from a running test stack whose end-to-end suite has just run.
// Usage: docker compose -f docker-compose.test.yml up -d --build --wait && npm run e2e && npx tsx scripts/screenshots.ts
import { chromium } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3100';
const outDir = 'docs/screenshots';

async function main() {
  const browser = await chromium.launch();
  for (const colorScheme of ['light', 'dark'] as const) {
    const page = await browser.newPage({ baseURL, colorScheme, viewport: { width: 1440, height: 900 } });
    await page.goto('/en/getting-started');
    await page.screenshot({ path: `${outDir}/getting-started-${colorScheme}.png` });
    // The step-by-step area: bring step 0 to the top of the viewport and capture what is visible.
    await page.locator('#step-0').evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: `${outDir}/guide-steps-${colorScheme}.png` });
    await page.close();
  }

  const page = await browser.newPage({ baseURL, viewport: { width: 1440, height: 900 } });
  await page.goto('/en/login');
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/en\/accounts$/);
  await page.getByRole('link', { name: 'Moto role' }).click();
  await page.waitForURL(/\/en\/accounts\/[0-9a-f]{12}$/);
  await page.getByText('Connected', { exact: true }).waitFor();
  await page.screenshot({ path: `${outDir}/connection.png`, fullPage: true });
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
