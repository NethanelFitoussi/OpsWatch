import { expect, test } from '@playwright/test';
import { login } from './helpers';

// What the Next.js client sends when it already shows /en/accounts/new: the (app) layout is
// mounted, so a navigation to /en/accounts only asks the server for the page segment.
type RouterNode = [string | [string, string, string, null], Record<string, RouterNode>];
const segment = (name: RouterNode[0], child?: RouterNode): RouterNode => [name, child ? { children: child } : {}];
const ROUTER_STATE_TREE = encodeURIComponent(
  JSON.stringify(
    segment('', segment(['locale', 'en', 'd', null], segment('(app)', segment('accounts', segment('new', segment('__PAGE__')))))),
  ),
);
const RSC_HEADERS = { RSC: '1', 'Next-Router-State-Tree': ROUTER_STATE_TREE };

test('an RSC request without a session leaks no connection data', async ({ page, playwright, baseURL }) => {
  await login(page);
  await page.getByRole('link', { name: /Moto role/ }).first().click();
  await expect(page).toHaveURL(/\/en\/accounts\/[0-9a-f]{12}$/);
  const externalId = (await page.locator('pre').first().textContent())?.trim() ?? '';
  const roleArn = await page.getByLabel('Role ARN').inputValue();
  expect(externalId).toMatch(/\S{16,}/);
  expect(roleArn).toContain(':role/OpsWatchReadOnly-');

  // Control: with the session cookie, the same request returns the page data.
  const signedIn = await page.request.get('/en/accounts', { headers: RSC_HEADERS });
  expect(await signedIn.text()).toContain('Moto role');

  const anonymous = await playwright.request.newContext({ baseURL });
  const response = await anonymous.get('/en/accounts', { headers: RSC_HEADERS });
  const body = await response.text();
  for (const secret of ['Moto role', 'Moto keys', '123456789012', externalId, roleArn]) {
    expect(body).not.toContain(secret);
  }
  const detail = await anonymous.get(page.url().replace(/^https?:\/\/[^/]+/, ''), { headers: RSC_HEADERS });
  const detailBody = await detail.text();
  for (const secret of ['Moto role', externalId, roleArn]) {
    expect(detailBody).not.toContain(secret);
  }
  await anonymous.dispose();
});

test('pages refuse to be framed', async ({ request }) => {
  for (const path of ['/en/getting-started', '/en/login']) {
    const response = await request.get(path);
    expect(response.headers()['x-frame-options']).toBe('DENY');
    expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  }
});

test('the template link sends a signed-out browser to the login page', async ({ page }) => {
  await page.goto('/api/connections/abc123def456/template');
  await expect(page).toHaveURL(/\/en\/login$/);
});

test('an unknown connection shows a localized not found page', async ({ page }) => {
  await login(page);
  await page.goto('/en/accounts/000000000000');
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await page.goto('/fr/accounts/000000000000');
  await expect(page.getByRole('heading', { level: 1, name: 'Page introuvable' })).toBeVisible();
});

test.describe('at 360 px wide', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  async function expectNoHorizontalScroll(page: import('@playwright/test').Page) {
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  }

  test('the getting started guide fits', async ({ page }) => {
    await page.goto('/en/getting-started');
    await expectNoHorizontalScroll(page);
  });

  test('the signed-in accounts page fits and the menu can sign out', async ({ page }) => {
    await login(page);
    await expectNoHorizontalScroll(page);
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/en\/login$/);
  });
});
