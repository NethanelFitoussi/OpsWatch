import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { MOTO_ACCOUNT, alert, login } from './helpers';

test.beforeEach(async ({ page }) => {
  await login(page);
});

async function createConnection(page: Page, method: 'role' | 'keys', name: string) {
  await page.goto('/en/accounts/new');
  // The radio inputs are visually hidden inside their card labels.
  await page.locator(`input[name="method"][value="${method}"]`).check({ force: true });
  await page.getByLabel('Connection name').fill(name);
  await page.getByLabel('AWS account ID').fill(MOTO_ACCOUNT);
  await page.getByRole('checkbox', { name: 'us-east-1' }).click();
  await page.getByRole('button', { name: 'Create connection' }).click();
  await expect(page).toHaveURL(/\/en\/accounts\/[0-9a-f]{12}$/);
  return page.url().split('/').pop() as string;
}

test('role connection: template download, role ARN and a passing test', async ({ page }) => {
  const id = await createConnection(page, 'role', 'Moto role');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download template' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`opswatch-${id}.yaml`);
  const template = fs.readFileSync((await download.path()) as string, 'utf8');
  expect(template).toContain('sts:ExternalId');
  expect(template).toContain(`OpsWatchReadOnly-${id}`);

  await page.getByLabel('Role ARN').fill(`arn:aws:iam::${MOTO_ACCOUNT}:role/OpsWatchReadOnly-${id}`);
  await page.getByRole('button', { name: 'Save role ARN' }).click();
  await expect(page.getByText('Not tested', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Run test' }).click();
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('listitem').filter({ hasText: 'Amazon ECS' })).toContainText('Allowed');
});

test('refuses a role ARN from another account', async ({ page }) => {
  const id = await createConnection(page, 'role', 'Wrong account');
  await page.getByLabel('Role ARN').fill(`arn:aws:iam::999999999999:role/OpsWatchReadOnly-${id}`);
  await page.getByRole('button', { name: 'Save role ARN' }).click();
  await expect(alert(page)).toHaveText('This role belongs to another AWS account.');
});

test('access keys are masked after saving and can be tested', async ({ page }) => {
  const secret = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
  await createConnection(page, 'keys', 'Moto keys');
  await page.getByLabel('Access key ID').fill('AKIAIOSFODNN7EXAMPLE');
  await page.getByLabel('Secret access key').fill(secret);
  await page.getByRole('button', { name: 'Save keys' }).click();

  await expect(page.getByText('Saved key: AKIA…MPLE. Enter new keys to replace it.')).toBeVisible();
  expect(await page.content()).not.toContain(secret);

  await page.getByRole('button', { name: 'Run test' }).click();
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 30_000 });
});

test('the test API rejects foreign origins and missing sessions', async ({ playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL });
  const foreign = await anonymous.post('/api/connections/abc123def456/test', { headers: { origin: 'https://evil.example' } });
  expect(foreign.status()).toBe(403);
  const noSession = await anonymous.post('/api/connections/abc123def456/test', { headers: { origin: baseURL as string } });
  expect(noSession.status()).toBe(401);
  await anonymous.dispose();
});
