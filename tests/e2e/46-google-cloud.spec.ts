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

test('THE RULING: the page says what it reads without an agent, and what it cannot', async ({ page }) => {
  /*
   * Google measures CPU at the hypervisor, so it is there for every running instance with nothing
   * installed — which is what lets a self-hosted OpsWatch read a project directly. Memory and disk
   * usage are **not** agentless on Google: they come from the Ops Agent. An absent memory column that
   * says nothing leaves an operator to work out for themselves whether OpsWatch failed or Google did.
   */
  const id = await create(page, 'Metrics project');
  await page.goto(`/en/accounts/${id}/instances`);
  const main = await page.locator('main').innerText();

  expect(main).toContain('compute.googleapis.com/instance/cpu/utilization');
  expect(main).toContain('Nothing is installed to read it');
  // Named as the provider's own component, and as something OpsWatch will not install for you.
  expect(main).toContain('Ops Agent');
  expect(main).toContain('OpsWatch does not install');
  // Not a promise that it is coming, and not an empty column: a statement about what Google measures.
  expect(main).toContain('does not measure them agentlessly');
});

test('the capability table says Google metrics are built, and stops saying they are not', async ({ page }) => {
  const id = await create(page, 'Capability project');
  await page.goto(`/en/accounts/${id}`);
  const main = await page.locator('main').innerText();

  // Two kinds of "no" that must stay apart, on the same page: what Google does not offer through
  // OpsWatch yet, and what it does. Anchored to the row, because a looser pattern reads the next one.
  expect(main).toMatch(/\bMetrics\s*\n\s*Read directly from the provider/);
  // The rows that are still honestly empty stay empty, so this is not a table that says yes to everything.
  expect(main).toMatch(/\bHealth\s*\n\s*Not built yet in OpsWatch/);
  // And the promise the whole model rests on, still made in writing.
  expect(main).toMatch(/nothing here requires a forwarder, an agent or an account with us/i);
});

test('the instances page reads in French, and at 360 px', async ({ page }) => {
  const id = await create(page, 'Narrow instances');
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/fr/accounts/${id}/instances`);
  const main = await page.locator('main').innerText();

  expect(main).toContain("l’agent Ops");
  expect(main).not.toMatch(/GoogleInstances\./);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('THE RULING: an unreadable project is not a quiet project', async ({ page }) => {
  /*
   * There is no Google project behind this test, so the read is refused. The one thing the alerts
   * page must never do is turn that into "no open incidents" — a monitoring tool reporting calm
   * because it could not look is worse than one that reports nothing at all.
   */
  const id = await create(page, 'Alerts project');
  await page.goto(`/en/accounts/${id}/alerts`);
  const main = await page.locator('main').innerText();

  expect(main).toContain('Alerts in my-project-123');
  expect(main).toMatch(/could not reach Google|refused the read|no usable token|returned an error/);
  // Not the calm answers, either of them.
  expect(main).not.toContain('No open incidents');
  expect(main).not.toContain('nothing is watching');
  await expect(page.locator('main table')).toHaveCount(0);

  // And the promise the page rests on: none of this is OpsWatch's opinion.
  expect(main).toContain('OpsWatch adds no verdict of its own');
});

test('the alerts page is Google’s, and reads in French at 360 px', async ({ page }) => {
  const id = await create(page, 'French alerts');
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/fr/accounts/${id}/alerts`);
  const main = await page.locator('main').innerText();
  expect(main).toContain('Incidents ouverts');
  expect(main).not.toMatch(/GoogleAlerts\./);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // An AWS connection has no such page: this one is about Cloud Monitoring, not about alarms.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/en/accounts');
  const aws = page.getByRole('link', { name: /Moto monitoring/ }).first();
  const href = (await aws.getAttribute('href')) ?? '';
  await page.goto(`/en${href.replace(/^\/en/, '')}/alerts`);
  await expect(page.locator('main')).toContainText('Page not found');
});

test('THE RULING: a Google connection is not offered the AWS monitoring rail', async ({ page }) => {
  /*
   * Google now has a family, produces problems and appears on `/problems` — and it still has no
   * Health page, deliberately. The rail that shows one is ten AWS services, so offering it here would
   * put Containers, Databases and Load balancers in front of somebody whose project has none. The
   * capability table says exactly that, and this is the difference between the two claims being real.
   */
  const id = await create(page, 'No rail project');
  await page.goto(`/en/accounts/${id}`);
  const main = await page.locator('main').innerText();

  // Problems: built. Health: not, and said so rather than quietly linked.
  expect(main).toMatch(/\bProblems\s*\n\s*Read directly from the provider/);
  expect(main).toMatch(/\bHealth\s*\n\s*Not built yet in OpsWatch/);

  // And the switcher does not offer to carry this connection into the rail.
  await page.goto('/en/problems');
  await expect(page.getByRole('navigation', { name: 'Filter problems by cloud' }).getByRole('link', { name: /^Google Cloud/ })).toBeVisible();
});

test('THE RULING: the logs page says what the role allows before asking for it', async ({ page }) => {
  /*
   * The only part of a Google connection that reads **content** rather than figures. Everything else
   * OpsWatch reads from Google is a count or a status; a log line is whatever somebody's code wrote.
   * So the role is granted separately, the connection is complete without it, and the page explains
   * the grant rather than a wizard slipping it in with the other two.
   */
  const id = await create(page, 'Logs project');
  await page.goto(`/en/accounts/${id}/logs`);
  const main = await page.locator('main').innerText();

  expect(main).toContain('This page needs a third role');
  expect(main).toContain('the connection works completely without it');
  // The narrower role, and why it is the narrower one.
  expect(main).toContain('roles/logging.viewer');
  expect(main).toContain('not roles/logging.privateLogViewer');
  expect(main).toContain('who read what');
  // The two promises that matter most about log content.
  expect(main).toContain('Nothing read here is stored');
  expect(main).toContain('none of it is sent to an AI provider');

  // A severity floor rather than a query box: no operator text reaches Google's query language.
  await expect(page.getByRole('navigation', { name: 'Minimum severity' })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
});

test('a connection that has not granted the logging role is not shown as broken', async ({ page }) => {
  /*
   * Declining something optional must not colour the connection: a status that goes yellow for a
   * deliberate choice teaches an operator to ignore the colour on the one screen where it has to
   * mean something. There is no real Google project behind this test, so what is checked here is the
   * page — `gcpStatusOf` is where the rule lives, and its own ruling proves the three verdicts.
   */
  const id = await create(page, 'Declined logging');
  await page.goto(`/en/accounts/${id}`);
  const main = await page.locator('main').innerText();
  // Never tested is its own state, and specifically not "degraded".
  expect(main).toContain('Setup incomplete');
  expect(main).not.toContain('Degraded');

  // The capability table says logs are read, and keeps the gaps it still has as gaps.
  expect(main).toMatch(/\bLogs\s*\n\s*Read directly from the provider/);
  expect(main).toMatch(/\bHealth\s*\n\s*Not built yet in OpsWatch/);
});
