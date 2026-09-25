import { expect, test } from '@playwright/test';
import { login } from './helpers';

/**
 * Connecting a Google Cloud project (§S9).
 *
 * The real provider cannot be exercised from here — the same limit as the Google sign-in spec — so what
 * is accepted is everything up to Google's own endpoint: what the pages promise before asking for
 * anything, the connection that gets created, the key that is served, and the fact that the private
 * half of it never appears anywhere a browser can see.
 */

test.beforeEach(async ({ page }) => {
  await login(page);
});

const create = async (page: import('@playwright/test').Page, name: string) => {
  await page.goto('/en/accounts/new/gcp');
  await page.getByLabel('Connection name').fill(name);
  await page.getByLabel('Project ID').fill('my-project-123');
  await page.getByLabel('Project number').fill('123456789012');
  await page.getByRole('button', { name: 'Create connection' }).click();
  await page.waitForURL(/\/en\/accounts\/[0-9a-f]{12}$/);
  return /\/accounts\/([0-9a-f]{12})/.exec(page.url())?.[1] as string;
};

test('THE RULING: the page says what it will read before it asks for anything', async ({ page }) => {
  /*
   * A page that asks for access and explains afterwards is asking somebody to agree to something they
   * have not read. Both roles are named, in Google's own vocabulary, above the form.
   */
  await page.goto('/en/accounts/new/gcp');
  const main = await page.locator('main').innerText();
  const roles = main.indexOf('roles/compute.viewer');
  const form = main.indexOf('Connection name');
  expect(roles).toBeGreaterThan(-1);
  expect(main).toContain('roles/monitoring.viewer');
  expect(roles).toBeLessThan(form);

  // And the thing it will not ask for, which is the point of the method.
  expect(main).toContain('No service account key is created, downloaded or stored');
});

test('THE RULING: connecting stores no Google credential, and the key that is served is public', async ({ page, request }) => {
  const id = await create(page, 'Analytics project');

  // The setup page hands over the public half, and says where the private half is not.
  const main = await page.locator('main').innerText();
  expect(main).toContain('There is no key to leak');
  expect(main).toContain('"kty": "RSA"');
  // The private half, in any of the forms it could leak in.
  const html = await page.content();
  for (const secret of ['PRIVATE KEY', '"d"', 'privateKeyPem']) expect(html).not.toContain(secret);

  // The key set is served, unauthenticated, because public keys are public.
  const jwks = await request.get(`/api/connections/${id}/gcp/jwks.json`);
  expect(jwks.status()).toBe(200);
  const body = (await jwks.json()) as { keys: Record<string, unknown>[] };
  expect(body.keys).toHaveLength(1);
  expect(body.keys[0]).toMatchObject({ kty: 'RSA', use: 'sig', alg: 'RS256' });
  for (const secret of ['d', 'p', 'q', 'dp', 'dq', 'qi']) expect(secret in body.keys[0]).toBe(false);
});

test('the commands are shown for the operator to run, never run for them', async ({ page }) => {
  const id = await create(page, 'Commands project');
  const main = await page.locator('main').innerText();

  // The pool, the provider with the uploaded key set, and the two role bindings.
  expect(main).toContain('gcloud iam workload-identity-pools create');
  expect(main).toContain('--jwk-json-path=opswatch-keys.json');
  expect(main).toContain('--role="roles/compute.viewer"');
  expect(main).toContain('--role="roles/monitoring.viewer"');
  // Said plainly, because it is the reason they are commands and not a button.
  expect(main).toContain('OpsWatch has no access to this project yet and cannot run them for you');

  // Never checked is its own state, and not a failure.
  expect(main).toContain('Not checked yet');
  await page.goto(`/en/accounts/${id}`);
  await expect(page.locator('main')).not.toContainText('Connected');
});

test('a Google connection is not shown as an AWS account with no number', async ({ page }) => {
  await create(page, 'Listed project');
  await page.goto('/en/accounts');
  const row = page.locator('main').getByText('Listed project').first();
  await expect(row).toBeVisible();
  const main = await page.locator('main').innerText();
  expect(main).toContain('my-project-123');
  // The AWS pages of a Google connection do not exist, rather than existing and being empty.
  expect(main).not.toMatch(/Listed project[\s\S]{0,80}Account\b/);
});

test('the AWS-only pages of a Google connection answer 404 rather than rendering empty', async ({ page }) => {
  const id = await create(page, 'No collection project');
  await page.goto(`/en/accounts/${id}/collection`);
  await expect(page.locator('main')).toContainText('Page not found');
});

test('it refuses a name that is not a Google name, and says which one', async ({ page }) => {
  await page.goto('/en/accounts/new/gcp');
  await page.getByLabel('Connection name').fill('Bad project');
  await page.getByLabel('Project ID').fill('Not A Project');
  await page.getByLabel('Project number').fill('123456789012');
  await page.getByRole('button', { name: 'Create connection' }).click();

  await expect(page.locator('main')).toContainText('That is not a project ID');
  // The name is kept, because retyping it is not part of fixing the mistake.
  await expect(page.getByLabel('Connection name')).toHaveValue('Bad project');
});

test('Google Cloud renders at 360px in French, with no raw key anywhere', async ({ page }) => {
  const id = await create(page, 'Narrow project');
  await page.setViewportSize({ width: 360, height: 800 });
  for (const path of ['/fr/accounts/new/gcp', `/fr/accounts/${id}`, '/fr/getting-started/gcp']) {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
    expect(await page.locator('main').innerText(), path).not.toMatch(/GoogleSetup\.|GoogleWizard\.|GettingStarted\./);
  }
});

test('THE RULING: the instances page says why there is nothing, and never shows an empty table', async ({ page }) => {
  /*
   * There is no Google project behind this test, so every read is refused — which is exactly the state
   * an operator is in before the roles arrive, and the one worth accepting. "Could not read" and "there
   * are none" are different answers and must not look the same.
   */
  const id = await create(page, 'Instances project');
  await page.goto(`/en/accounts/${id}/instances`);

  const main = await page.locator('main').innerText();
  expect(main).toContain('Instances in my-project-123');
  // A stated reason, not a blank table.
  expect(main).toMatch(/could not reach Google|refused the read|no usable token|returned an error/);
  await expect(page.locator('main table')).toHaveCount(0);
  // And a way to find out which it is.
  await expect(page.getByRole('link', { name: "Check this connection's access" })).toBeVisible();

  // It says it is read live rather than implying a collector that does not exist.
  expect(main).toContain('Nothing about a Google project is collected on a schedule yet');
});

test('the instances page belongs to Google connections only', async ({ page }) => {
  // An AWS connection has an instances page of its own, in the monitoring rail; this is not it.
  await page.goto('/en/accounts');
  const aws = page.getByRole('link', { name: /Moto monitoring/ }).first();
  const href = (await aws.getAttribute('href')) ?? '';
  await page.goto(`/en${href.replace(/^\/en/, '')}/instances`);
  await expect(page.locator('main')).toContainText('Page not found');
});
