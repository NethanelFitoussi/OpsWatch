import { expect, test } from '@playwright/test';
import { login } from './helpers';

/**
 * Settings → Storage (§F).
 *
 * The question is "where is my data and will I lose it", and it used to be answered by three pages an
 * operator had to find and join up. What this checks is that the answer is here, and that the page does
 * not offer comfort it has not earned.
 */

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('THE RULING: Storage answers where the data is, and whether it survives a restart', async ({ page }) => {
  await page.goto('/en/settings');
  await page.getByRole('link', { name: 'Storage', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/settings\/storage$/);
  const main = page.locator('main');

  await expect(main).toContainText('SQLite, on the local filesystem');
  await expect(main).toContainText('/data');
  // The test stack mounts /data as a tmpfs, so the page must say the data will not survive — the exact
  // failure this warning exists for, and the one a reassuring default would hide.
  await expect(main).toContainText('Does not survive a restart');
  await expect(main).toContainText('Mount a volume at this path');
});

test('THE RULING: there is no migration button, and the page says why', async ({ page }) => {
  await page.goto('/en/settings/storage');
  const main = page.locator('main');

  // Migrations run at startup, after the database is copied. A button here would either do nothing or
  // invite somebody to change a schema from a browser, against a database this process has open.
  await expect(main).toContainText('Up to date');
  await expect(main).toContainText('after copying the database first');
  await expect(main).toContainText('No SQL from this page reaches the database');
  await expect(main.getByRole('button', { name: /migrat/i })).toHaveCount(0);
});

test('THE RULING: it offers one storage backend, because there is one', async ({ page }) => {
  await page.goto('/en/settings/storage');
  const main = page.locator('main');

  await expect(main).toContainText('This is the only place OpsWatch stores history');
  // Listing these as choices would be claiming support nobody has written, and an operator would plan
  // around it.
  await expect(main).not.toContainText('PostgreSQL');
  await expect(main).not.toContainText('Coming soon');
});

test('it says what is being kept, and what it means when nothing is', async ({ page }) => {
  await page.goto('/en/settings/storage');
  const main = page.locator('main');
  // History is off on a fresh installation, and a retention of "30 days" beside it would imply
  // something is being kept for thirty days.
  await expect(main).toContainText('Off — pages read AWS live and keep nothing');
  await expect(main).toContainText('Nothing is being kept');
});

test('Storage renders at 360px without horizontal overflow, in both locales', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const locale of ['en', 'fr'] as const) {
    await page.goto(`/${locale}/settings/storage`);
    await expect(page.locator('main')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, locale).toBeLessThanOrEqual(0);
  }
});
