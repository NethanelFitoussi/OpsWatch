import { createHmac } from 'node:crypto';
import { expect, request as playwrightRequest, test } from '@playwright/test';
import { MOTO_REGION, ensureMonitoringConnection, login } from './helpers';

/**
 * The owner's own journey, as one thing rather than as parts.
 *
 * Redis running directly on an Ubuntu EC2 instance inside a watched AWS account. Every piece of this
 * has its own tests; none of them says whether the product *works* — whether an operator who connects
 * an account, enrols a machine and waits for a disk to fill is told, in a place they would look, with
 * something they can act on.
 *
 * The parts were built in that order over a long stretch, and a product assembled from parts that each
 * pass is exactly the product that does not. So this walks it end to end and looks at what an operator
 * would see at each step.
 */

const SAMPLE = {
  cpuPercent: 14,
  memoryUsedBytes: 6_000_000_000,
  memoryTotalBytes: 8_000_000_000,
  load1: 0.5,
  load5: 0.4,
  load15: 0.3,
  uptimeSeconds: 864_000,
  // The disk that is about to become the whole story.
  disks: [{ mount: '/', usedBytes: 48_500_000_000, totalBytes: 50_000_000_000 }],
};

const REDIS = {
  version: '7.4.11',
  uptimeSeconds: 864_000,
  connectedClients: 12,
  // No limit, and using a quarter of the machine: the finding that only fires when both are true.
  usedMemoryBytes: 3_000_000_000,
  maxMemoryBytes: null,
  evictedKeys: 0,
  keyspaceHits: 90_000,
  keyspaceMisses: 1_000,
  keys: 120_000,
  opsPerSecond: 340,
  role: 'master',
  connectedReplicas: 0,
  lastSaveOk: true,
  aofEnabled: false,
};

test('THE RULING: a disk filling on a Redis box is seen, explained and notified, end to end', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);

  // 1. The AWS account the machine runs in.
  const connectionId = await ensureMonitoringConnection(page);
  await page.goto(`/en/c/${connectionId}/${MOTO_REGION}/instances/list`);
  await page.locator('main table tbody tr').first().waitFor({ timeout: 20_000 });
  const instance = /i-[0-9a-f]{8,}/.exec(await page.locator('main').innerText())?.[0] ?? null;
  expect(instance, 'the seeded estate should hold an EC2 instance').not.toBeNull();

  // 2. The machine, enrolled from the Machines page.
  await page.goto('/en/hosts');
  await page.getByLabel('What to call this server').fill('redis-prod-01');
  await page.getByRole('button', { name: 'Add server' }).click();
  await expect(page.getByText('Run this on the machine, once')).toBeVisible();
  const command = await page.locator('pre').filter({ hasText: 'OPSWATCH_HOST_ID' }).first().innerText();
  const parsed = /'([0-9a-f]{12,})'\s*\\\s*'([^']+)'/.exec(command);
  expect(parsed, command).not.toBeNull();
  const [, hostId, secret] = parsed as RegExpMatchArray;

  // Waiting is its own state, and never a green one.
  await page.goto(`/en/hosts/${hostId}`);
  await expect(page.locator('main')).toContainText('Waiting for its first report');

  // 3. The agent reports: a full disk, Redis with no ceiling, and the instance it runs on.
  const agent = await playwrightRequest.newContext({ baseURL: page.url().split('/en/')[0] });
  const body = JSON.stringify({
    identity: {
      hostname: 'redis-prod-01',
      machineId: 'e2e-journey-machine',
      os: 'Ubuntu 24.04.1 LTS',
      kernel: '6.8.0-51-generic',
      arch: 'x86_64',
      cloud: 'aws',
      cloudInstanceId: instance,
      agentVersion: '1.0.0',
    },
    sample: SAMPLE,
    services: [{ kind: 'redis', name: 'redis-server', port: 6379, version: null, evidence: 'Listening on port 6379, held by a process called redis-server' }],
    redis: REDIS,
  });
  const ts = Date.now();
  const sent = await agent.post('/api/v1/ingest/host', {
    headers: {
      'content-type': 'application/json',
      'x-opswatch-integration': hostId,
      'x-opswatch-timestamp': String(ts),
      'x-opswatch-signature': `v1=${createHmac('sha256', secret).update(`v1:${ts}:${body}`).digest('hex')}`,
    },
    data: body,
  });
  expect(sent.status()).toBe(202);

  // 4. The machine page: what is wrong, the figure behind it, and what to check about *this* box.
  await page.goto(`/en/hosts/${hostId}`);
  const machine = await page.locator('main').innerText();
  expect(machine).toContain('/ is 97% full');
  expect(machine).toContain('Redis has no memory limit');
  expect(machine).toContain('What to check');
  expect(machine).toContain('Redis is running here');
  // Discovered, with the evidence for it, rather than asserted.
  expect(machine).toContain('Listening on port 6379');

  // 5. The account's own Health page, where an operator asks what is wrong in production.
  await page.goto(`/en/c/${connectionId}/${MOTO_REGION}/instances/list`);
  await page.locator('main table tbody tr').first().waitFor({ timeout: 20_000 });
  await page.goto(`/en/c/${connectionId}/${MOTO_REGION}/overview/health`);
  const machines = page.locator('[data-slot="card"]').filter({ has: page.getByRole('heading', { name: 'Machines in this account' }) });
  await expect(machines).toContainText('redis-prod-01');
  await expect(machines).toContainText('97% full');
  // And it does not pretend to be something it is not.
  await expect(machines).toContainText('no alert rule matches them');

  // 6. Both sides of the same machine: the instance links to it, and it links back.
  await page.goto(`/en/c/${connectionId}/${MOTO_REGION}/instances/list`);
  await expect(page.getByRole('link', { name: 'An OpsWatch agent reports from inside this instance' })).toBeVisible();
  await page.goto(`/en/hosts/${hostId}`);
  await expect(page.locator('main')).toContainText('This machine is also EC2 instance');

  // 7. The rule that would notify somebody exists, is an ordinary rule, and can be turned off.
  await page.goto(`/en/c/${connectionId}/${MOTO_REGION}/overview/alerts`);
  await expect(page.locator('main')).toContainText('A machine reports trouble');

  // …and nothing has left the instance, because nobody configured anywhere for it to go.
  await page.goto('/en/settings/notifications');
  await expect(page.locator('main')).toContainText('no alert leaves this instance');

  await agent.dispose();
});
