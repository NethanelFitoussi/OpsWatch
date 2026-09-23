import { expect, test } from '@playwright/test';
import { MOTO_REGION, ensureMonitoringConnection, login, monitoringUrl } from './helpers';

/**
 * Ask OpsWatch (§23, AI-5).
 *
 * The acceptance criterion is the one §2.2 turns on: the assistant is **optional**, and when it is absent
 * the product says so rather than hiding or pretending. The second is that an answer is never dressed as a
 * measurement — it appears under a heading that calls it a hypothesis, beside what it was built from.
 */

let connectionId = '';

test.beforeEach(async ({ page }) => {
  await login(page);
  connectionId = await ensureMonitoringConnection(page);
});

const url = () => monitoringUrl(connectionId, 'overview', 'ask');

test('the Overview menu links to Ask OpsWatch, and it sits after the measured surfaces', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'overview', 'problems'));
  const nav = page.getByRole('navigation', { name: 'Overview pages' });
  await expect(nav.getByRole('link', { name: 'Ask OpsWatch' })).toBeVisible();

  // §2.2: deterministic first, assistant last. The menu order says so.
  const entries = await nav.getByRole('link').allInnerTexts();
  expect(entries[entries.length - 1]).toContain('Ask OpsWatch');
});

test('THE RULING: with no provider configured the page says so and offers no button', async ({ page }) => {
  await page.goto(url());
  const main = await page.locator('main').innerText();
  expect(main).toContain('No AI provider is configured');
  expect(main).toContain('Every other page works without one');
  // A disabled button invites a click that can only fail, so there is none at all.
  await expect(page.getByRole('button', { name: 'Ask' })).toHaveCount(0);
});

test('§23 — the page states what is sent, before anything is sent', async ({ page }) => {
  await page.goto(url());
  const main = await page.locator('main').innerText();
  expect(main).toContain('only the last 24 hours of what OpsWatch recorded');
  expect(main).toContain('nothing else is');
  // And what the answer will be worth.
  expect(main).toContain('The answer is a hypothesis');
  expect(main).toContain('so you can check it rather than believe it');
});

test('the capability is advertised, and the endpoint needs a session', async ({ page, request }) => {
  const info = await page.request.get('/api/v1/server').then((r) => r.json());
  // Implemented, and off until a provider is connected and tested — two halves, one flag.
  expect(info.features.ai).toBe(false);
  expect((await request.post('/api/v1/ai/ask', { data: { question: 'hello' } })).status()).toBe(401);
});

test('asking with no provider configured answers not found rather than pretending it tried', async ({ page }) => {
  const response = await page.request.post(`/api/v1/ai/ask?env=${connectionId}:${MOTO_REGION}`, {
    data: { question: 'what is wrong?' },
  });
  expect(response.status()).toBe(404);
});

test('a question that is not a question is refused', async ({ page }) => {
  const response = await page.request.post(`/api/v1/ai/ask?env=${connectionId}:${MOTO_REGION}`, { data: { question: 42 } });
  expect(response.status()).toBe(400);
});

test('Ask OpsWatch renders at 360px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(url());
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
