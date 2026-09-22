import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

/**
 * Walks the *running* instance as a signed-in user and records what is on screen. Unlike nav-walk this one
 * signs in with credentials supplied at run time, so it can be pointed at a real installation rather than
 * only at the test stack.
 */
const OUT = process.env.OPSWATCH_AUDIT_OUT ?? 'live-check.json';
const EMAIL = process.env.OPSWATCH_EMAIL ?? '';
const PASSWORD = process.env.OPSWATCH_PASSWORD ?? '';
const report: Record<string, unknown>[] = [];

test.setTimeout(300_000);

async function shot(page: Page, label: string, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(600);
  const main = await page.locator('main').first().innerText().catch(() => '');
  const file = `live-${label.replace(/\W+/g, '-').toLowerCase()}.png`;
  await page.screenshot({ path: file, fullPage: true }).catch(() => undefined);
  report.push({
    label,
    requested: path,
    landedOn: new URL(page.url()).pathname,
    screenshot: file,
    main: main.replace(/\s+/g, ' ').trim(),
  });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
  console.log(`[${label}] -> ${new URL(page.url()).pathname}`);
}

test('walk the live instance', async ({ page }) => {
  await page.goto('/en/login', { waitUntil: 'domcontentloaded' });
  if (page.url().includes('/setup')) {
    console.log('NO ADMIN on this instance');
    return;
  }
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/en\/accounts$/, { timeout: 20_000 });
  console.log('signed in');

  const environments = await page.request.get('/api/v1/environments').then((r) => r.json());
  const first = (environments.items ?? [])[0]?.id as string | undefined;
  console.log('environments:', JSON.stringify(environments.items ?? []));
  expect(first, 'the instance has at least one environment').toBeTruthy();
  const base = `/en/c/${first!.split(':')[0]}/${first!.split(':').slice(1).join(':')}`;

  await shot(page, 'Morning brief', `${base}/overview/brief`);
  await shot(page, 'Health', `${base}/overview/health`);
  await shot(page, 'Problems', `${base}/overview/problems`);
  await shot(page, 'System status', '/en/settings/status');
});
