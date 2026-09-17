import { expect, test } from '@playwright/test';
import { alert } from './helpers';

// The test stack sets a dummy Google client: the button and the redirect to Google can be checked,
// a real Google sign-in cannot.
test('the login page offers Google sign-in next to email and password', async ({ page }) => {
  await page.goto('/en/login');
  const google = page.getByRole('link', { name: 'Continue with Google' });
  await expect(google).toHaveAttribute('href', '/api/auth/google/start?locale=en');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('the Google start route redirects to Google with PKCE', async ({ request }) => {
  const response = await request.get('/api/auth/google/start?locale=en', { maxRedirects: 0 });
  expect(response.status()).toBe(303);
  const location = response.headers().location ?? '';
  expect(location.startsWith('https://accounts.google.com/')).toBe(true);
  expect(new URL(location).searchParams.get('code_challenge_method')).toBe('S256');
  expect(response.headers()['set-cookie']).toContain('opswatch_google_flow=');
});

test('a cancelled Google sign-in lands on the login page with a localized message', async ({ page }) => {
  // Start a sign-in first: the flow cookie is shared with the page, as it would be after Google's page.
  const started = await page.request.get('/api/auth/google/start?locale=en', { maxRedirects: 0 });
  const state = new URL(started.headers().location ?? '').searchParams.get('state');
  await page.goto(`/api/auth/google/callback?error=access_denied&state=${state}`);
  await expect(page).toHaveURL(/\/en\/login\?error=google_denied$/);
  await expect(alert(page)).toHaveText('Google sign-in was cancelled.');
  await page.goto('/fr/login?error=google_not_allowed');
  await expect(alert(page)).toHaveText(/^Ce compte Google n'est pas autorisé/);
});
