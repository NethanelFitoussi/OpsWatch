import { expect, test } from '@playwright/test';
import { login } from './helpers';

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('THE RULING: with no destination, the page says nothing leaves this instance', async ({ page }) => {
  await page.goto('/en/settings/notifications');
  await expect(page).toHaveTitle('Notifications · OpsWatch');
  await expect(page.locator('main')).toContainText('No destination yet, so no alert leaves this instance');
  // And it says what it would send, before anybody decides to point one at their systems.
  await expect(page.locator('main')).toContainText('alert.fired');
  await expect(page.locator('main')).toContainText('x-opswatch-signature');
});

test('THE RULING: a webhook must be HTTPS, with no credentials in the URL', async ({ page }) => {
  await page.goto('/en/settings/notifications');
  for (const url of ['http://example.com/hook', 'https://user:pass@example.com/hook', 'not-a-url']) {
    await page.getByLabel('Name', { exact: true }).fill('Ops');
    await page.getByLabel('URL', { exact: true }).fill(url);
    await page.getByRole('button', { name: 'Add destination' }).click();
    await expect(page.locator('main'), url).toContainText('Enter an HTTPS URL');
  }
  await expect(page.locator('main')).toContainText('No destination yet');
});

test('THE RULING: the signing secret is shown once and never again', async ({ page }) => {
  await page.goto('/en/settings/notifications');
  await page.getByLabel('Name', { exact: true }).fill('Ops on-call');
  await page.getByLabel('URL', { exact: true }).fill('https://example.invalid/opswatch');
  await page.getByRole('button', { name: 'Add destination' }).click();

  await expect(page.locator('main')).toContainText('Copy it now');
  const secret = await page.locator('main pre').last().innerText();
  expect(secret.length).toBeGreaterThan(20);

  // Reload: the destination is still there and the secret is gone from the page for good.
  await page.reload();
  await expect(page.locator('main')).toContainText('Ops on-call');
  expect(await page.locator('main').innerText()).not.toContain(secret);
  // And it is not hiding in the HTML either.
  expect(await page.content()).not.toContain(secret);
});

test('a destination that cannot be reached says so, and counts the failure', async ({ page }) => {
  await page.goto('/en/settings/notifications');
  await page.getByRole('button', { name: 'Send a test' }).first().click();
  // `.invalid` never resolves, by RFC. OpsWatch reports the class of failure, not the resolver's words.
  await expect(page.locator('main')).toContainText(/could not reach that URL|did not answer in time/);
  await page.reload();
  await expect(page.locator('main')).toContainText(/Last delivery failed/);
});

test('a destination can be switched off and removed', async ({ page }) => {
  await page.goto('/en/settings/notifications');
  await page.getByRole('button', { name: 'Disable' }).first().click();
  await expect(page.locator('main')).toContainText('Disabled');
  await page.getByRole('button', { name: 'Enable' }).first().click();
  await expect(page.locator('main')).toContainText('Enabled');
  await page.getByRole('button', { name: 'Delete' }).first().click();
  await expect(page.locator('main')).toContainText('No destination yet');
});

test('§21 — creating and testing a destination is recorded in the audit log', async ({ page }) => {
  await page.goto('/en/settings/audit');
  await expect(page.locator('main')).toContainText('Notification destination changed');
  await expect(page.locator('main')).toContainText('Notification destination tested');
});

test('the notifications page renders at 360px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/en/settings/notifications');
  await expect(page.locator('main')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
