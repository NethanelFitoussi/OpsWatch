import { expect, test } from '@playwright/test';
import { ADMIN, login } from './helpers';

/**
 * Settings → Audit log (§21).
 *
 * The acceptance criterion is that the log records the thing worth recording: a *failed* sign-in. A log
 * holding only successes cannot answer "did somebody try and fail, repeatedly, at three in the morning?",
 * which is the question an audit log exists for.
 */

test('the audit log needs a session', async ({ page }) => {
  await page.goto('/en/settings/audit');
  await expect(page).toHaveURL(/\/en\/login$/);
});

test('Settings links to it', async ({ page }) => {
  await login(page);
  await page.goto('/en/settings');
  await page.getByRole('link', { name: 'Audit log' }).click();
  await expect(page).toHaveURL(/\/en\/settings\/audit$/);
});

test('§21 — the page states what makes the log evidence', async ({ page }) => {
  await login(page);
  await page.goto('/en/settings/audit');
  const main = await page.locator('body').innerText();
  expect(main).toContain('Entries are only ever added');
  expect(main).toContain('not even the retention pass');
  // And what it deliberately does not keep.
  expect(main).toContain('never the browser string itself');
  expect(main).toContain('never holds a password, a token or the text of a question');
});

test('THE RULING: a failed sign-in is recorded, not only a successful one', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/en/login');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill('definitely not the password');
  await page.getByRole('button', { name: /sign in/i }).click();
  // It must fail; we are recording the failure, not creating a session.
  await expect(page).toHaveURL(/\/login/);

  await login(page);
  await page.goto('/en/settings/audit');
  const main = await page.locator('body').innerText();
  expect(main).toContain('Signed in');
  // Both outcomes present: the refusal is the half that matters.
  expect(main).toContain('Refused');
  expect(main).toContain('Succeeded');
});

test('§21 — the user agent is never shown, only a short hash stands in for the device', async ({ page }) => {
  await login(page);
  await page.goto('/en/settings/audit');
  const html = await page.content();
  // The browser string would be a record of somebody's device kept forever.
  expect(html).not.toContain('Mozilla/5.0');
  expect(html).not.toContain('AppleWebKit');
});

test('the audit log renders at 360px without horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page);
  await page.goto('/en/settings/audit');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('§21 — an administrator action records itself, and a refusal is distinguishable', async ({ page }) => {
  await login(page);

  // A refusal: an invalid repository owner.
  await page.goto('/en/settings/repositories');
  await page.getByLabel('Owner').fill('not a valid owner!!');
  await page.getByLabel('Repository', { exact: true }).fill('x');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('An owner may contain letters', { exact: false })).toBeVisible();

  // A success: a valid one.
  await page.getByLabel('Owner').fill('acme');
  await page.getByLabel('Repository', { exact: true }).fill('audited');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.goto('/en/settings/audit');
  const main = await page.locator('body').innerText();
  expect(main).toContain('Repository changed');
  // Both outcomes, so a reviewer can tell an attempt that was turned away from one that worked.
  expect(main).toContain('Refused');
  expect(main).toContain('Succeeded');

  // Left as found.
  await page.goto('/en/settings/repositories');
  await page.getByRole('button', { name: 'Remove' }).first().click();
  await expect(page.getByText('No repository has been added yet')).toBeVisible();
});
