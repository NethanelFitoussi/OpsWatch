import { expect, test } from '@playwright/test';
import { login } from './helpers';

/**
 * Choosing what to connect (§E).
 *
 * "Add account" used to mean "add an AWS account". The acceptance criterion is that it asks now — and that
 * the chooser is a step in front of the existing flows rather than a second copy of them, so every card
 * lands on the page that already configures that provider.
 */

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('THE RULING: adding a connection asks what to connect before assuming AWS', async ({ page }) => {
  await page.goto('/en/accounts');
  await page.getByRole('link', { name: 'Add an account' }).click();
  await expect(page).toHaveURL(/\/en\/accounts\/new$/);

  const main = await page.locator('main').innerText();
  expect(main).toContain('Choose what to connect');
  for (const name of ['AWS', 'GitHub', 'Cloudflare', 'AI provider']) {
    expect(main, name).toContain(name);
  }
  // Read-only, said where the decision is made.
  expect(main).toContain('never writes to your code');
  expect(main).toContain('OpsWatch is complete without it');
});

test('THE RULING: Google is not offered as an account to connect', async ({ page }) => {
  await page.goto('/en/accounts/new');
  const main = await page.locator('main').innerText();
  // It is an authentication provider configured in the environment, and the page says so rather than
  // putting a Connect button beside AWS.
  expect(main).toContain('Google is an authentication provider, not something OpsWatch reads from');
  expect(main).toContain('configured in the environment rather than here');
});

test('AWS leads to the onboarding that already existed', async ({ page }) => {
  await page.goto('/en/accounts/new');
  // The AWS card is connected in this stack, so its action is "Manage" rather than "Connect".
  await page.getByRole('link', { name: 'Manage' }).first().click();
  await expect(page).toHaveURL(/\/en\/accounts(\/new\/aws)?$/);
});

test('GitHub, Cloudflare and AI lead to the pages that configure them', async ({ page }) => {
  for (const [name, url] of [
    ['GitHub', /\/settings\/repositories$/],
    ['Cloudflare', /\/settings\/cloudflare$/],
    ['AI provider', /\/settings\/ai$/],
  ] as const) {
    await page.goto('/en/accounts/new');
    // Scoped to the page body: the navigation rail is a list of `li` too.
    const card = page.locator('main li').filter({ hasText: name }).first();
    await card.getByRole('link').first().click();
    // One source of truth: the chooser reuses the existing flow rather than duplicating it.
    await expect(page, name).toHaveURL(url);
  }
});

test('going back from a provider returns to the chooser, and then to the connections list', async ({ page }) => {
  await page.goto('/en/accounts/new');
  await page.goto('/en/settings/ai');
  await page.goBack();
  await expect(page).toHaveURL(/\/en\/accounts\/new$/);

  await page.getByRole('link', { name: 'Back to connections' }).click();
  await expect(page).toHaveURL(/\/en\/accounts$/);
});

test('the connections list names the provider of each connection, and the others', async ({ page }) => {
  await page.goto('/en/accounts');
  const main = await page.locator('main').innerText();
  // Each AWS connection is badged, now that they are not all AWS.
  expect(main).toContain('AWS');
  expect(main).toContain('Other connections');
  expect(main).toContain('OpsWatch can read your repositories and your edge');
  await expect(page.getByRole('link', { name: 'See all integrations' })).toBeVisible();
});

test('THE RULING: every state is measured, so a settings form never makes something connected', async ({ page }) => {
  await page.goto('/en/accounts/new');

  // Accounts exist by this point, so AWS is connected or needs attention — never "available", which is
  // what a card would say if it were reading the catalogue rather than the instance. Which of the two it
  // is depends on how many of those accounts can currently be read, and the card says that too.
  const aws = page.locator('main li').filter({ hasText: 'AWS' }).first();
  await expect(aws).toContainText(/Connected|Needs attention/);
  await expect(aws).toContainText(/account(s)? connected|cannot be read right now/);

  // Cloudflare has a complete settings page and no credential, and says so: available, not connected.
  const cloudflare = page.locator('main li').filter({ hasText: 'Cloudflare' }).first();
  await expect(cloudflare).toContainText('Available');
  await expect(cloudflare).not.toContainText('Connected');
});

test('the chooser renders at 360px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/en/accounts/new');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('the connections list renders at 360px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/en/accounts');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
