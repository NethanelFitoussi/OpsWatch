import { expect, test } from '@playwright/test';
import { ADMIN, alert, login } from './helpers';

test('protected pages redirect to setup before an admin exists', async ({ page }) => {
  await page.goto('/en/accounts');
  await expect(page).toHaveURL(/\/en\/setup$/);
});

test('the getting started hub is public, and so is each guide behind it', async ({ page }) => {
  await page.goto('/en/getting-started');
  await expect(page.getByRole('heading', { level: 1, name: 'Connect the systems you use' })).toBeVisible();

  // Somebody deciding whether to install OpsWatch can read what it would ask for, before signing in.
  await page.goto('/en/getting-started/aws');
  await expect(page.getByRole('heading', { level: 1, name: 'Connect your AWS account' })).toBeVisible();
});

test('rejects mismatched passwords, then creates the admin', async ({ page }) => {
  await page.goto('/en/setup');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByLabel('Confirm password').fill('something else entirely');
  await page.getByRole('button', { name: 'Create admin account' }).click();
  await expect(alert(page)).toHaveText('The two passwords do not match.');

  // The email is kept after a validation error; passwords are never echoed back.
  await expect(page.getByLabel('Email')).toHaveValue(ADMIN.email);
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
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
  await expect(page.getByLabel('Email')).toHaveValue(ADMIN.email);
  await expect(page.getByLabel('Password')).toHaveValue('');

  await login(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/en\/login$/);
  await page.goto('/en/accounts');
  await expect(page).toHaveURL(/\/en\/login$/);
});

/**
 * The bootstrap lifecycle, as a self-hosted operator meets it. These exist because an installation was once
 * observed offering "Create admin" again after a rebuild — the database had been written to the container's
 * disposable layer and thrown away, so as far as the server was concerned there had never been an admin.
 * The storage half is fixed and covered by `scripts/verify-persistence.sh`; this is the other half, which
 * asserts the server decides bootstrap eligibility from the database and never from the client.
 */
test('an existing installation sends an unauthenticated visitor to Login, never to Create admin', async ({ page }) => {
  await page.goto('/en/accounts');
  await expect(page).toHaveURL(/\/en\/login$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create admin account' })).toHaveCount(0);
});

test('a direct POST to the setup route cannot create a second admin', async ({ page, request }) => {
  // The setup form is a Server Action, so this is what reaching past the redirected page looks like. It must
  // fail on the server's own terms: `createAdmin` re-checks inside its transaction whatever the caller did.
  const response = await request.post('/en/setup', {
    form: { email: 'intruder@example.com', password: 'another-long-password', confirmPassword: 'another-long-password' },
    maxRedirects: 0,
    failOnStatusCode: false,
  });
  expect(response.status()).toBeLessThan(500);

  // The decisive assertion: the intruder cannot sign in, and the real admin still can.
  await page.goto('/en/login');
  await page.getByLabel('Email').fill('intruder@example.com');
  await page.getByLabel('Password').fill('another-long-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(alert(page)).toHaveText('Incorrect email or password.');
  await login(page);
});

test('signing out leads to Login, and does not reopen Create admin', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/en\/login$/);
  // The bug's signature was the setup page coming back after the session ended. It must stay closed.
  await page.goto('/en/setup');
  await expect(page).toHaveURL(/\/en\/login$/);
});

test('an expired session leads to Login, not to Create admin', async ({ page, context }) => {
  await login(page);
  // A cookie that no longer matches a stored session is what expiry and a secret rotation both look like.
  await context.addCookies([
    { name: 'opswatch_session', value: 'no-longer-a-valid-session', url: 'http://localhost:3100' },
  ]);
  await page.goto('/en/accounts');
  await expect(page).toHaveURL(/\/en\/login$/);
});
