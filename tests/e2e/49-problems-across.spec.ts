import { expect, test } from '@playwright/test';
import { login } from './helpers';

/**
 * What is wrong anywhere (§G).
 *
 * The monitoring rail answers "what is wrong in this account and this region", which is right once
 * you know where to look. An operator with several connections has to know where to look before they
 * can ask, so the answer depends on where they started. This page is the other question — and the
 * thing it must not do in answering it is flatten the clouds into one undifferentiated list.
 */

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('THE RULING: it is reachable without picking a connection first', async ({ page }) => {
  // In the rail it would carry a connection and a region, which is the assumption it exists to remove.
  await page.goto('/en/accounts');
  const link = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Problems' });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/en\/problems$/);
  await expect(page.locator('main')).toContainText('What is wrong anywhere OpsWatch is connected');
});

test('THE RULING: every row names the cloud that produced it', async ({ page }) => {
  /*
   * The whole point of a unified list is that it stays usable, and it stops being usable the moment
   * it stops saying where each line came from. "The payments database is at 98 % CPU" and "Google has
   * an open incident on checkout" are fixed in different places by different people.
   */
  await page.goto('/en/problems');
  const main = await page.locator('main').innerText();

  expect(main).toContain('What is wrong anywhere OpsWatch is connected');
  // The seeded estate is AWS, so every row says so, and each carries the region it is in.
  expect(main).toContain('AWS');
  expect(main).toMatch(/region us-east-1/);
  // Read from what the collector wrote, which is why the page is instant and free.
  expect(main).toContain('costs no provider request');
});

test('THE RULING: counting is of everything, so filtering does not move the numbers', async ({ page }) => {
  await page.goto('/en/problems');
  const filters = page.getByRole('navigation', { name: 'Filter problems by cloud' });
  await expect(filters).toBeVisible();

  const before = await filters.getByRole('link', { name: /^All \(\d+\)$/ }).innerText();
  // A cloud with connections but nothing collected: the list empties, the counts do not.
  await filters.getByRole('link', { name: /^Google Cloud \(\d+\)$/ }).click();
  await expect(page).toHaveURL(/provider=gcp/);

  const filtered = await page.locator('main').innerText();
  expect(filtered).toContain('Nothing is open for this cloud');
  // And the sentence that stops an empty list reading as reassurance.
  expect(filtered).toContain('A connection nothing has been read from contributes no rows here');
  expect(filtered).toContain('which is not the same as it being well');
  expect(await page.getByRole('link', { name: /^All \(\d+\)$/ }).innerText()).toBe(before);
});

test('it reads in French and at 360 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/fr/problems');
  const main = await page.locator('main').innerText();
  expect(main).toContain('Ce qui ne va pas partout');
  expect(main).not.toMatch(/Problems\./);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('THE RULING: a problem from any cloud opens on one page', async ({ page }) => {
  /*
   * The AWS section page has the diagnosis, the investigation and the workspace, all reading
   * AWS-shaped rows. This page is a deliberate subset — what a problem row and its evidence carry
   * whichever cloud produced them — and it *offers* the fuller one rather than cloning it under
   * generic names, which is the failure this whole piece of work exists to avoid.
   */
  await page.goto('/en/problems');
  const first = page.locator('main table tbody tr').first();
  await expect(first).toBeVisible();
  await first.getByRole('link').first().click();
  await expect(page).toHaveURL(/\/en\/problems\/[0-9a-f]+$/);

  const main = await page.locator('main').innerText();
  // The four questions an operator asks first, in the order they ask them.
  expect(main).toContain('What happened');
  expect(main).toContain('First seen');
  expect(main).toContain('Evidence');
  expect(main).toContain('How this was ranked');
  // The seeded estate is AWS, so the fuller page is offered rather than reproduced here.
  expect(main).toContain('Open the full page for this problem');
  await page.getByRole('link', { name: 'Open the full page for this problem' }).click();
  await expect(page).toHaveURL(/\/c\/[0-9a-f]+\/us-east-1\/overview\/problems\//);
});

test('a problem that does not exist is absent, not an error', async ({ page }) => {
  await page.goto('/en/problems/deadbeefdeadbeef');
  await expect(page.locator('main')).toContainText('Page not found');
});
