import { expect, test } from '@playwright/test';
import { login } from './helpers';

/**
 * Get started (§D).
 *
 * Two acceptance criteria. The first screen asks **what** you want to connect rather than assuming AWS.
 * And the three places that talk about an integration — Get started, Accounts → Add, Settings →
 * Integrations — read one source, so they cannot contradict each other about what is connected.
 */

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('THE RULING: the first screen asks what to connect, rather than starting AWS setup', async ({ page }) => {
  await page.goto('/en/getting-started');
  const main = await page.locator('main').innerText();
  expect(main).toContain('Connect the systems you use');
  // Not "connect AWS to start using OpsWatch". AWS is one integration among several.
  expect(main).toContain('none of them is required');
  for (const name of ['AWS', 'GitHub', 'Cloudflare', 'AI provider']) {
    expect(main, name).toContain(name);
  }
  // And it is not the AWS guide wearing a different heading.
  expect(main).not.toContain('CloudFormation');
});

test('THE RULING: Google is not offered as something to connect here', async ({ page }) => {
  await page.goto('/en/getting-started');
  const main = await page.locator('main').innerText();
  expect(main).toContain('not something OpsWatch reads from');
  expect(main).toContain('configured in the environment');
});

test('each guide opens, and every action on it lands somewhere real', async ({ page }) => {
  for (const [id, setup] of [
    ['aws', /\/accounts\/new\/aws$/],
    ['github', /\/settings\/repositories$/],
    ['cloudflare', /\/settings\/cloudflare$/],
    ['ai', /\/settings\/ai$/],
  ] as const) {
    await page.goto(`/en/getting-started/${id}`);
    await expect(page.locator('main'), id).toBeVisible();
    // No raw message keys on the page: a missing section would render its key.
    expect(await page.locator('main').innerText(), id).not.toMatch(/GettingStarted\./);

    const cta = page.getByRole('link').filter({ hasText: /Connect|Configure|Manage|Set it up/ }).first();
    await cta.click();
    await expect(page, id).toHaveURL(setup);
  }
});

test('§13 — the GitHub guide shows the chain it now implements', async ({ page }) => {
  await page.goto('/en/getting-started/github');
  const main = await page.locator('main').innerText();
  for (const step of ['Service', 'Repository', 'Deployment', 'Commit', 'Changed files', 'Problem']) {
    expect(main, step).toContain(step);
  }
  // A guarantee the implementation can prove, not a promise.
  expect(main).toContain('contains no write request');
});

test('§2.2 — the AI guide shows the four bands and says AI is optional', async ({ page }) => {
  await page.goto('/en/getting-started/ai');
  const main = await page.locator('main').innerText();
  for (const band of ['Observed evidence', 'Correlations', 'AI hypothesis', 'Suggested investigation']) {
    expect(main, band).toContain(band);
  }
  expect(main).toContain('OpsWatch is complete without one');
  expect(main).toContain('It does not measure anything, decide anything, or change anything');
});

test('§20 — the Cloudflare guide walks token, verification, zones and the choice', async ({ page }) => {
  await page.goto('/en/getting-started/cloudflare');
  const main = await page.locator('main').innerText();
  for (const step of ['Token', 'Verification', 'Zones', 'Your choice']) {
    expect(main, step).toContain(step);
  }
  expect(main).toContain('Only the zones you tick are read');
});

test('THE RULING: Get started, Add connection and Integrations never disagree about what is connected', async ({ page }) => {
  // Each card carries its measured state as an attribute. The *words* differ by context on purpose —
  // a chooser says "Available" where a settings page says "Not connected" — but the state behind them
  // comes from one source, and comparing the attribute is how that invariant stays checkable.
  const read = async (url: string, id: string) => {
    await page.goto(url);
    return page.locator(`li[data-integration="${id}"]`).first().getAttribute('data-state');
  };

  for (const id of ['aws', 'github', 'cloudflare', 'ai']) {
    const hub = await read('/en/getting-started', id);
    const add = await read('/en/accounts/new', id);
    const settings = await read('/en/settings/integrations', id);
    expect(hub, id).not.toBeNull();
    expect([hub, add, settings], id).toEqual([hub, hub, hub]);
  }
});

test('a connected integration offers management rather than setup again', async ({ page }) => {
  await page.goto('/en/getting-started');
  const aws = page.locator('li').filter({ hasText: 'AWS' }).first();
  await expect(aws).toContainText(/Connected|Needs attention/);
  await expect(aws.getByRole('link', { name: 'Manage' })).toBeVisible();
});

test('the guides are reachable in French, with translated copy', async ({ page }) => {
  await page.goto('/fr/getting-started');
  const main = await page.locator('main').innerText();
  expect(main).toContain('Connectez les systèmes que vous utilisez');
  expect(main).not.toMatch(/GettingStarted\./);

  await page.goto('/fr/getting-started/ai');
  expect(await page.locator('main').innerText()).toContain('OpsWatch est complet sans');
});

test('going back from a guide returns to the hub', async ({ page }) => {
  await page.goto('/en/getting-started');
  await page.goto('/en/getting-started/cloudflare');
  await page.getByRole('link', { name: 'All guides' }).click();
  await expect(page).toHaveURL(/\/en\/getting-started$/);
});

test('the hub and a guide render at 360px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const url of ['/en/getting-started', '/en/getting-started/github', '/en/getting-started/ai']) {
    await page.goto(url);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, url).toBeLessThanOrEqual(0);
  }
});
