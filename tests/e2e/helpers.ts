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
