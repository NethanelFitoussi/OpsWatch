import { expect, test } from '@playwright/test';
import { MOTO_ACCOUNT, MOTO_REGION, ensureMonitoringConnection, login } from './helpers';

/**
 * Managed collection (AWS push collection).
 *
 * The three scenarios the design turns on, in the order the acceptance criteria name them:
 *
 *   **A — direct only.** An account is connected, nothing is forwarded, and everything works.
 *   **B — managed.** It is enabled deliberately, and even then nothing is forwarded until a log group is
 *     chosen.
 *   **C — back to direct.** Turning it off stops forwarding and leaves the account connected.
 *
 * The AWS half of B — deploying a stack and creating a subscription filter — needs a real Lambda in a
 * real account. moto has no Lambda and OpsWatch never deploys anything into anybody's account, so the
 * browser suite covers the decisions and the states; the ingestion path itself is proved against a real
 * database in `tests/unit/ingest-route.test.ts`.
 */

let connectionId = '';

test.beforeEach(async ({ page }) => {
  await login(page);
  connectionId = await ensureMonitoringConnection(page);
});

const collectionUrl = () => `/en/accounts/${connectionId}/collection`;

test('THE RULING: connecting an AWS account does not enable forwarding', async ({ page }) => {
  await page.goto(`/en/accounts/${connectionId}`);
  const main = page.locator('main');
  // On the account page itself, not behind an advanced menu: it is a privacy decision before it is a
  // technical one.
  await expect(main.getByRole('heading', { name: 'How OpsWatch reads this account' })).toBeVisible();
  await expect(main).toContainText('Direct');
  await expect(main).toContainText('Nothing is sent from your AWS account to anywhere');
});

test('THE RULING: the destination is named, and it is this instance rather than a cloud', async ({ page }) => {
  await page.goto(collectionUrl());
  const main = page.locator('main');
  await expect(main).toContainText('Data destination');
  // There is no OpsWatch Cloud. In direct mode the honest answer is that nothing is forwarded at all.
  await expect(main).toContainText('Nowhere — OpsWatch reads AWS, nothing is forwarded.');
  await expect(main).not.toContainText('OpsWatch Cloud');
});

test('THE RULING: enabling it is a confirmed decision with the consequences written out', async ({ page }) => {
  await page.goto(collectionUrl());
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'Enable managed collection' })).toBeVisible();

  // What it will do, what it will create, what AWS may charge for, and that nothing is forwarded yet.
  await expect(main).toContainText('sent from your AWS account to this OpsWatch instance');
  await expect(main).toContainText('second CloudFormation stack');
  await expect(main).toContainText('AWS may charge');
  await expect(main).toContainText('Nothing is forwarded until you choose a log group');

  // A toggle that enables data leaving an AWS account on a stray click is a toggle in the wrong place.
  const submit = main.getByRole('button', { name: 'Enable managed collection' });
  if ((await submit.count()) > 0) {
    await submit.click();
    await expect(main).toContainText('Tick the confirmation');
  } else {
    // Without a public URL there is nowhere for a forwarder to deliver, and the page says which setting.
    await expect(main).toContainText('OPSWATCH_PUBLIC_URL');
  }
});

test('the collection template is downloadable, carries no secret, and is refused without a public URL', async ({ page }) => {
  const response = await page.request.get(`/api/connections/${connectionId}/collection-template`);
  if (response.status() === 200) {
    const yaml = await response.text();
    expect(response.headers()['content-disposition']).toContain('attachment');
    // A `NoEcho` parameter, supplied at deploy time — so the document can be read, diffed and kept.
    expect(yaml).toContain('NoEcho: true');
    expect(yaml).toContain('OpsWatchForwarder');
    expect(yaml).not.toContain('AdministratorAccess');
    expect(yaml).not.toContain('DeletionPolicy');
  } else {
    // No public URL: a template pointing at nothing is a stack that installs and never delivers.
    expect([303, 404]).toContain(response.status());
  }
});

test('THE RULING: the ingestion endpoint refuses anything that cannot prove who it is', async ({ request }) => {
  const body = JSON.stringify({ source: 'aws.logs', forwarderVersion: '1.0.0', awsAccountId: '123456789012', region: 'us-east-1', logGroup: '/x', sentAt: Date.now(), records: [] });
  // No headers at all.
  expect((await request.post('/api/v1/ingest/aws/logs', { data: body, headers: { 'content-type': 'application/json' } })).status()).toBe(401);
  // A made-up integration, a made-up signature.
  const forged = await request.post('/api/v1/ingest/aws/logs', {
    data: body,
    headers: {
      'content-type': 'application/json',
      'x-opswatch-integration': 'does-not-exist',
      'x-opswatch-timestamp': String(Date.now()),
      'x-opswatch-signature': 'v1=0000000000000000000000000000000000000000000000000000000000000000',
    },
  });
  expect(forged.status()).toBe(401);
  // And it says nothing else: not whether the integration exists, not which check failed.
  expect(await forged.json()).toEqual({ error: 'unauthorized' });
});

test('the ingestion endpoint is documented as signed rather than as a session route', async ({ page }) => {
  const document = (await (await page.request.get('/api/v1/openapi.json')).json()) as {
    paths: Record<string, Record<string, { security: unknown[] }>>;
  };
  const operation = document.paths['/api/v1/ingest/aws/logs'].post;
  // Saying so is what stops a generated client trying a bearer token against it.
  expect(operation.security).toEqual([{ signature: [] }]);
});

test('disconnecting names the stacks that exist, and only those', async ({ page }) => {
  await page.goto(`/en/accounts/${connectionId}`);
  const main = page.locator('main');
  await expect(main).toContainText('Stops reading this account');
  // The part OpsWatch cannot do for them, said plainly rather than left to be discovered.
  await expect(main).toContainText('it cannot delete its own stack');
  await expect(main).toContainText('Delete the stacks yourself');
  await expect(main).toContainText(`aws cloudformation delete-stack --stack-name opswatch-${connectionId}`);

  // Managed collection was never enabled on this connection, so there is no second stack — and telling
  // somebody to delete a stack they never created is how a removal guide loses their trust.
  await expect(main).not.toContainText('The collection stack first');
  await expect(main).not.toContainText('-collection --region');
});

test('the guide explains push without requiring anybody to understand a subscription filter', async ({ page }) => {
  await page.goto('/en/docs/push-collection');
  const main = page.locator('main');
  await expect(main).toContainText('Off by default');
  await expect(main).toContainText('There is no such service');
  // The state that must not read as a failure.
  await expect(main).toContainText('Nothing heard yet');
  await expect(main).toContainText('That is not a failure');
});

test('the collection page renders at 360px without horizontal overflow, in both locales', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const locale of ['en', 'fr'] as const) {
    await page.goto(`/${locale}/accounts/${connectionId}/collection`);
    await expect(page.locator('main')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, locale).toBeLessThanOrEqual(0);
  }
});

test('THE RULING: a stack is set up per region, and the page says which are forwarding', async ({ page }) => {
  /*
   * `aws_collection` held one `forwarder_arn` for a whole account. A CloudWatch subscription filter can
   * only reach a Lambda in its own region, so an account reading three regions could forward from one
   * of them — and the other two would have pointed at a function that is not there. The page said which
   * region it forwarded from, which was honest and still only one.
   */
  // Already signed in by the file's beforeEach; logging in again lands on a redirect with no form.
  await page.goto('/en/accounts/new/aws');
  await page.locator('input[name="method"][value="ambient"]').check({ force: true });
  await page.getByLabel('Connection name').fill('Two regions');
  await page.getByLabel('AWS account ID').fill(MOTO_ACCOUNT);
  for (const region of [MOTO_REGION, 'eu-west-1']) await page.getByRole('checkbox', { name: region }).click();
  await page.getByRole('button', { name: 'Create connection' }).click();
  await page.waitForURL(/\/en\/accounts\/[0-9a-f]{12}$/);
  const id = /\/accounts\/([0-9a-f]{12})/.exec(page.url())?.[1] as string;

  await page.getByRole('button', { name: 'Run test' }).click();
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.goto(`/en/accounts/${id}/collection`);
  await page.locator('input[name="confirm"]').check();
  await page.getByRole('button', { name: 'Enable managed collection' }).click();

  // Every region of the account, each saying whether it is forwarding — the question an operator asks
  // is "is production covered", and it must be answerable without opening each one.
  const picker = page.locator('[data-slot="card"]').filter({ has: page.getByRole('heading', { name: 'Which region' }) });
  await expect(picker).toContainText(MOTO_REGION);
  await expect(picker).toContainText('eu-west-1');
  expect((await picker.innerText()).match(/not set up/g)).toHaveLength(2);

  // The deploy command is about the region being set up, and changes with it.
  await expect(page.locator('main')).toContainText(`--region ${MOTO_REGION}`);
  await picker.getByRole('link', { name: /eu-west-1/ }).click();
  await expect(page).toHaveURL(/[?&]region=eu-west-1/);
  await expect(page.locator('main')).toContainText('--region eu-west-1');
  await expect(page.locator('main')).not.toContainText(`--region ${MOTO_REGION}`);

  await page.goto(`/en/accounts/${id}`);
  await page.getByRole('button', { name: 'Remove connection' }).click();
});
