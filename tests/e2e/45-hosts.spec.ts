import { createHmac } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { login } from './helpers';

/**
 * Linux hosts, end to end (§E).
 *
 * The agent is a shell script on somebody else's machine, so what is exercised here is the contract
 * between them: a host is enrolled, a signed report arrives, the machine appears with what it measured,
 * and everything that cannot prove who it is is refused.
 *
 * The signing is done by hand rather than by running the agent, because the point under test is the
 * server's half — and a test that shelled out to the real agent would be testing this container's
 * `/proc` rather than OpsWatch.
 */

const REPORT = {
  identity: {
    hostname: 'api-prod-03',
    machineId: 'e2e-machine-0001',
    os: 'Ubuntu 24.04.1 LTS',
    kernel: '6.8.0-51-generic',
    arch: 'x86_64',
    cloud: 'aws',
    cloudInstanceId: 'i-0e2e00000000',
    agentVersion: '1.0.0',
  },
  sample: {
    cpuPercent: 17.5,
    memoryUsedBytes: 2_100_000_000,
    memoryTotalBytes: 8_000_000_000,
    load1: 0.42,
    load5: 0.31,
    load15: 0.2,
    uptimeSeconds: 864_000,
    disks: [{ mount: '/', usedBytes: 12_000_000_000, totalBytes: 50_000_000_000 }],
  },
};

/** One signed report, exactly as the agent builds it: `v1:<timestamp>:<body>`, HMAC-SHA256. */
async function report(
  request: APIRequestContext,
  input: { hostId: string; secret: string; machineId?: string; body?: unknown; timestampMs?: number; signature?: string },
) {
  // One machine per test unless a test is deliberately reusing one: `machine_id` is unique, which is
  // the whole point of it, so two tests sharing one would collide for the right reason and fail for the
  // wrong one.
  const body = JSON.stringify(
    input.body ?? { ...REPORT, identity: { ...REPORT.identity, machineId: input.machineId ?? REPORT.identity.machineId } },
  );
  const ts = input.timestampMs ?? Date.now();
  const signature = input.signature ?? `v1=${createHmac('sha256', input.secret).update(`v1:${ts}:${body}`).digest('hex')}`;
  return request.post('/api/v1/ingest/host', {
    data: body,
    headers: {
      'content-type': 'application/json',
      'x-opswatch-integration': input.hostId,
      'x-opswatch-timestamp': String(ts),
      'x-opswatch-signature': signature,
    },
  });
}

/** Enrols a host through the page and returns its id and the key shown once. */
async function enrol(page: import('@playwright/test').Page, name: string) {
  await page.goto('/en/hosts');
  await page.getByLabel('What to call this server').fill(name);
  await page.getByRole('button', { name: 'Add server' }).click();
  await expect(page.getByText('Run this on the machine, once')).toBeVisible();

  const command = await page.locator('pre').filter({ hasText: 'OPSWATCH_HOST_ID' }).first().innerText();
  // The two quoted values on their own lines, which is how the command is laid out so its longest
  // line does not run off the edge of the box.
  const hostId = /'([0-9a-f]{12,})'\s*\\\s*'([^']+)'/.exec(command);
  expect(hostId, command).not.toBeNull();
  return { hostId: hostId![1], secret: hostId![2] };
}

/**
 * A request context with no cookies, which is what an agent is.
 *
 * `page.request` shares the browser's cookie jar, and a mutating request that carries a session cookie
 * must also carry an `Origin` — that is the CSRF rule, and it is right. A real agent carries neither,
 * so it is let through on its signature alone. Signing from the browser's context would be testing a
 * request no agent ever makes.
 */
let agent: APIRequestContext;

test.beforeEach(async ({ page, playwright, baseURL }) => {
  await login(page);
  agent = await playwright.request.newContext({ baseURL });
});

test.afterEach(async () => {
  await agent.dispose();
});

test('THE RULING: a host is enrolled, reports, and appears with what it measured', async ({ page }) => {
  const host = await enrol(page, 'e2e api-prod-03');

  // Before any report it is waiting — which is not unhealthy, and not stopped.
  await expect(page.locator('main')).toContainText('Waiting for its first report');

  expect((await report(agent, host)).status()).toBe(202);

  await page.goto('/en/hosts');
  const row = page.getByRole('listitem').filter({ hasText: 'e2e api-prod-03' });
  await expect(row).toContainText('Reporting');
  await expect(row).toContainText('Ubuntu 24.04.1 LTS');

  await page.getByRole('link', { name: 'e2e api-prod-03' }).click();
  const main = page.locator('main');
  await expect(main).toContainText('6.8.0-51-generic');
  await expect(main).toContainText('17.5%');
  // Matched to a cloud on the id the provider gave the machine, never on its hostname.
  await expect(main).toContainText('i-0e2e00000000');
  await expect(main).toContainText('AWS EC2');
  await expect(main).toContainText('/');
});

test('THE RULING: a report that cannot prove who it is changes nothing', async ({ page }) => {
  const host = { ...(await enrol(page, 'e2e refusals')), machineId: 'e2e-machine-refusals' };

  // Wrong key.
  expect((await report(agent, { ...host, secret: 'not-the-key' })).status()).toBe(401);
  // Right key, tampered body: the signature covers the exact bytes, so a changed body fails.
  const tampered = await agent.post('/api/v1/ingest/host', {
    data: JSON.stringify({ ...REPORT, sample: { ...REPORT.sample, cpuPercent: 99 } }),
    headers: {
      'content-type': 'application/json',
      'x-opswatch-integration': host.hostId,
      'x-opswatch-timestamp': String(Date.now()),
      'x-opswatch-signature': `v1=${createHmac('sha256', host.secret).update(`v1:${Date.now()}:${JSON.stringify(REPORT)}`).digest('hex')}`,
    },
  });
  expect(tampered.status()).toBe(401);
  // A replay from an hour ago: the timestamp is inside the signed material and is checked first.
  expect((await report(agent, { ...host, timestampMs: Date.now() - 3_600_000 })).status()).toBe(401);
  // A host id nobody has. Same answer as a wrong key, so ids cannot be enumerated.
  expect((await report(agent, { ...host, hostId: 'ffffffffffff' })).status()).toBe(401);
  // No headers at all.
  expect((await agent.post('/api/v1/ingest/host', { data: '{}' })).status()).toBe(401);

  // And none of it reached the host: it is still waiting.
  await page.goto('/en/hosts');
  await expect(page.getByRole('listitem').filter({ hasText: 'e2e refusals' })).toContainText('Waiting for its first report');
});

test('THE RULING: one machine cannot become two hosts', async ({ page }) => {
  const shared = 'e2e-machine-shared';
  const first = await enrol(page, 'e2e machine one');
  expect((await report(agent, { ...first, machineId: shared })).status()).toBe(202);

  // A second host, the same machine id — an agent installed twice, or a command pasted twice.
  const second = await enrol(page, 'e2e machine two');
  const clash = await report(agent, { ...second, machineId: shared });
  expect(clash.status()).toBe(409);

  // The second host is still waiting rather than quietly holding the first's machine.
  await page.goto('/en/hosts');
  await expect(page.getByRole('listitem').filter({ hasText: 'e2e machine two' })).toContainText('Waiting for its first report');
});

test('the agent script is served, carries no secret, and matches the checksum shown', async ({ page }) => {
  const response = await page.request.get('/api/hosts/agent.sh');
  expect(response.status()).toBe(200);
  const script = await response.text();

  // It reads its key from a file; the script itself is the same bytes for every host.
  expect(script).toContain('/etc/opswatch/agent.conf');
  expect(script).toContain('openssl dgst -sha256 -hmac');
  // What it must never do.
  expect(script).not.toContain('/environ');
  expect(script).not.toContain('nc -l');

  // EC2 identity is read with IMDSv2 — a token first, then the read. IMDSv1 is the one reachable
  // through a server-side request forgery.
  expect(script).toContain('X-aws-ec2-metadata-token-ttl-seconds');

  await page.goto('/en/hosts');
  await page.getByLabel('What to call this server').fill('e2e checksum');
  await page.getByRole('button', { name: 'Add server' }).click();
  const shown = await page.locator('pre').filter({ hasText: /^[0-9a-f]{64}$/ }).first().innerText();
  const { createHash } = await import('node:crypto');
  expect(shown.trim()).toBe(createHash('sha256').update(script).digest('hex'));
});

test('removing a host takes its readings, and says the agent keeps running', async ({ page }) => {
  const host = { ...(await enrol(page, 'e2e removable')), machineId: 'e2e-machine-removable' };
  expect((await report(agent, host)).status()).toBe(202);

  await page.goto(`/en/hosts/${host.hostId}`);
  await expect(page.locator('main')).toContainText('The agent keeps running on the machine until you remove it there');
  await page.getByRole('button', { name: 'Remove server' }).click();
  await expect(page).toHaveURL(/\/en\/hosts$/);
  await expect(page.getByRole('link', { name: 'e2e removable' })).toHaveCount(0);

  // And its key is refused from then on, which is what makes the removal mean something.
  expect((await report(agent, host)).status()).toBe(401);
});

test('the hosts pages render at 360px without horizontal overflow, in both locales', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const locale of ['en', 'fr'] as const) {
    await page.goto(`/${locale}/hosts`);
    await expect(page.locator('main')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, locale).toBeLessThanOrEqual(0);
  }
});
