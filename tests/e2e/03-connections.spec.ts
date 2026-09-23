import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { MOTO_ACCOUNT, alert, createConnection, login } from './helpers';

test.beforeEach(async ({ page }) => {
  await login(page);
});

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
  const ecsLine = page.getByRole('listitem').filter({ hasText: 'Amazon ECS' });
  await expect(ecsLine).toContainText('Allowed');
  await expect(ecsLine.locator('img')).toHaveAttribute('alt', '');
});

test('refuses a role ARN from another account and keeps what was typed', async ({ page }) => {
  const id = await createConnection(page, 'role', 'Wrong account');
  const arn = `arn:aws:iam::999999999999:role/OpsWatchReadOnly-${id}`;
  await page.getByLabel('Role ARN').fill(arn);
  await page.getByRole('button', { name: 'Save role ARN' }).click();
  await expect(alert(page)).toHaveText('This role belongs to another AWS account.');
  await expect(page.getByLabel('Role ARN')).toHaveValue(arn);
});

test('the wizard keeps the name, account ID and regions after a validation error', async ({ page }) => {
  await page.goto('/en/accounts/new/aws');
  await page.locator('input[name="method"][value="keys"]').check({ force: true });
  await page.getByLabel('Connection name').fill('Kept values');
  // Passes the browser pattern but has only 10 digits, so the server refuses it.
  await page.getByLabel('AWS account ID').fill('1234 5678 90-');
  await page.getByRole('checkbox', { name: 'eu-west-3' }).click();
  await page.getByRole('button', { name: 'Create connection' }).click();
  await expect(alert(page)).toHaveText('The AWS account ID must be exactly 12 digits.');
  await expect(page.getByLabel('Connection name')).toHaveValue('Kept values');
  await expect(page.getByLabel('AWS account ID')).toHaveValue('1234 5678 90-');
  await expect(page.getByRole('checkbox', { name: 'eu-west-3' })).toBeChecked();
  await expect(page.locator('input[name="method"][value="keys"]')).toBeChecked();
});

test('access keys are masked after saving and can be tested', async ({ page }) => {
  const secret = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
  await createConnection(page, 'keys', 'Moto keys');
  await page.getByLabel('Access key ID').fill('AKIAIOSFODNN7EXAMPLE');
  await page.getByLabel('Secret access key').fill(secret);
  await page.getByRole('button', { name: 'Save keys' }).click();

  await expect(page.getByText('Saved key: AKIA…MPLE. Enter new keys to replace it.')).toBeVisible();
  await expect(page.getByLabel('Access key ID')).toHaveValue('');
  expect(await page.content()).not.toContain(secret);

  await page.getByRole('button', { name: 'Run test' }).click();
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 30_000 });
});

test('invalid access keys keep the key ID but never the secret', async ({ page }) => {
  await createConnection(page, 'keys', 'Invalid keys');
  await page.getByLabel('Access key ID').fill('not-a-key');
  await page.getByLabel('Secret access key').fill('tooShortSecretValue9');
  await page.getByRole('button', { name: 'Save keys' }).click();
  await expect(alert(page).filter({ hasText: 'These access keys are not valid.' })).toBeVisible();
  await expect(page.getByLabel('Access key ID')).toHaveValue('not-a-key');
  await expect(page.getByLabel('Secret access key')).toHaveValue('');
  expect(await page.content()).not.toContain('tooShortSecretValue9');
});

test('ambient connection: detected identity and a passing test', async ({ page, context }) => {
  await createConnection(page, 'ambient', 'Moto ambient');
  await expect(page.getByText('Detected identity:', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Run test' }).click();
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('listitem').filter({ hasText: 'Amazon ECS' })).toContainText('Allowed');

  // An expired session sends the test button to the login page.
  await context.clearCookies();
  await page.getByRole('button', { name: 'Run test' }).click();
  await expect(page).toHaveURL(/\/en\/login$/);
});

test('the connection headings are read without their step numbers', async ({ page }) => {
  await page.getByRole('link', { name: /Moto role/ }).first().click();
  await expect(page).toHaveTitle('Connection · OpsWatch');
  await expect(page.getByRole('heading', { level: 2, name: "OpsWatch's identity", exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Paste the role ARN', exact: true })).toBeVisible();
});

test('copy buttons work without the async clipboard API (plain HTTP)', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  // navigator.clipboard only exists in a secure context; localhost is one, a LAN address over HTTP is not.
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'clipboard', { get: () => undefined }));
  await page.reload();
  expect(await page.evaluate(() => navigator.clipboard)).toBeUndefined();
  await page.getByRole('link', { name: /Moto role/ }).first().click();
  const copy = page.getByRole('button', { name: 'Copy' }).first();
  await copy.click();
  await expect(copy).toContainText(/^(Copied|Copy failed)$/);
  expect(errors).toEqual([]);
});

test('the accounts list flags access keys as meant for local testing', async ({ page }) => {
  await expect(page).toHaveTitle('Connections · OpsWatch');
  const card = page.getByRole('listitem').filter({ hasText: 'Moto keys' });
  await expect(card.getByText('For local testing', { exact: true })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Moto role' }).getByText('For local testing')).toHaveCount(0);
});

test('the test API rejects foreign origins and missing sessions', async ({ playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL });
  const foreign = await anonymous.post('/api/connections/abc123def456/test', { headers: { origin: 'https://evil.example' } });
  expect(foreign.status()).toBe(403);
  const noSession = await anonymous.post('/api/connections/abc123def456/test', { headers: { origin: baseURL as string } });
  expect(noSession.status()).toBe(401);
  await anonymous.dispose();
});

test('THE RULING: a connection is edited, not deleted and re-made', async ({ page }) => {
  const id = await createConnection(page, 'role', 'Before the rename');
  await page.getByLabel('Role ARN').fill(`arn:aws:iam::${MOTO_ACCOUNT}:role/OpsWatchReadOnly-${id}`);
  await page.getByRole('button', { name: 'Save role ARN' }).click();
  await page.getByRole('button', { name: 'Run test' }).click();
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 30_000 });

  // Rename it and give it a second region.
  await page.getByLabel('Name').fill('After the rename');
  await page.getByRole('checkbox', { name: 'eu-west-3' }).check();
  await page.getByRole('button', { name: 'Save changes' }).click();

  // Same connection: the URL never changed, so nothing filed under it was orphaned.
  await expect(page).toHaveURL(new RegExp(`/accounts/${id}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'After the rename' })).toBeVisible();
  // The passing test is still there — an edit is not a reset.
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  // …but it never looked at the new region, and the page says so rather than letting the badge imply it.
  await expect(page.getByText('did not cover eu-west-3')).toBeVisible();

  await page.goto('/en/accounts');
  await expect(page.getByRole('listitem').filter({ hasText: 'After the rename' })).toContainText('us-east-1, eu-west-3');
  await expect(page.getByRole('listitem').filter({ hasText: 'Before the rename' })).toHaveCount(0);
});

test('the account and the credential method are not editable, because they are what the connection is', async ({ page }) => {
  const id = await createConnection(page, 'role', 'Fixed identity');
  await page.goto(`/en/accounts/${id}`);
  const details = page.getByRole('listitem').filter({ hasText: 'Connection details' });
  await expect(page.getByLabel('Name')).toBeVisible();
  await expect(details.getByLabel('AWS account')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: /account/i })).toHaveCount(0);
});
