import { expect, test } from '@playwright/test';
import { login } from './helpers';

/**
 * The optional AI provider (AI-2, AI-3).
 *
 * Two acceptance criteria, and the second is the one worth a browser. AI is **off by default and OpsWatch
 * is whole without it**. And a key, once saved, never comes back — not in a field, not in the HTML, not in
 * a script payload, not in an error.
 */

const KEY = 'sk-e2e-secret-key-value-0123456789';

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('Settings links to it, and says it is optional before asking for anything', async ({ page }) => {
  await page.goto('/en/settings');
  await expect(page.getByRole('link', { name: 'AI provider' })).toBeVisible();

  await page.getByRole('link', { name: 'AI provider' }).click();
  await expect(page).toHaveURL(/\/settings\/ai$/);
  const main = await page.locator('main').innerText();
  expect(main).toContain('OpsWatch is complete without it');
  expect(main).toContain('No AI provider is configured');
  expect(main).toContain('Nothing is sent anywhere until one is');
});

test('§2.2 — the page states what a model may and may not do, where the decision is made', async ({ page }) => {
  await page.goto('/en/settings/ai');
  const main = await page.locator('main').innerText();
  expect(main).toContain('It never decides');
  expect(main).toContain('never a database dump, never raw logs');
  expect(main).toContain('kept visibly apart from observed facts and correlations');
  expect(main).toContain('It cannot change your infrastructure or your code');
});

test('THE RULING: a saved key never comes back to the browser', async ({ page }) => {
  await page.goto('/en/settings/ai');
  await page.getByLabel('Model').fill('claude-sonnet-5');
  await page.getByLabel('API key').fill(KEY);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved. It has not been tested yet.')).toBeVisible();

  await page.reload();
  // Not in the rendered document, not in a script payload, not as a field value.
  expect(await page.content()).not.toContain(KEY);
  await expect(page.getByLabel('API key')).toHaveValue('');
  await expect(page.getByLabel('API key')).toHaveAttribute('placeholder', 'Stored — leave blank to keep it');

  // And the API says nothing about it either.
  const info = await page.request.get('/api/v1/server').then((r) => r.json());
  expect(JSON.stringify(info)).not.toContain(KEY);
});

test('THE RULING: a saved key is reported as untested, never as connected', async ({ page }) => {
  // Saves its own key rather than inheriting one: a test that depends on an earlier test's leftovers
  // passes or fails for reasons that have nothing to do with what it is about.
  await page.goto('/en/settings/ai');
  await page.getByLabel('Model').fill('claude-sonnet-5');
  await page.getByLabel('API key').fill(KEY);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved. It has not been tested yet.')).toBeVisible();

  const main = await page.locator('main').innerText();
  // The badge is upper-cased by the style sheet, and `innerText` returns what is rendered.
  expect(main).toMatch(/saved, not tested/i);
  expect(main).toContain('A saved key is not a working key');
  expect(main).not.toMatch(/\bconnected\b/i);
  // And the capability stays false, because a stored key is not something a client can use.
  const info = await page.request.get('/api/v1/server').then((r) => r.json());
  expect(info.features.ai).toBe(false);

  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.locator('main')).toContainText('No AI provider is configured');
});

test('a test against an unreachable provider says so as a code, not as the provider’s words', async ({ page }) => {
  await page.goto('/en/settings/ai');
  await page.getByLabel('Model').fill('claude-sonnet-5');
  await page.getByLabel('API key').fill(KEY);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved. It has not been tested yet.')).toBeVisible();

  await page.getByRole('button', { name: 'Test connection' }).click();
  // There is no real provider in the test stack; whatever happened, the page shows one of its own sentences.
  await expect(page.locator('main')).toContainText(/provider|OpsWatch refused/i);
  expect(await page.content()).not.toContain(KEY);

  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.locator('main')).toContainText('No AI provider is configured');
});

test('disconnecting deletes the key and returns the page to its default', async ({ page }) => {
  await page.goto('/en/settings/ai');
  await page.getByLabel('Model').fill('claude-sonnet-5');
  await page.getByLabel('API key').fill(KEY);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved. It has not been tested yet.')).toBeVisible();

  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByText('Disconnected. The key has been deleted.')).toBeVisible();
  await expect(page.locator('main')).toContainText('No AI provider is configured');
});

test('§21 — configuring a provider is recorded in the audit log', async ({ page }) => {
  await page.goto('/en/settings/ai');
  await page.getByLabel('Model').fill('claude-sonnet-5');
  await page.getByLabel('API key').fill(KEY);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved. It has not been tested yet.')).toBeVisible();

  await page.goto('/en/settings/audit');
  await expect(page.locator('main')).toContainText('AI provider changed');
  // The audit log holds what happened, never the key it happened to.
  expect(await page.content()).not.toContain(KEY);

  // Left as it was found.
  await page.goto('/en/settings/ai');
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.locator('main')).toContainText('No AI provider is configured');
});

test('an endpoint OpsWatch would refuse to call is refused at save time', async ({ page }) => {
  await page.goto('/en/settings/ai');
  await page.getByLabel('Provider').selectOption('openai-compatible');
  await page.getByLabel('Endpoint').fill('http://169.254.169.254/latest');
  await page.getByLabel('Model').fill('llama-3.3-70b');
  await page.getByLabel('API key').fill(KEY);
  await page.getByRole('button', { name: 'Save' }).click();
  // Refused before it is stored, so it never sits in the database looking configured.
  await expect(page.getByText('must be an https address', { exact: false })).toBeVisible();
  await expect(page.locator('main')).toContainText('No AI provider is configured');
});

test('the AI settings page renders at 360px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/en/settings/ai');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('§E — the Integrations page says what each connection enables and what access it asks for', async ({ page }) => {
  await page.goto('/en/settings');
  await page.getByRole('link', { name: 'Integrations' }).click();
  await expect(page).toHaveURL(/\/settings\/integrations$/);

  const main = await page.locator('main').innerText();
  // Every integration is listed, connected or not, so a reader can see what the product can become.
  for (const name of ['AWS', 'GitHub', 'AI provider', 'Cloudflare', 'Google sign-in']) {
    expect(main, name).toContain(name);
  }
  // What OpsWatch is allowed to do, beside the button that would grant it.
  expect(main).toContain('OpsWatch does not deploy, does not scale, does not roll back');
  expect(main).toContain('never needs write access to investigate');
  expect(main).toContain('never a database dump or raw logs');
  // Every one here is connectable, so every card offers a way in. The pairing — available means there is
  // somewhere to land, unavailable means no link at all — is enforced by roadmap:check and a unit test,
  // which is where it belongs: this page would otherwise need a build with an unavailable integration.
  expect(main).not.toMatch(/not available in this build/i);
  expect(main).toMatch(/not connected/i);
});

test('THE RULING: a saved AI key shows as needing attention on the Integrations page, never as connected', async ({ page }) => {
  await page.goto('/en/settings/ai');
  await page.getByLabel('Model').fill('claude-sonnet-5');
  await page.getByLabel('API key').fill(KEY);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved. It has not been tested yet.')).toBeVisible();

  await page.goto('/en/settings/integrations');
  await expect(page.locator('main')).toContainText('saved, not tested');
  // And no credential reaches the page that summarises every credential.
  expect(await page.content()).not.toContain(KEY);

  await page.goto('/en/settings/ai');
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.locator('main')).toContainText('No AI provider is configured');
});
