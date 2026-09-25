import { expect, test } from '@playwright/test';
import { ADMIN, createConnection, login } from './helpers';

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

test('THE RULING: with two accounts connected, the log says which one, and can be read one at a time', async ({ page }) => {
  /*
   * `connection_create`, `connection_delete`, `connection_test` and `credential_rotate` were all in the
   * audit log's vocabulary and not one of them was ever written. Connecting an AWS account, testing it
   * with somebody's credential and removing it — which deletes every problem, alert and log source that
   * account produced — left no row at all. And with more than one account connected, a row that does not
   * name its account is not reviewable.
   */
  await login(page);
  const first = await createConnection(page, 'ambient', 'Audit account one');
  await page.getByRole('button', { name: 'Run test' }).click();
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 30_000 });
  const second = await createConnection(page, 'ambient', 'Audit account two');

  // Read from the table, not from `main`: the filter row names every account by design, so a page-wide
  // search would answer "is this name on the page" and never "is this row in the log".
  const rows = () => page.getByRole('table').innerText();

  await page.goto('/en/settings/audit');
  const all = await rows();
  expect(all).toContain('AWS account connected');
  expect(all).toContain('AWS connection tested');
  expect(all).toContain('Audit account one');
  expect(all).toContain('Audit account two');

  // One account at a time, which is the question somebody reviewing an account actually asks.
  await page.getByRole('link', { name: 'Audit account two' }).click();
  // The filter is in the URL, so wait for it rather than for the table to happen to have re-rendered.
  await expect(page).toHaveURL(/[?&]connection=[0-9a-f]+/);
  const only = await rows();
  expect(only).toContain('Audit account two');
  expect(only).not.toContain('Audit account one');

  // And the actions that belong to no account are a separate question, not a missing filter.
  await page.getByRole('link', { name: 'This installation only' }).click();
  await expect(page).toHaveURL(/[?&]connection=instance/);
  const instance = await rows();
  expect(instance).toContain('Signed in');
  expect(instance).not.toContain('AWS account connected');

  // Removing an account leaves its rows behind: a log that vanishes with its subject is not evidence.
  await page.goto(`/en/accounts/${second}`);
  await page.getByRole('button', { name: 'Remove connection' }).click();
  await page.goto('/en/settings/audit');
  const after = await rows();
  expect(after).toContain('AWS account removed');
  expect(after).toContain('A removed account');

  await page.goto(`/en/accounts/${first}`);
  await page.getByRole('button', { name: 'Remove connection' }).click();
});
