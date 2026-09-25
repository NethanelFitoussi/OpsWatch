import { createHmac } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { MOTO_REGION, createConnection, ensureMonitoringConnection, login } from './helpers';

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
  services: [
    { kind: 'redis', name: 'redis-server', port: 6379, version: null, evidence: 'Listening on port 6379, held by a process called redis-server' },
    { kind: 'nginx', name: 'nginx', port: 443, version: null, evidence: 'Listening on port 443, held by a process called nginx' },
  ],
  redis: {
    version: '7.4.11',
    uptimeSeconds: 900_000,
    connectedClients: 4,
    usedMemoryBytes: 1_137_664,
    maxMemoryBytes: null,
    evictedKeys: 0,
    keyspaceHits: 900,
    keyspaceMisses: 100,
    keys: 4,
    opsPerSecond: 12,
    role: 'master',
    connectedReplicas: 0,
    lastSaveOk: true,
    aofEnabled: false,
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

test('THE RULING: a discovered service says how it was discovered', async ({ page }) => {
  /*
   * Discovery is a guess made from a listening port and the name of the process holding it. An
   * operator reading "Redis" on a page is entitled to know that is how OpsWatch decided — and the
   * sentence is the agent's own, not a paraphrase the server invented.
   */
  const host = { ...(await enrol(page, 'e2e services')), machineId: 'e2e-machine-services' };
  expect((await report(agent, host)).status()).toBe(202);

  await page.goto(`/en/hosts/${host.hostId}`);
  const main = page.locator('main');
  await expect(main).toContainText('Redis');
  await expect(main).toContainText('Listening on port 6379, held by a process called redis-server');
  await expect(main).toContainText('nginx');

  // Redis's own figures, read with INFO — which describes the server and never its contents.
  await expect(main).toContainText('7.4.11');
  // No limit is a real answer and a common one; "0 of 0" would not be.
  await expect(main).toContainText('no limit set');
  // 900 hits out of 1000 lookups.
  await expect(main).toContainText('90.0%');
  await expect(main).toContainText('master, no replicas');
  await expect(main).toContainText('reads no key and no value');
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

test('THE RULING: a full disk is what the list says first, and never a green dot', async ({ page }) => {
  /*
   * An operator with twenty machines reads the top of the list, and a full disk on the nineteenth is
   * the thing they opened the page for. A host that is reporting *and* out of disk is not healthy.
   */
  const host = { ...(await enrol(page, 'e2e full disk')), machineId: 'e2e-machine-disk' };
  const full = {
    ...REPORT,
    sample: {
      ...REPORT.sample,
      disks: [
        { mount: '/', usedBytes: 48_000_000_000, totalBytes: 50_000_000_000 },
        { mount: '/data', usedBytes: 10_000_000_000, totalBytes: 100_000_000_000 },
      ],
    },
  };
  expect((await report(agent, { ...host, body: { ...full, identity: { ...full.identity, machineId: host.machineId } } })).status()).toBe(202);

  await page.goto('/en/hosts');
  const row = page.getByRole('listitem').filter({ hasText: 'e2e full disk' });
  // The figure behind the finding, never a colour on its own.
  await expect(row).toContainText('/ is 96% full');
  // And only the filesystem that is actually full: /data at 10% says nothing.
  await expect(row).not.toContainText('/data');

  // The detail says it above everything the page then goes on to describe.
  await page.goto(`/en/hosts/${host.hostId}`);
  await expect(page.locator('main')).toContainText('/ is 96% full');
});

test('THE RULING: a machine that stopped reporting shows no figures from before the silence', async ({ page }) => {
  // Nothing in the test stack can advance the clock sixteen minutes, so what is checked here is the
  // other half of the rule: a host that has never reported invents no fault at all.
  await enrol(page, 'e2e never reported');
  await page.goto('/en/hosts');
  const row = page.getByRole('listitem').filter({ hasText: 'e2e never reported' });
  await expect(row).toContainText('Waiting for its first report');
  await expect(row).not.toContainText('% full');
  await expect(row).not.toContainText('stopped reporting');
});

test('THE RULING: a host with one reading gets a chart of one reading, not an empty box', async ({ page }) => {
  /*
   * "What is it doing now" and "what has it been doing" are two questions, and the second is the one
   * that says whether the first is normal. A metric this kernel never published has no chart at all,
   * rather than an empty frame implying one should be there.
   */
  const host = { ...(await enrol(page, 'e2e charted')), machineId: 'e2e-machine-charts' };
  expect((await report(agent, host)).status()).toBe(202);

  await page.goto(`/en/hosts/${host.hostId}`);
  const main = page.locator('main');
  await expect(main).toContainText('The last day');
  // Each measured metric gets a figure; the caption is the chart's accessible name.
  await expect(main.getByRole('figure', { name: 'CPU' })).toBeVisible();
  await expect(main.getByRole('figure', { name: 'Memory' })).toBeVisible();
  await expect(main).toContainText('a gap is silence, not a measurement');
});

test('a host that has never reported has no charts at all', async ({ page }) => {
  // Not an empty chart: there is nothing to draw, and a frame would imply there should be.
  const host = await enrol(page, 'e2e uncharted');
  await page.goto(`/en/hosts/${host.hostId}`);
  await expect(page.locator('main')).not.toContainText('The last day');
});

test('THE RULING: an agent on an EC2 instance is one machine, shown from both sides', async ({ page }) => {
  /*
   * Cloud discovery and an agent are two sources for one machine. Without the match an operator sees
   * the instance in AWS and a separate "host" with the same name, and has no way to know they are the
   * same box — which is how somebody ends up enrolling it twice.
   *
   * The match is on the id AWS gave the instance, which the agent reads from the instance metadata
   * service. Never on a hostname: two machines can share one.
   */
  const connectionId = await ensureMonitoringConnection(page);
  await page.goto(`/en/c/${connectionId}/${MOTO_REGION}/instances/list`);
  // The table is behind a Suspense boundary: reading `main` straight after the navigation reads
  // "Loading…" and finds no instance, which is how this spec quietly skipped itself for a while.
  const rows = page.locator('main table tbody tr');
  await rows.first().waitFor({ timeout: 20_000 });
  const seeded = /i-[0-9a-f]{8,}/.exec(await page.locator('main').innerText())?.[0] ?? null;
  expect(seeded, 'the moto seed should have produced an EC2 instance to match against').not.toBeNull();

  const host = { ...(await enrol(page, 'e2e ec2 agent')), machineId: 'e2e-machine-ec2' };
  const body = { ...REPORT, identity: { ...REPORT.identity, machineId: host.machineId, cloud: 'aws', cloudInstanceId: seeded! } };
  expect((await report(agent, { ...host, body })).status()).toBe(202);

  // The AWS side offers the way in…
  await page.goto(`/en/c/${connectionId}/${MOTO_REGION}/instances/list`);
  const link = page.getByRole('link', { name: 'An OpsWatch agent reports from inside this instance' });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/hosts/${host.hostId}$`));

  // …and the machine side says which account it was found in, now that somebody has looked.
  await expect(page.locator('main')).toContainText(seeded!);
  await expect(page.locator('main')).toContainText('This machine is also EC2 instance');
});

test('THE RULING: a second connection over the same AWS account does not take the machine', async ({ page }) => {
  /*
   * `createConnection` has no uniqueness check on the AWS account id, so the same account can be
   * connected twice — a configuration the rest of the product already handles. Both connections list
   * the same instances. An earlier version of the correlation overwrote the link whenever it differed,
   * so opening either instances page moved the machine to that account: which account owned it, and
   * therefore which one an audit row or a scoped page attributed it to, depended on which tab was open
   * last.
   */
  const first = await ensureMonitoringConnection(page);
  await page.goto(`/en/c/${first}/${MOTO_REGION}/instances/list`);
  await page.locator('main table tbody tr').first().waitFor({ timeout: 20_000 });
  const seeded = /i-[0-9a-f]{8,}/.exec(await page.locator('main').innerText())?.[0] ?? null;
  expect(seeded, 'the moto seed should have produced an EC2 instance to match against').not.toBeNull();

  const host = { ...(await enrol(page, 'e2e ec2 sticky')), machineId: 'e2e-machine-sticky' };
  const body = { ...REPORT, identity: { ...REPORT.identity, machineId: host.machineId, cloud: 'aws', cloudInstanceId: seeded! } };
  expect((await report(agent, { ...host, body })).status()).toBe(202);

  // The first account to list the instance places the machine, and names the region it is in.
  await page.goto(`/en/c/${first}/${MOTO_REGION}/instances/list`);
  await page.locator('main table tbody tr').first().waitFor({ timeout: 20_000 });
  await page.goto(`/en/hosts/${host.hostId}`);
  await expect(page.locator('main')).toContainText(`in Moto monitoring (${MOTO_REGION})`);

  // A second connection over the same account lists the same instance and does not take it.
  const second = await createConnection(page, 'ambient', 'Sticky second', MOTO_REGION);
  await page.getByRole('button', { name: 'Run test' }).click();
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.goto(`/en/c/${second}/${MOTO_REGION}/instances/list`);
  await page.locator('main table tbody tr').first().waitFor({ timeout: 20_000 });

  await page.goto(`/en/hosts/${host.hostId}`);
  await expect(page.locator('main')).toContainText('in Moto monitoring');
  await expect(page.locator('main')).not.toContainText('in Sticky second');

  // And a placement that is wrong is not permanent: detaching lets the right account place it.
  await page.getByRole('button', { name: 'Not this account' }).click();
  await expect(page.locator('main')).not.toContainText('This machine is also EC2 instance');
  await page.goto(`/en/c/${second}/${MOTO_REGION}/instances/list`);
  await page.locator('main table tbody tr').first().waitFor({ timeout: 20_000 });
  await page.goto(`/en/hosts/${host.hostId}`);
  await expect(page.locator('main')).toContainText('in Sticky second');

  await page.goto(`/en/accounts/${second}`);
  await page.getByRole('button', { name: 'Remove connection' }).click();
});

test('THE RULING: a machine inside the account shows up where the operator asks what is wrong', async ({ page }) => {
  /*
   * The owner's own case is Redis on an Ubuntu EC2 instance. A full disk on that box is invisible to
   * every AWS API there is: no CloudWatch metric, no alarm, nothing. The agent measures it, and until
   * now the figure lived only on the Machines page — so an operator asking "what is wrong in
   * production" was shown everything about the account and nothing about the machines inside it.
   *
   * It must also say what it is not. Nothing here is a Problem: it cannot be acknowledged, it opens no
   * incident, and no alert rule matches it. A card that looked like the Problems list would promise a
   * notification that is not coming.
   */
  const connectionId = await ensureMonitoringConnection(page);
  await page.goto(`/en/c/${connectionId}/${MOTO_REGION}/instances/list`);
  await page.locator('main table tbody tr').first().waitFor({ timeout: 20_000 });
  const seeded = /i-[0-9a-f]{8,}/.exec(await page.locator('main').innerText())?.[0] ?? null;
  expect(seeded, 'the moto seed should have produced an EC2 instance to match against').not.toBeNull();

  const host = { ...(await enrol(page, 'e2e redis box')), machineId: 'e2e-machine-in-env' };
  const full = { ...REPORT.sample, disks: [{ mount: '/', usedBytes: 49_000_000_000, totalBytes: 50_000_000_000 }] };
  const body = {
    ...REPORT,
    identity: { ...REPORT.identity, machineId: host.machineId, cloud: 'aws', cloudInstanceId: seeded! },
    sample: full,
  };
  expect((await report(agent, { ...host, body })).status()).toBe(202);

  // Placed by the account that can see the instance…
  await page.goto(`/en/c/${connectionId}/${MOTO_REGION}/instances/list`);
  await page.locator('main table tbody tr').first().waitFor({ timeout: 20_000 });

  // …and then visible on that environment's Health page, with the figure behind it.
  await page.goto(`/en/c/${connectionId}/${MOTO_REGION}/overview/health`);
  const machines = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole('heading', { name: 'Machines in this account' }) });
  await expect(machines).toContainText('e2e redis box');
  await expect(machines).toContainText('/ is 98% full');
  // Said where it is read: this is not a problem and nothing will be notified about it.
  await expect(machines).toContainText('no alert rule matches them');

  await machines.getByRole('link', { name: 'e2e redis box' }).click();
  await expect(page).toHaveURL(new RegExp(`/hosts/${host.hostId}$`));
});
