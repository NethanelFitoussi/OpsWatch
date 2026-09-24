import { expect, test } from '@playwright/test';
import { login } from './helpers';

/**
 * Backup and restore (HIS-10, §F).
 *
 * The acceptance criterion is that an operator can answer four questions without leaving the page: where
 * is my data, what has been backed up, how do I take one now, and how do I put one back. And that the
 * page says the two uncomfortable things — a backup is the whole database, and it is useless without
 * `OPSWATCH_SECRET` — rather than burying them.
 */

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('the settings index links to Backup & restore, so the page is reachable', async ({ page }) => {
  await page.goto('/en/settings');
  await page.getByRole('link', { name: 'Backup & restore' }).click();
  await expect(page).toHaveURL(/\/en\/settings\/backup$/);
  await expect(page).toHaveTitle('Backup & restore · OpsWatch');
});

test('THE RULING: the page says what a backup contains and what it is useless without', async ({ page }) => {
  await page.goto('/en/settings/backup');
  const main = page.locator('main');
  await expect(main).toContainText('A backup is the whole database');
  // An operator who backs up the database and loses the secret has backed up something they cannot restore.
  await expect(main).toContainText('OPSWATCH_SECRET');
  await expect(main).toContainText('a restore will start with an instance that cannot reach AWS');
});

test('THE RULING: there is no restore button, and the procedure is given instead', async ({ page }) => {
  await page.goto('/en/settings/backup');
  const main = page.locator('main');
  // A running process cannot safely write over the database it has open.
  await expect(main.getByRole('button', { name: /restore/i })).toHaveCount(0);
  await expect(main).toContainText('OpsWatch does not do this for you');
  // The step that is easiest to miss and corrupts the restored database when it is.
  await expect(main).toContainText('Delete the -wal and -shm files');
});

test('a backup is taken on demand, appears in the list and can be downloaded', async ({ page }) => {
  await page.goto('/en/settings/backup');
  const main = page.locator('main');
  await main.getByRole('button', { name: 'Back up now' }).click();
  await expect(main).toContainText('Written: opswatch-');

  const link = main.getByRole('link', { name: 'Download' }).first();
  await expect(link).toBeVisible();
  const href = await link.getAttribute('href');
  const response = await page.request.get(href as string);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-disposition']).toContain('attachment');
  // A real SQLite file, not an error page with a 200 on it.
  expect((await response.body()).subarray(0, 15).toString('latin1')).toBe('SQLite format 3');
});

test('THE RULING: downloading a backup needs a session, and a name nobody listed is not a file', async ({ page, request }) => {
  await page.goto('/en/settings/backup');
  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect(page.locator('main')).toContainText('Written: opswatch-');

  // It is the whole database: an anonymous request gets 401, not a hint that the file exists.
  expect((await request.get('/api/backups/opswatch-2026-01-01T00-00-00Z-manual.sqlite')).status()).toBe(401);

  for (const name of ['..%2Fopswatch.sqlite', '%2Fetc%2Fpasswd', 'opswatch-does-not-exist.sqlite']) {
    expect((await page.request.get(`/api/backups/${name}`)).status(), name).toBe(404);
  }
});

test('§21 — taking and downloading a backup is recorded', async ({ page }) => {
  await page.goto('/en/settings/backup');
  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect(page.locator('main')).toContainText('Written: opswatch-');

  await page.goto('/en/settings/audit');
  await expect(page.locator('main')).toContainText('Export downloaded');
});

test('the backup page renders at 360px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/en/settings/backup');
  await expect(page.locator('main')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
