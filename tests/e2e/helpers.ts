import { expect, type Page } from '@playwright/test';

export const ADMIN = { email: 'admin@example.com', password: 'correct horse battery staple' };
export const MOTO_ACCOUNT = '123456789012';

export async function login(page: Page) {
  await page.goto('/en/login');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/en\/accounts$/);
}

// Next.js's App Router always renders an empty `role="alert"` route
// announcer (`#__next-route-announcer__`) alongside our own alerts, so a
// plain `getByRole('alert')` is ambiguous on every page. This scopes to the
// alert the app actually renders.
export function alert(page: Page) {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)');
}

type RouterNode = [string | [string, string, string, null], Record<string, RouterNode>];

/**
 * Headers of a client-side navigation RSC request, as sent by a page already showing `segments`
 * (for example ['(app)', 'accounts', 'new']) under `/<locale>`. `Next-Router-State-Tree` is an
 * internal Next.js format, written against Next.js 16.3: check it when upgrading Next.js.
 */
export function rscHeaders(segments: string[], locale = 'en'): Record<string, string> {
  const node = (name: RouterNode[0], child?: RouterNode): RouterNode => [name, child ? { children: child } : {}];
  const leaf = [...segments].reverse().reduce<RouterNode>((child, name) => node(name, child), node('__PAGE__'));
  const tree = node('', node(['locale', locale, 'd', null], leaf));
  return { RSC: '1', 'Next-Router-State-Tree': encodeURIComponent(JSON.stringify(tree)) };
}

/** moto as published by docker-compose.test.yml; the OpsWatch container reaches it as http://moto:5000. */
export const MOTO_URL = process.env.E2E_MOTO_URL ?? 'http://localhost:5055';
/** The region of every e2e connection and of the seeded resources. */
export const MOTO_REGION = 'us-east-1';

/** Creates a connection through the wizard and returns its id, on its connection page. */
export async function createConnection(page: Page, method: 'role' | 'ambient' | 'keys', name: string, region = MOTO_REGION) {
  await page.goto('/en/accounts/new');
  // The radio inputs are visually hidden inside their card labels.
  await page.locator(`input[name="method"][value="${method}"]`).check({ force: true });
  await page.getByLabel('Connection name').fill(name);
  await page.getByLabel('AWS account ID').fill(MOTO_ACCOUNT);
  await page.getByRole('checkbox', { name: region }).click();
  await page.getByRole('button', { name: 'Create connection' }).click();
  await expect(page).toHaveURL(/\/en\/accounts\/[0-9a-f]{12}$/);
  return page.url().split('/').pop() as string;
}

export const MONITORING_CONNECTION = 'Moto monitoring';

/** The ambient connection the monitoring specs use, created and tested once per stack. */
export async function ensureMonitoringConnection(page: Page): Promise<string> {
  await page.goto('/en/accounts');
  const existing = page.getByRole('link', { name: new RegExp(MONITORING_CONNECTION) });
  if ((await existing.count()) > 0) {
    return ((await existing.first().getAttribute('href')) ?? '').split('/').pop() as string;
  }
  const id = await createConnection(page, 'ambient', MONITORING_CONNECTION);
  await page.getByRole('button', { name: 'Run test' }).click();
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 30_000 });
  return id;
}

export const monitoringUrl = (connectionId: string, section: string, suffix = '') => `/en/c/${connectionId}/${MOTO_REGION}/${section}${suffix}`;
