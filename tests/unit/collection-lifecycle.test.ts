import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/client';
import { createTestDb } from '../helpers/db';

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);
const REGION = 'eu-west-1';
const FORWARDER = 'arn:aws:lambda:eu-west-1:123456789012:function:opswatch-x-forwarder';

/** What AWS is pretending to hold. Each test arranges it and then reads what OpsWatch did to it. */
const aws = vi.hoisted(() => ({
  filters: [] as { logGroup: string; filterName: string; destinationArn: string }[],
  putFails: null as string | null,
  reachable: true,
}));
const state = vi.hoisted(() => ({ db: undefined as unknown as Db }));

vi.mock('@/lib/env', () => ({ env: () => ({ OPSWATCH_SECRET: SECRET, OPSWATCH_PUBLIC_URL: 'https://opswatch.example.com' }) }));
vi.mock('@/lib/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/client')>()),
  getDb: () => state.db,
}));
vi.mock('@/lib/monitoring/target', () => ({
  resolveTarget: async () =>
    aws.reachable ? { ok: true, data: { region: REGION, credentials: {} } } : { ok: false, code: 'AccessDenied' },
}));
vi.mock('@/lib/monitoring/subscriptions', () => ({
  describeSubscriptions: async (_target: unknown, logGroup: string) => ({
    ok: true,
    data: aws.filters.filter((filter) => filter.logGroup === logGroup).map(({ filterName, destinationArn }) => ({ filterName, destinationArn })),
  }),
  putSubscription: async (_target: unknown, input: { logGroup: string; filterName: string; destinationArn: string }) => {
    if (aws.putFails !== null) return { ok: false, code: aws.putFails };
    aws.filters.push(input);
    return { ok: true, data: true };
  },
  deleteSubscription: async (_target: unknown, input: { logGroup: string; filterName: string }) => {
    const before = aws.filters.length;
    aws.filters = aws.filters.filter((filter) => !(filter.logGroup === input.logGroup && filter.filterName === input.filterName));
    return before === aws.filters.length ? { ok: false, code: 'ResourceNotFoundException' } : { ok: true, data: true };
  },
}));

const { disableManagedCollection, enableManagedCollection, startForwarding, stopForwarding } = await import('@/lib/aws/collection');
const { createConnection, findConnection } = await import('@/lib/connections/repository');
const { listForwardedGroups, readCollection, writeCollection } = await import('@/lib/store/collection');

let connectionId = '';

beforeEach(() => {
  state.db = createTestDb();
  aws.filters = [];
  aws.putFails = null;
  aws.reachable = true;
  connectionId = createConnection(state.db, { name: 'prod', method: 'role', awsAccountId: '123456789012', regions: [REGION] }).id;
});

/** Everything scenario B needs in place before a log group can be forwarded. */
function managed() {
  const { secret } = enableManagedCollection(state.db, connectionId, NOW);
  writeCollection(state.db, connectionId, { realtimeLogs: true, stackState: 'verified', forwarderArn: FORWARDER, verifiedAt: NOW }, NOW);
  return secret;
}

describe('Scenario A — connected, and nothing forwarded', () => {
  it('THE RULING: a connected account forwards nothing and has no secret', () => {
    const collection = readCollection(state.db, connectionId);
    expect(collection).toMatchObject({ managed: false, realtimeLogs: false, persistLogs: false, ingestSecretCiphertext: null });
    expect(listForwardedGroups(state.db, connectionId)).toEqual([]);
    // Nothing exists in AWS either: no stack was rendered, no filter was written.
    expect(aws.filters).toEqual([]);
  });

  it('enabling the capability still forwards nothing', () => {
    enableManagedCollection(state.db, connectionId, NOW);
    // The capability, not the traffic. A log group still has to be chosen, and the source switch is off.
    expect(readCollection(state.db, connectionId)).toMatchObject({ managed: true, realtimeLogs: false });
    expect(aws.filters).toEqual([]);
  });
});

describe('Scenario B — managed collection, one log group', () => {
  it('subscribes exactly the group that was chosen, and nothing else', async () => {
    managed();
    expect(await startForwarding(state.db, connectionId, REGION, '/aws/ecs/api', NOW)).toEqual({ ok: true, state: 'active' });

    expect(aws.filters).toEqual([{ logGroup: '/aws/ecs/api', filterName: `OpsWatch-${connectionId}`, destinationArn: FORWARDER }]);
    expect(listForwardedGroups(state.db, connectionId).map((group) => [group.logGroup, group.state])).toEqual([['/aws/ecs/api', 'active']]);
  });

  it('THE RULING: it will not take a log group another product is subscribed to', async () => {
    managed();
    aws.filters.push({ logGroup: '/aws/ecs/api', filterName: 'DatadogForwarder', destinationArn: 'arn:datadog' });

    const outcome = await startForwarding(state.db, connectionId, REGION, '/aws/ecs/api', NOW);
    expect(outcome).toEqual({ ok: false, reason: 'conflict', owner: 'DatadogForwarder' });
    // Left exactly as it was found.
    expect(aws.filters).toHaveLength(1);
    expect(listForwardedGroups(state.db, connectionId)[0]).toMatchObject({ state: 'failed', lastError: 'conflict' });
  });

  it('records why AWS refused, rather than a filter it did not create', async () => {
    managed();
    aws.putFails = 'LimitExceededException';
    expect(await startForwarding(state.db, connectionId, REGION, '/aws/ecs/api', NOW)).toEqual({ ok: false, reason: 'limit' });
    expect(aws.filters).toEqual([]);
    expect(listForwardedGroups(state.db, connectionId)[0]).toMatchObject({ state: 'failed', lastError: 'limit' });
  });

  it('refuses to subscribe anything before the forwarder is known', async () => {
    enableManagedCollection(state.db, connectionId, NOW);
    // No verified forwarder: there is nowhere for a subscription to point.
    expect(await startForwarding(state.db, connectionId, REGION, '/aws/ecs/api', NOW)).toEqual({ ok: false, reason: 'not_found' });
    expect(aws.filters).toEqual([]);
  });

  it('stops one group without touching the others', async () => {
    managed();
    await startForwarding(state.db, connectionId, REGION, '/aws/ecs/api', NOW);
    await startForwarding(state.db, connectionId, REGION, '/aws/ecs/worker', NOW);

    expect(await stopForwarding(state.db, connectionId, REGION, '/aws/ecs/api', NOW)).toEqual({ ok: true });
    expect(aws.filters.map((filter) => filter.logGroup)).toEqual(['/aws/ecs/worker']);
    expect(listForwardedGroups(state.db, connectionId).map((group) => group.logGroup)).toEqual(['/aws/ecs/worker']);
  });
});

describe('Scenario C — back to direct', () => {
  it('THE RULING: turning it off removes every subscription and keeps the connection', async () => {
    managed();
    await startForwarding(state.db, connectionId, REGION, '/aws/ecs/api', NOW);
    await startForwarding(state.db, connectionId, REGION, '/aws/ecs/worker', NOW);
    expect(aws.filters).toHaveLength(2);

    const outcome = await disableManagedCollection(state.db, connectionId, NOW);
    expect(outcome.removed.sort()).toEqual(['/aws/ecs/api', '/aws/ecs/worker']);
    expect(outcome.failed).toEqual([]);

    // Nothing left in AWS, nothing left here, and no secret anything could authenticate with.
    expect(aws.filters).toEqual([]);
    expect(listForwardedGroups(state.db, connectionId)).toEqual([]);
    expect(readCollection(state.db, connectionId)).toMatchObject({ managed: false, realtimeLogs: false, ingestSecretCiphertext: null, forwarderArn: null });

    // And the account is still connected. Disabling a feature is not disconnecting an integration.
    expect(findConnection(state.db, connectionId)).not.toBeNull();
    expect(findConnection(state.db, connectionId)?.regions).toEqual([REGION]);
  });

  it('THE RULING: a subscription it could not remove is reported, not swallowed', async () => {
    managed();
    await startForwarding(state.db, connectionId, REGION, '/aws/ecs/api', NOW);
    // The role can no longer be assumed — a revoked stack, a broken trust policy.
    aws.reachable = false;

    const outcome = await disableManagedCollection(state.db, connectionId, NOW);
    // It is an invocation the operator is still paying for, and they need to know to delete it themselves.
    expect(outcome.failed).toEqual(['/aws/ecs/api']);
    expect(aws.filters).toHaveLength(1);
    // The feature is still off here, so nothing more is accepted or sent.
    expect(readCollection(state.db, connectionId)).toMatchObject({ managed: false, ingestSecretCiphertext: null });
  });

  it('is a no-op for a connection nobody ever enabled it on', async () => {
    expect(await disableManagedCollection(state.db, connectionId, NOW)).toEqual({ removed: [], failed: [] });
  });
});
