/**
 * @jest-environment node
 *
 * The real HTTP client against the contract mock server over real HTTP: auth, validation, pagination, polling,
 * actions, capability flags and session expiry.
 */
import type { AddressInfo } from 'node:net';
import { createMockServer } from '../../../dev/mock-server';
import { createHttpClient, type OpsWatchClient } from '../client';
import { ApiError } from '../errors';
import { nodeFetch } from '@/test/node-fetch';

let baseUrl = '';
let close: () => Promise<void>;
let token: string | null = null;
let client: OpsWatchClient;

beforeAll(async () => {
  const { server } = createMockServer({ ai: true });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise((resolve) => server.close(() => resolve()));
  client = createHttpClient({ baseUrl, getToken: () => token, fetchImpl: nodeFetch, sleep: async () => undefined });
});

afterAll(async () => {
  await close();
});

const scope = { env: 'prod-eu-west-1' };

it('reads the server capabilities without a session', async () => {
  const info = await client.getServerInfo();
  expect(info.product).toBe('opswatch');
  expect(info.apiVersion).toBe(1);
  expect(info.features.problems).toBe(true);
  expect(info.features.push).toBe(false);
});

it('rejects data calls without a token as unauthorized', async () => {
  token = null;
  await expect(client.health(scope)).rejects.toMatchObject({ kind: 'unauthorized', status: 401 });
});

it('refuses wrong credentials with the server error code', async () => {
  await expect(client.login('demo@opswatch.dev', 'nope')).rejects.toMatchObject({ kind: 'unauthorized', code: 'invalid_credentials' });
});

describe('signed in', () => {
  beforeAll(async () => {
    const session = await client.login('demo@opswatch.dev', 'opswatch-demo');
    token = session.token;
    expect(session.user.email).toBe('demo@opswatch.dev');
  });

  it('answers health with validated, typed data', async () => {
    const health = await client.health(scope);
    expect(health.status).toBe('degraded');
    expect(health.topProblem?.id).toBe('prb-checkout-5xx');
    expect(health.families.find((f) => f.family === 'cloudfront')?.unavailable?.reason).toBe('denied');
  });

  it('filters and paginates problems', async () => {
    const open = await client.problems(scope, { status: 'open' });
    expect(open.items.every((p) => p.status !== 'resolved')).toBe(true);
    const critical = await client.problems(scope, { severity: ['critical'] });
    expect(critical.items.map((p) => p.id)).toEqual(['prb-checkout-5xx', 'prb-aurora-connections']);
    const services = await client.services(scope);
    expect(services.length).toBeGreaterThan(5);
  });

  it('keeps unmeasured metrics null rather than zero', async () => {
    const worker = await client.service(scope, 'svc-orders-worker');
    expect(worker.errorRate.value).toBeNull();
    expect(worker.requests.value).toBeNull();
  });

  it('polls an asynchronous log search until it completes, then releases it', async () => {
    const now = Date.now();
    const started = await client.searchLogs(scope, { text: 'TypeError', from: now - 3_600_000, to: now });
    expect(started.status).toBe('running');
    const done = await client.pollLogs(scope, started.searchId);
    expect(done.status).toBe('complete');
    expect(done.items.length).toBeGreaterThan(0);
    expect(done.items.every((l) => l.message.includes('TypeError'))).toBe(true);
    await expect(client.cancelLogs(scope, started.searchId)).resolves.toBeUndefined();
  });

  it('acknowledges an alert once, then refuses', async () => {
    await client.acknowledgeAlert(scope, 'al-checkout-5xx');
    const alert = await client.alert(scope, 'al-checkout-5xx');
    expect(alert.status).toBe('acknowledged');
    expect(alert.allowedActions).not.toContain('acknowledge');
    await expect(client.acknowledgeAlert(scope, 'al-checkout-5xx')).rejects.toMatchObject({ kind: 'forbidden' });
  });

  it('asks the AI with references only and gets citations', async () => {
    const answer = await client.ask(scope, 'Why is checkout failing?', { type: 'problem', id: 'prb-checkout-5xx' });
    expect(answer.citations.length).toBeGreaterThan(0);
  });

  it('maps a missing object to not_found and an unsupported capability to unsupported', async () => {
    await expect(client.problem(scope, 'does-not-exist')).rejects.toMatchObject({ kind: 'not_found' });
    await expect(client.registerDevice({ pushToken: 'x', platform: 'ios', preferences: { minSeverity: 'critical', categories: [] } })).rejects.toMatchObject({ kind: 'unsupported' });
  });

  it('round-trips favorites', async () => {
    const saved = await client.saveFavorites([{ type: 'synthetic', id: 'syn-status', label: 'Status page' }]);
    expect(saved).toHaveLength(1);
    expect(await client.favorites()).toEqual(saved);
  });

  it('revokes the session on logout', async () => {
    await client.logout();
    await expect(client.me()).rejects.toBeInstanceOf(ApiError);
    await expect(client.me()).rejects.toMatchObject({ kind: 'unauthorized' });
  });
});
