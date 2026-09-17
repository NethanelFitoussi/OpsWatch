import { expect, test } from '@playwright/test';
import { ADMIN, alert, login } from './helpers';

test('protected pages redirect to setup before an admin exists', async ({ page }) => {
  await page.goto('/en/accounts');
  await expect(page).toHaveURL(/\/en\/setup$/);
});

test('the getting started guide is public', async ({ page }) => {
  await page.goto('/en/getting-started');
  await expect(page.getByRole('heading', { level: 1, name: 'Connect your AWS account' })).toBeVisible();
});

test('rejects mismatched passwords, then creates the admin', async ({ page }) => {
  await page.goto('/en/setup');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByLabel('Confirm password').fill('something else entirely');
  await page.getByRole('button', { name: 'Create admin account' }).click();
  await expect(alert(page)).toHaveText('The two passwords do not match.');

  // React resets every uncontrolled field (including email) once the form
  // action settles, even when it resolves with a validation error, so all
  // three fields need to be filled in again for the retry.
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByLabel('Confirm password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Create admin account' }).click();
  await expect(page).toHaveURL(/\/en\/accounts$/);
  await expect(page.getByRole('heading', { level: 1, name: 'AWS accounts' })).toBeVisible();
});

test('setup is closed once an admin exists', async ({ page }) => {
  await page.goto('/en/setup');
  await expect(page).toHaveURL(/\/en\/login$/);
});

test('wrong password is refused, right password signs in, sign out works', async ({ page }) => {
  await page.goto('/en/login');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill('not the right password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(alert(page)).toHaveText('Incorrect email or password.');

  await login(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/en\/login$/);
  await page.goto('/en/accounts');
  await expect(page).toHaveURL(/\/en\/login$/);
});
